import { Prisma } from "@prisma/client";

/**
 * Schema metadata for the JSON data engine, read from the generated Prisma client (Prisma.dmmf), so prisma/schema.prisma
 * stays the single source of truth for tables, relations, defaults and unique keys.
 */

export type ScalarField = {
  name: string;
  type: string; // String, Int, Float, Decimal, DateTime, Boolean, Json, BigInt, or an enum name
  isList: boolean;
  isRequired: boolean;
  isUpdatedAt: boolean;
  default?: unknown; // { name: "cuid" | "uuid" | "now" } or a literal
};

export type RelationField = {
  name: string;
  model: string; // related model
  isList: boolean;
  /** Fields on THIS row that hold the foreign key (empty when the key lives on the other side). */
  from: string[];
  /** Fields on the RELATED row matched by `from` (when this side holds the key), else the related row's key fields. */
  to: string[];
  /** When the key lives on the other side: the related model's fields pointing at our `refs`. */
  otherFrom: string[];
  /** Our fields the other side points at. */
  refs: string[];
  onDelete?: string;
  isRequired: boolean;
};

export type ModelMeta = {
  name: string;
  scalars: Map<string, ScalarField>;
  relations: Map<string, RelationField>;
  /** Unique keys (single or compound), including the id. Compound names follow Prisma: a_b. */
  uniques: { name: string; fields: string[] }[];
};

type DField = Prisma.DMMF.Field;

function build(): Map<string, ModelMeta> {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  const out = new Map<string, ModelMeta>();
  for (const m of models) {
    const scalars = new Map<string, ScalarField>();
    const relations = new Map<string, RelationField>();
    for (const f of m.fields as DField[]) {
      if (f.kind === "object") {
        const other = byName.get(f.type)!;
        const back = (other.fields as DField[]).find((o) => o.relationName === f.relationName && !(other.name === m.name && o.name === f.name));
        const from = (f.relationFromFields ?? []) as string[];
        if (!from.length && !(back?.relationFromFields ?? []).length) throw new Error(`json-db: implicit many-to-many ${m.name}.${f.name} is not supported`);
        relations.set(f.name, {
          name: f.name, model: f.type, isList: f.isList, isRequired: f.isRequired,
          from, to: (f.relationToFields ?? []) as string[],
          otherFrom: from.length ? [] : ((back!.relationFromFields ?? []) as string[]),
          refs: from.length ? [] : ((back!.relationToFields ?? []) as string[]),
          onDelete: from.length ? f.relationOnDelete : undefined,
        });
      } else {
        scalars.set(f.name, { name: f.name, type: f.type, isList: f.isList, isRequired: f.isRequired, isUpdatedAt: !!f.isUpdatedAt, default: f.hasDefaultValue ? f.default : undefined });
      }
    }
    const uniques: { name: string; fields: string[] }[] = [];
    for (const f of m.fields as DField[]) if (f.kind !== "object" && (f.isId || f.isUnique)) uniques.push({ name: f.name, fields: [f.name] });
    if (m.primaryKey) uniques.push({ name: m.primaryKey.name ?? m.primaryKey.fields.join("_"), fields: [...m.primaryKey.fields] });
    for (const u of m.uniqueIndexes) uniques.push({ name: u.name ?? u.fields.join("_"), fields: [...u.fields] });
    out.set(m.name, { name: m.name, scalars, relations, uniques });
  }
  return out;
}

export const SCHEMA = build();
export const MODEL_NAMES = [...SCHEMA.keys()];

export function meta(model: string): ModelMeta {
  const m = SCHEMA.get(model);
  if (!m) throw new Error(`json-db: unknown model ${model}`);
  return m;
}

/** Delegate name (db.studentFee) → model name (StudentFee). */
export const DELEGATES = new Map(MODEL_NAMES.map((n) => [n.charAt(0).toLowerCase() + n.slice(1), n]));
