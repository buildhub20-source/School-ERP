import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { DELEGATES, SCHEMA, meta, type ModelMeta, type RelationField, type ScalarField } from "./schema";
import { getStore, type Row, type Store } from "./store";

/**
 * JSON DATA ENGINE — a drop-in stand-in for PrismaClient that answers the same calls from in-memory JSON tables.
 *
 * Supports what this codebase uses: findMany/findFirst/findUnique(+OrThrow)/count/aggregate/groupBy, create/createMany(+AndReturn)/
 * update/updateMany(+AndReturn)/upsert/delete/deleteMany, where (AND/OR/NOT, equals/not/in/notIn/lt/lte/gt/gte/contains/
 * startsWith/endsWith/mode/has/hasSome/hasEvery, relation some/every/none/is/isNot), select/include/_count, orderBy (incl.
 * relation fields, nulls), skip/take/distinct, nested create/connect/update writes, increment/decrement/multiply/divide,
 * defaults (cuid/uuid/now/literals), @updatedAt, unique checks (P2002), not found (P2025), FK checks (P2003), onDelete
 * Cascade/SetNull, $transaction (callback or array, with rollback), $extends query middleware, and row-lock raw queries
 * (SELECT … FOR UPDATE / advisory locks become no-ops). Anything else throws loudly so gaps are never silent.
 */

const VERSION = "json-db";
const collator = new Intl.Collator("en");

// ───────────────────────────── errors ─────────────────────────────

function known(code: string, message: string, metaInfo?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: VERSION, meta: metaInfo });
}

// ───────────────────────────── values ─────────────────────────────

const isDecimal = (v: unknown): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v);
const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !(v instanceof Date) && !isDecimal(v) && !Array.isArray(v);

/** Comparable form: numbers for numerics/dates/booleans, strings stay strings. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (isDecimal(v)) return v.toNumber();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  const x = norm(a), y = norm(b);
  if (typeof x === "object" || typeof y === "object") return JSON.stringify(a) === JSON.stringify(b);
  return x === y;
}

function cmp(a: unknown, b: unknown): number {
  const x = norm(a), y = norm(b);
  if (typeof x === "string" && typeof y === "string") return collator.compare(x, y);
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
}

const keyOf = (v: unknown) => (v === null || v === undefined ? "\u0000" : v instanceof Date ? `d${v.getTime()}` : String(v));

function coerce(f: ScalarField, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (f.isList) return Array.isArray(v) ? v.slice() : [v];
  switch (f.type) {
    case "DateTime": return v instanceof Date ? new Date(v.getTime()) : new Date(v as string);
    case "Decimal": return isDecimal(v) ? v : new Prisma.Decimal(v as number | string);
    case "BigInt": return typeof v === "bigint" ? v : BigInt(v as number);
    case "Int": return typeof v === "number" ? Math.trunc(v) : Number(v);
    case "Float": return Number(v);
    case "Json": return structuredClone(v);
    default: return v;
  }
}

function cloneVal(f: ScalarField | undefined, v: unknown): unknown {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return f?.type === "Json" ? structuredClone(v) : v.slice();
  if (f?.type === "Json" && v !== null && typeof v === "object") return structuredClone(v);
  return v;
}

function cuid() {
  return `c${Date.now().toString(36)}${randomBytes(12).toString("hex").slice(0, 16)}`;
}

function defaultFor(f: ScalarField): unknown {
  const d = f.default as { name?: string } | unknown;
  if (d && typeof d === "object" && "name" in (d as object)) {
    const name = (d as { name: string }).name;
    if (name === "cuid") return cuid();
    if (name === "uuid") return randomUUID();
    if (name === "now") return new Date();
    throw new Error(`json-db: unsupported default ${name}() on ${f.name}`);
  }
  if (f.type === "Json" && typeof d === "string") return JSON.parse(d);
  return coerce(f, d);
}

// ───────────────────────────── engine ─────────────────────────────

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Model → list of { model, relation } on OTHER models whose foreign key points at it (for delete checks). */
const INBOUND = (() => {
  const m = new Map<string, { model: string; rel: RelationField }[]>();
  for (const mm of SCHEMA.values()) for (const r of mm.relations.values()) if (r.from.length) {
    if (!m.has(r.model)) m.set(r.model, []);
    m.get(r.model)!.push({ model: mm.name, rel: r });
  }
  return m;
})();

class Engine {
  /** Lookup indexes (model + fields → rows), rebuilt lazily after any write. */
  private fkCache = new Map<string, Map<string, Row[]>>();
  private cacheVersion = -1;
  writes = 0;

  constructor(private store: Store) {}

  private changed() { this.writes++; }

  // ── lookups ──

  private index(model: string, fields: string[]): Map<string, Row[]> {
    if (this.cacheVersion !== this.writes) { this.fkCache.clear(); this.cacheVersion = this.writes; }
    const k = `${model}|${fields.join(",")}`;
    let idx = this.fkCache.get(k);
    if (!idx) {
      idx = new Map();
      for (const r of this.store.rows(model)) {
        const key = fields.map((f) => keyOf(r[f])).join("\u0001");
        const list = idx.get(key);
        if (list) list.push(r); else idx.set(key, [r]);
      }
      this.fkCache.set(k, idx);
    }
    return idx;
  }

  private lookup(model: string, fields: string[], values: unknown[]): Row[] {
    if (values.some((v) => v === null || v === undefined)) return [];
    if (fields.length === 1 && fields[0] === "id") { const r = this.store.byId.get(model)?.get(values[0] as string); return r ? [r] : []; }
    return this.index(model, fields).get(values.map(keyOf).join("\u0001")) ?? [];
  }

  relatedOne(rel: RelationField, row: Row): Row | null {
    if (rel.from.length) return this.lookup(rel.model, rel.to, rel.from.map((f) => row[f]))[0] ?? null;
    return this.lookup(rel.model, rel.otherFrom, rel.refs.map((f) => row[f]))[0] ?? null;
  }

  relatedMany(rel: RelationField, row: Row): Row[] {
    if (rel.from.length) return this.lookup(rel.model, rel.to, rel.from.map((f) => row[f]));
    return this.lookup(rel.model, rel.otherFrom, rel.refs.map((f) => row[f]));
  }

  // ── where ──

  matchScalar(f: ScalarField, value: unknown, c: unknown): boolean {
    if (c === undefined) return true;
    if (!isPlain(c) || (f.type === "Json" && !("equals" in c) && !("not" in c))) {
      if (f.isList && Array.isArray(c)) return JSON.stringify(value) === JSON.stringify(c);
      return eq(value, c);
    }
    const insensitive = c.mode === "insensitive";
    const s = (v: unknown) => (insensitive ? String(v).toLowerCase() : String(v));
    for (const [op, arg] of Object.entries(c)) {
      if (arg === undefined || op === "mode") continue;
      switch (op) {
        case "equals":
          if (insensitive && typeof value === "string" && typeof arg === "string") { if (s(value) !== s(arg)) return false; }
          else if (!eq(value, arg)) return false;
          break;
        case "not":
          if (isPlain(arg)) { if (this.matchScalar(f, value, { ...arg, mode: arg.mode ?? c.mode })) return false; }
          else if (arg === null) { if (value === null || value === undefined) return false; }
          else if (value === null || value === undefined || (insensitive ? s(value) === s(arg) : eq(value, arg))) return false;
          break;
        case "in": if (value === null || !(arg as unknown[]).some((a) => (insensitive ? s(a) === s(value) : eq(a, value)))) return false; break;
        case "notIn": if (value === null || (arg as unknown[]).some((a) => eq(a, value))) return false; break;
        case "lt": if (value === null || arg === null || cmp(value, arg) >= 0) return false; break;
        case "lte": if (value === null || arg === null || cmp(value, arg) > 0) return false; break;
        case "gt": if (value === null || arg === null || cmp(value, arg) <= 0) return false; break;
        case "gte": if (value === null || arg === null || cmp(value, arg) < 0) return false; break;
        case "contains": if (value === null || !s(value).includes(s(arg))) return false; break;
        case "startsWith": if (value === null || !s(value).startsWith(s(arg))) return false; break;
        case "endsWith": if (value === null || !s(value).endsWith(s(arg))) return false; break;
        case "has": if (!Array.isArray(value) || !value.some((v) => eq(v, arg))) return false; break;
        case "hasSome": if (!Array.isArray(value) || !(arg as unknown[]).some((a) => value.some((v) => eq(v, a)))) return false; break;
        case "hasEvery": if (!Array.isArray(value) || !(arg as unknown[]).every((a) => value.some((v) => eq(v, a)))) return false; break;
        case "isEmpty": if (!Array.isArray(value) || (value.length === 0) !== arg) return false; break;
        default: throw new Error(`json-db: unsupported filter "${op}" on ${f.name}`);
      }
    }
    return true;
  }

  match(m: ModelMeta, row: Row, where: Args | undefined): boolean {
    if (!where) return true;
    for (const [k, c] of Object.entries(where)) {
      if (c === undefined) continue;
      if (k === "AND") { if (!(Array.isArray(c) ? c : [c]).every((w) => this.match(m, row, w))) return false; continue; }
      if (k === "OR") { if (!(c as Args[]).some((w) => this.match(m, row, w))) return false; continue; }
      if (k === "NOT") { if ((Array.isArray(c) ? c : [c]).some((w) => this.match(m, row, w))) return false; continue; }
      const f = m.scalars.get(k);
      if (f) { if (!this.matchScalar(f, row[k], c)) return false; continue; }
      const rel = m.relations.get(k);
      if (rel) { if (!this.matchRelation(rel, row, c)) return false; continue; }
      const u = m.uniques.find((x) => x.name === k);
      if (u) { if (!this.match(m, row, c as Args)) return false; continue; }
      throw new Error(`json-db: unknown field "${k}" in where on ${m.name}`);
    }
    return true;
  }

  private matchRelation(rel: RelationField, row: Row, c: unknown): boolean {
    const rm = meta(rel.model);
    if (rel.isList) {
      const list = this.relatedMany(rel, row);
      const w = c as Args;
      if (w.some !== undefined && !list.some((r) => this.match(rm, r, w.some))) return false;
      if (w.every !== undefined && !list.every((r) => this.match(rm, r, w.every))) return false;
      if (w.none !== undefined && list.some((r) => this.match(rm, r, w.none))) return false;
      return true;
    }
    const target = this.relatedOne(rel, row);
    if (c === null) return target === null;
    const w = c as Args;
    if ("is" in w || "isNot" in w) {
      if (w.is !== undefined) { if (w.is === null ? target !== null : !(target && this.match(rm, target, w.is))) return false; }
      if (w.isNot !== undefined) { if (w.isNot === null ? target === null : !!(target && this.match(rm, target, w.isNot))) return false; }
      return true;
    }
    return !!target && this.match(rm, target, w);
  }

  // ── ordering & paging ──

  private orderValue(m: ModelMeta, row: Row, key: string, spec: unknown): { v: unknown; dir: string; nulls?: string } {
    const f = m.scalars.get(key);
    if (f) {
      if (isPlain(spec)) return { v: row[key], dir: String(spec.sort), nulls: spec.nulls as string | undefined };
      return { v: row[key], dir: String(spec) };
    }
    const rel = m.relations.get(key);
    if (rel && isPlain(spec)) {
      if (rel.isList) { const [[, d]] = Object.entries(spec._count as object); return { v: this.relatedMany(rel, row).length, dir: String(d) }; }
      const target = this.relatedOne(rel, row);
      const [[k2, s2]] = Object.entries(spec);
      return target ? this.orderValue(meta(rel.model), target, k2, s2) : { v: null, dir: isPlain(s2) ? String(s2.sort) : String(s2) };
    }
    if (key === "_count" && isPlain(spec)) {
      const [[rk, d]] = Object.entries(spec);
      return { v: this.relatedMany(m.relations.get(rk)!, row).length, dir: String(d) };
    }
    throw new Error(`json-db: cannot order ${m.name} by ${key}`);
  }

  sort(m: ModelMeta, rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o as object).filter(([, v]) => v !== undefined));
    if (!specs.length) return rows;
    return rows.slice().sort((a, b) => {
      for (const [k, spec] of specs) {
        const x = this.orderValue(m, a, k, spec), y = this.orderValue(m, b, k, spec);
        const desc = x.dir === "desc";
        const xn = x.v === null || x.v === undefined, yn = y.v === null || y.v === undefined;
        if (xn || yn) {
          if (xn && yn) continue;
          const nullsFirst = x.nulls ? x.nulls === "first" : desc; // PostgreSQL: NULLS LAST for ASC, FIRST for DESC
          return (xn ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        const c = cmp(x.v, y.v);
        if (c) return desc ? -c : c;
      }
      return 0;
    });
  }

  private page(rows: Row[], args: Args): Row[] {
    let out = rows;
    if (args.distinct) {
      const seen = new Set<string>();
      const fields = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
      out = out.filter((r) => { const k = fields.map((f: string) => keyOf(r[f])).join("\u0001"); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    if (args.cursor) throw new Error("json-db: cursor pagination is not supported");
    const skip = args.skip ?? 0;
    if (args.take !== undefined && args.take < 0) return out.slice(Math.max(0, out.length - skip + args.take), out.length - skip);
    return out.slice(skip, args.take !== undefined ? skip + args.take : undefined);
  }

  select(model: string, args: Args): Row[] {
    const m = meta(model);
    const rows = this.store.rows(model).filter((r) => this.match(m, r, args.where));
    return this.page(this.sort(m, rows, args.orderBy), args);
  }

  // ── projection ──

  project(model: string, row: Row, args: Args = {}): Row {
    const m = meta(model);
    const out: Row = {};
    const sel = args.select as Args | undefined;
    if (!sel) for (const [n, f] of m.scalars) out[n] = cloneVal(f, row[n]);
    const extra = sel ?? (args.include as Args | undefined) ?? {};
    for (const [k, v] of Object.entries(extra)) {
      if (!v) continue;
      if (k === "_count") { out._count = this.countRelations(m, row, v); continue; }
      const f = m.scalars.get(k);
      if (f) { out[k] = cloneVal(f, row[k]); continue; }
      const rel = m.relations.get(k);
      if (!rel) throw new Error(`json-db: unknown field "${k}" in select/include on ${model}`);
      const sub = v === true ? {} : (v as Args);
      if (rel.isList) {
        const rm = meta(rel.model);
        const list = this.page(this.sort(rm, this.relatedMany(rel, row).filter((r) => this.match(rm, r, sub.where)), sub.orderBy), sub);
        out[k] = list.map((r) => this.project(rel.model, r, sub));
      } else {
        const t = this.relatedOne(rel, row);
        out[k] = t ? this.project(rel.model, t, sub) : null;
      }
    }
    return out;
  }

  private countRelations(m: ModelMeta, row: Row, v: unknown): Row {
    const out: Row = {};
    const which = v === true ? Object.fromEntries([...m.relations.values()].filter((r) => r.isList).map((r) => [r.name, true])) : ((v as Args).select as Args);
    for (const [k, w] of Object.entries(which)) {
      if (!w) continue;
      const rel = m.relations.get(k)!;
      const rm = meta(rel.model);
      const where = w === true ? undefined : (w as Args).where;
      out[k] = this.relatedMany(rel, row).filter((r) => this.match(rm, r, where)).length;
    }
    return out;
  }

  // ── aggregates ──

  private agg(m: ModelMeta, rows: Row[], args: Args): Row {
    const out: Row = {};
    const fieldOf = (n: string) => m.scalars.get(n)!;
    if (args._count !== undefined) {
      if (args._count === true) out._count = rows.length;
      else out._count = Object.fromEntries(Object.entries(args._count as object).filter(([, on]) => on).map(([k]) => [k, k === "_all" ? rows.length : rows.filter((r) => r[k] !== null && r[k] !== undefined).length]));
    }
    for (const fn of ["_sum", "_avg", "_min", "_max"] as const) {
      if (!args[fn]) continue;
      const res: Row = {};
      for (const [k, on] of Object.entries(args[fn] as object)) {
        if (!on) continue;
        const f = fieldOf(k);
        const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
        if (!vals.length) { res[k] = null; continue; }
        if (fn === "_min" || fn === "_max") { res[k] = cloneVal(f, vals.reduce((a, b) => ((fn === "_min" ? cmp(b, a) < 0 : cmp(b, a) > 0) ? b : a))); continue; }
        if (f.type === "Decimal") {
          const sum = vals.reduce<Prisma.Decimal>((s, v) => s.plus(v as Prisma.Decimal), new Prisma.Decimal(0));
          res[k] = fn === "_sum" ? sum : sum.div(vals.length);
        } else if (f.type === "BigInt") {
          const sum = vals.reduce<bigint>((s, v) => s + (v as bigint), 0n);
          res[k] = fn === "_sum" ? sum : Number(sum) / vals.length;
        } else {
          const sum = vals.reduce<number>((s, v) => s + Number(v), 0);
          res[k] = fn === "_sum" ? sum : sum / vals.length;
        }
      }
      out[fn] = res;
    }
    return out;
  }

  aggregate(model: string, args: Args): Row {
    const m = meta(model);
    return this.agg(m, this.select(model, { where: args.where, orderBy: args.orderBy, take: args.take, skip: args.skip }), args);
  }

  count(model: string, args: Args): number | Row {
    const rows = this.select(model, { where: args.where, orderBy: args.orderBy, take: args.take, skip: args.skip, distinct: args.distinct });
    if (isPlain(args.select)) return this.agg(meta(model), rows, { _count: args.select })._count as Row;
    return rows.length;
  }

  groupBy(model: string, args: Args): Row[] {
    const m = meta(model);
    const by: string[] = Array.isArray(args.by) ? args.by : [args.by];
    const groups = new Map<string, Row[]>();
    for (const r of this.store.rows(model).filter((x) => this.match(m, x, args.where))) {
      const k = by.map((f) => keyOf(r[f])).join("\u0001");
      const g = groups.get(k);
      if (g) g.push(r); else groups.set(k, [r]);
    }
    if (args.having) throw new Error("json-db: groupBy having is not supported");
    let out = [...groups.values()].map((rows) => ({ ...Object.fromEntries(by.map((f) => [f, cloneVal(m.scalars.get(f), rows[0][f])])), ...this.agg(m, rows, args) }));
    if (args.orderBy) {
      const specs = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).flatMap((o: object) => Object.entries(o));
      const val = (row: Row, k: string, s: unknown): [unknown, string] => {
        if (isPlain(s) && k.startsWith("_")) { const [[f, d]] = Object.entries(s); const agg = row[k] as Row | number; return [typeof agg === "number" ? agg : agg?.[f], String(d)]; }
        return [row[k], String(s)];
      };
      out = out.sort((a, b) => {
        for (const [k, s] of specs) {
          const [x, d] = val(a, k, s), [y] = val(b, k, s);
          const c = x === null ? 1 : y === null ? -1 : cmp(x, y);
          if (c) return d === "desc" ? -c : c;
        }
        return 0;
      });
    }
    return this.page(out, { skip: args.skip, take: args.take });
  }

  // ── writes ──

  private checkUnique(m: ModelMeta, row: Row, self?: Row) {
    for (const u of m.uniques) {
      const vals = u.fields.map((f) => row[f]);
      if (vals.some((v) => v === null || v === undefined)) continue;
      const clash = this.lookup(m.name, u.fields, vals).find((r) => r !== self);
      if (clash) throw known("P2002", `Unique constraint failed on the fields: (${u.fields.map((f) => `\`${f}\``).join(",")})`, { modelName: m.name, target: u.fields });
    }
  }

  private findUniqueRow(model: string, where: Args): Row | null {
    const m = meta(model);
    return this.store.rows(model).find((r) => this.match(m, r, where)) ?? null;
  }

  private checkForeignKeys(m: ModelMeta, row: Row) {
    for (const rel of m.relations.values()) {
      if (!rel.from.length) continue;
      const vals = rel.from.map((f) => row[f]);
      if (vals.some((v) => v === null || v === undefined)) continue;
      if (!this.lookup(rel.model, rel.to, vals).length) throw known("P2003", `Foreign key constraint violated: \`${m.name}_${rel.from.join("_")}_fkey (index)\``, { field_name: rel.from.join(",") });
    }
  }

  create(model: string, data: Args): Row {
    const m = meta(model);
    const row: Row = {};
    const after: (() => void)[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      const f = m.scalars.get(k);
      if (f) { row[k] = coerce(f, v); continue; }
      const rel = m.relations.get(k);
      if (!rel) throw new Error(`json-db: unknown field "${k}" in create on ${model}`);
      const op = v as Args;
      if (rel.from.length) {
        let target: Row | null = null;
        if (op.connect) target = this.findUniqueRow(rel.model, op.connect);
        else if (op.create) target = this.create(rel.model, op.create);
        else if (op.connectOrCreate) target = this.findUniqueRow(rel.model, op.connectOrCreate.where) ?? this.create(rel.model, op.connectOrCreate.create);
        if (!target) throw known("P2025", `No '${rel.model}' record was found for a nested connect on ${model}.${k}.`);
        rel.from.forEach((f, i) => { row[f] = target![rel.to[i]]; });
      } else {
        after.push(() => this.nestedToMany(rel, row, op));
      }
    }
    for (const [n, f] of m.scalars) {
      if (row[n] !== undefined) continue;
      if (f.isUpdatedAt) row[n] = new Date();
      else if (f.default !== undefined) row[n] = defaultFor(f);
      else row[n] = f.isList ? [] : null;
    }
    this.checkUnique(m, row);
    this.checkForeignKeys(m, row);
    this.store.insert(model, row);
    this.changed();
    for (const fn of after) fn();
    return row;
  }

  /** Nested writes on a to-many relation of `parent` (the related rows hold the foreign key). */
  private nestedToMany(rel: RelationField, parent: Row, op: Args) {
    const link = Object.fromEntries(rel.otherFrom.map((f, i) => [f, parent[rel.refs[i]]]));
    const rm = meta(rel.model);
    const scope = (w?: Args) => ({ ...(w ?? {}), ...link });
    const arr = <T,>(x: T | T[]) => (Array.isArray(x) ? x : [x]);
    for (const [kind, v] of Object.entries(op)) {
      if (v === undefined) continue;
      switch (kind) {
        case "create": for (const d of arr(v)) this.create(rel.model, { ...d, ...link }); break;
        case "createMany": for (const d of arr((v as Args).data)) this.create(rel.model, { ...d, ...link }); break;
        case "connect": for (const w of arr(v)) this.updateRow(rel.model, this.mustFind(rel.model, w), link); break;
        case "set": {
          for (const r of this.store.rows(rel.model).filter((r) => this.match(rm, r, link))) this.updateRow(rel.model, r, Object.fromEntries(rel.otherFrom.map((f) => [f, null])));
          for (const w of arr(v)) this.updateRow(rel.model, this.mustFind(rel.model, w), link);
          break;
        }
        case "disconnect": for (const w of arr(v)) this.updateRow(rel.model, this.mustFind(rel.model, scope(w)), Object.fromEntries(rel.otherFrom.map((f) => [f, null]))); break;
        case "update": for (const u of arr(v)) this.updateRow(rel.model, this.mustFind(rel.model, scope(u.where)), u.data); break;
        case "updateMany": for (const u of arr(v)) for (const r of this.store.rows(rel.model).filter((r) => this.match(rm, r, scope(u.where)))) this.updateRow(rel.model, r, u.data); break;
        case "upsert": for (const u of arr(v)) { const r = this.findUniqueRow(rel.model, scope(u.where)); if (r) this.updateRow(rel.model, r, u.update); else this.create(rel.model, { ...u.create, ...link }); } break;
        case "delete": for (const w of arr(v)) this.deleteRows(rel.model, [this.mustFind(rel.model, scope(w))]); break;
        case "deleteMany": for (const w of arr(v)) this.deleteRows(rel.model, this.store.rows(rel.model).filter((r) => this.match(rm, r, scope(w === true ? {} : w)))); break;
        default: throw new Error(`json-db: unsupported nested write "${kind}" on ${rel.name}`);
      }
    }
  }

  private mustFind(model: string, where: Args): Row {
    const r = this.findUniqueRow(model, where);
    if (!r) throw known("P2025", `An operation failed because it depends on one or more records that were required but not found. No '${model}' record found.`, { modelName: model, cause: "Record to update not found." });
    return r;
  }

  updateRow(model: string, row: Row, data: Args): Row {
    const m = meta(model);
    const next: Row = { ...row };
    const after: (() => void)[] = [];
    let touched = false;
    for (const [k, v] of Object.entries(data ?? {})) {
      if (v === undefined) continue;
      const f = m.scalars.get(k);
      if (f) {
        touched = true;
        if (isPlain(v) && f.type !== "Json") {
          const cur = next[k];
          if ("set" in v) next[k] = coerce(f, v.set);
          else if (f.isList && "push" in v) next[k] = [...((cur as unknown[]) ?? []), ...(Array.isArray(v.push) ? v.push : [v.push])];
          else {
            const [[op, n]] = Object.entries(v);
            if (cur === null || cur === undefined) continue; // SQL: NULL + n stays NULL
            if (f.type === "Decimal") {
              const d = cur as Prisma.Decimal, x = new Prisma.Decimal(n as number);
              next[k] = op === "increment" ? d.plus(x) : op === "decrement" ? d.minus(x) : op === "multiply" ? d.times(x) : d.div(x);
            } else {
              const a = Number(cur), b = Number(n);
              const r = op === "increment" ? a + b : op === "decrement" ? a - b : op === "multiply" ? a * b : a / b;
              next[k] = f.type === "Int" ? Math.trunc(r) : f.type === "BigInt" ? BigInt(Math.trunc(r)) : r;
            }
          }
        } else next[k] = coerce(f, v);
        continue;
      }
      const rel = m.relations.get(k);
      if (!rel) throw new Error(`json-db: unknown field "${k}" in update on ${model}`);
      const op = v as Args;
      if (rel.from.length) {
        touched = true;
        if (op.disconnect) rel.from.forEach((f) => { next[f] = null; });
        let target: Row | null = null;
        if (op.connect) target = this.mustFind(rel.model, op.connect);
        if (op.create) target = this.create(rel.model, op.create);
        if (op.connectOrCreate) target = this.findUniqueRow(rel.model, op.connectOrCreate.where) ?? this.create(rel.model, op.connectOrCreate.create);
        if (op.update || op.upsert) {
          const cur = this.relatedOne(rel, row);
          if (cur) this.updateRow(rel.model, cur, op.update?.data ?? op.update ?? op.upsert.update);
          else if (op.upsert) target = this.create(rel.model, op.upsert.create);
        }
        if (op.delete) { const cur = this.relatedOne(rel, row); if (cur) after.push(() => this.deleteRows(rel.model, [cur])); rel.from.forEach((f) => { next[f] = null; }); }
        if (target) rel.from.forEach((f, i) => { next[f] = target![rel.to[i]]; });
      } else if (rel.isList) {
        after.push(() => this.nestedToMany(rel, next, op));
      } else {
        // to-one where the other side holds the key (e.g. Bus ← TransportStaff.drivesBus)
        const cur = this.relatedOne(rel, row);
        const link = Object.fromEntries(rel.otherFrom.map((f, i) => [f, row[rel.refs[i]]]));
        if (op.update && cur) this.updateRow(rel.model, cur, op.update.data ?? op.update);
        if (op.create) this.create(rel.model, { ...op.create, ...link });
        if (op.upsert) { if (cur) this.updateRow(rel.model, cur, op.upsert.update); else this.create(rel.model, { ...op.upsert.create, ...link }); }
        if (op.connect) this.updateRow(rel.model, this.mustFind(rel.model, op.connect), link);
        if (op.disconnect && cur) this.updateRow(rel.model, cur, Object.fromEntries(rel.otherFrom.map((f) => [f, null])));
        if (op.delete && cur) after.push(() => this.deleteRows(rel.model, [cur]));
      }
    }
    if (touched) for (const [n, f] of m.scalars) if (f.isUpdatedAt && (data as Args)[n] === undefined) next[n] = new Date();
    this.checkUnique(m, next, row);
    this.checkForeignKeys(m, next);
    this.store.replace(model, row, next);
    this.changed();
    for (const fn of after) fn();
    return next;
  }

  deleteRows(model: string, rows: Row[]) {
    if (!rows.length) return;
    const doomed = new Set(rows);
    for (const { model: other, rel } of INBOUND.get(model) ?? []) {
      const om = meta(other);
      const refs = this.store.rows(other).filter((r) => rows.some((d) => rel.from.every((f, i) => eq(r[f], d[rel.to[i]]))));
      if (!refs.length) continue;
      const mode = rel.onDelete ?? (rel.isRequired ? "Restrict" : "SetNull");
      if (mode === "Cascade") this.deleteRows(other, refs);
      else if (mode === "SetNull") for (const r of refs) this.updateRow(other, r, Object.fromEntries(rel.from.filter((f) => !om.scalars.get(f)!.isRequired).map((f) => [f, null])));
      else throw known("P2003", `Foreign key constraint violated on the constraint: \`${other}_${rel.from.join("_")}_fkey\``, { field_name: `${other}.${rel.from.join(",")}`, modelName: model });
    }
    this.store.remove(model, doomed);
    this.changed();
  }

  // ── operation dispatcher ──

  exec(model: string, op: string, args: Args = {}): unknown {
    const p = (r: Row) => this.project(model, r, args);
    switch (op) {
      case "findMany": return this.select(model, args).map(p);
      case "findFirst": case "findUnique": { const r = this.select(model, { ...args, take: 1 })[0]; return r ? p(r) : null; }
      case "findFirstOrThrow": case "findUniqueOrThrow": {
        const r = this.select(model, { ...args, take: 1 })[0];
        if (!r) throw known("P2025", `No ${model} found`, { modelName: model });
        return p(r);
      }
      case "count": return this.count(model, args);
      case "aggregate": return this.aggregate(model, args);
      case "groupBy": return this.groupBy(model, args);
      case "create": return p(this.create(model, args.data));
      case "createMany": case "createManyAndReturn": {
        const list = (Array.isArray(args.data) ? args.data : [args.data]) as Args[];
        const made: Row[] = [];
        for (const d of list) {
          try { made.push(this.create(model, d)); }
          catch (e) { if (!(args.skipDuplicates && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; }
        }
        return op === "createMany" ? { count: made.length } : made.map(p);
      }
      case "update": return p(this.updateRow(model, this.mustFind(model, args.where), args.data));
      case "updateMany": case "updateManyAndReturn": {
        const rows = this.select(model, { where: args.where });
        const updated = rows.map((r) => this.updateRow(model, r, args.data));
        return op === "updateMany" ? { count: updated.length } : updated.map(p);
      }
      case "upsert": {
        const r = this.findUniqueRow(model, args.where);
        return p(r ? this.updateRow(model, r, args.update) : this.create(model, args.create));
      }
      case "delete": { const r = this.mustFind(model, args.where); const out = p(r); this.deleteRows(model, [r]); return out; }
      case "deleteMany": { const rows = this.select(model, { where: args.where }); this.deleteRows(model, rows); return { count: rows.length }; }
      default: throw new Error(`json-db: unsupported operation ${model}.${op}`);
    }
  }
}

// ───────────────────────────── client ─────────────────────────────

/** Lazily-executed promise (like PrismaPromise): runs on first await, so $transaction([...]) can run them in order. */
class Lazy<T> implements PromiseLike<T> {
  private p?: Promise<T>;
  readonly [Symbol.toStringTag] = "PrismaPromise";
  constructor(private fn: () => Promise<T>) {}
  run(): Promise<T> { return (this.p ??= this.fn()); }
  then<A = T, B = never>(ok?: ((v: T) => A | PromiseLike<A>) | null, err?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> { return this.run().then(ok, err); }
  catch<B = never>(err?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run().catch(err); }
  finally(fn?: (() => void) | null) { return this.run().finally(fn); }
}

type Middleware = (p: { model: string; operation: string; args: Args; query: (args: Args) => Promise<unknown> }) => Promise<unknown>;

const OPS = ["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate", "groupBy", "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"];

const txScope = new AsyncLocalStorage<boolean>();
let txQueue: Promise<unknown> = Promise.resolve();

function makeClient(engine: Engine, store: Store, mws: Middleware[]): Record<string, unknown> {
  const client: Record<string, unknown> = {};

  const runOp = (model: string, operation: string, args: Args): Promise<unknown> => {
    const call = (i: number, a: Args): Promise<unknown> =>
      i < mws.length ? mws[i]({ model, operation, args: a, query: (next) => call(i + 1, next) }) : Promise.resolve().then(() => engine.exec(model, operation, a));
    return call(0, args ?? {});
  };

  for (const [delegate, model] of DELEGATES) {
    client[delegate] = Object.fromEntries(OPS.map((op) => [op, (args: Args) => new Lazy(() => runOp(model, op, args))]));
  }

  const rawNoop = (strings: TemplateStringsArray | string) => {
    const sql = typeof strings === "string" ? strings : strings.join("?");
    return new Lazy(async () => {
      if (/\bFOR UPDATE\b|pg_advisory/i.test(sql)) return [] as unknown[]; // row locks: nothing to lock in memory
      throw new Error(`json-db: raw SQL is not supported in JSON mode: ${sql.slice(0, 120)}`);
    });
  };
  client.$queryRaw = rawNoop;
  client.$executeRaw = rawNoop;
  client.$queryRawUnsafe = rawNoop;
  client.$executeRawUnsafe = rawNoop;
  client.$connect = async () => {};
  client.$disconnect = async () => { store.flush(); };
  client.$on = () => {};

  client.$transaction = async (arg: unknown) => {
    const work = async () => {
      if (Array.isArray(arg)) { const out = []; for (const p of arg) out.push(await (p as Lazy<unknown>).run?.() ?? (await p)); return out; }
      return (arg as (tx: unknown) => Promise<unknown>)(client);
    };
    if (txScope.getStore()) return work(); // nested: part of the outer transaction
    // One transaction at a time, so a rollback never wipes another request's half-done work.
    const run = async () => {
      const snap = store.snapshot();
      try { return await txScope.run(true, work); }
      catch (e) { store.restore(snap); engine.writes++; throw e; }
    };
    const result = txQueue.then(run, run);
    txQueue = result.catch(() => undefined);
    return result;
  };

  client.$extends = (ext: { query?: { $allModels?: { $allOperations?: Middleware } } }) => {
    const mw = ext?.query?.$allModels?.$allOperations;
    if (!mw) throw new Error("json-db: only query.$allModels.$allOperations extensions are supported");
    return makeClient(engine, store, [...mws, mw]);
  };

  return client;
}

const g = globalThis as unknown as { __jsonEngine?: Engine };
function engine(): Engine {
  return (g.__jsonEngine ??= new Engine(getStore()));
}

/** A PrismaClient-shaped client over the shared JSON store. */
export function createJsonClient(): Record<string, unknown> {
  return makeClient(engine(), getStore(), []);
}

/** Throws away every change and reloads the pristine mock data (Settings → Demo data → Reset). */
export function resetJsonData() {
  getStore().reset();
  engine().writes++;
}

export { getStore };
