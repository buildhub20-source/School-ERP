import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { MODEL_NAMES, meta } from "./schema";

/**
 * In-memory tables for the JSON data engine, loaded from JSON and saved back to JSON.
 *
 *   data/demo-data.json   pristine mock data (read-only snapshot, committed with the code)
 *   .poc/data.json        working copy: every change is saved here (debounced), so edits survive refreshes and restarts
 *
 * "Reset demo data" (Settings → Demo data) throws the working copy away and reloads the snapshot.
 * Rows are replaced, never mutated in place, so a transaction can roll back by restoring the table arrays.
 */

export type Row = Record<string, unknown>;

const ROOT = process.cwd();
export const SNAPSHOT_FILE = path.join(ROOT, "data", "demo-data.json");
// Serverless hosts (Netlify Functions / AWS Lambda) have a read-only app folder; only the temp dir is writable.
// There the working copy lives in /tmp: changes last while the function instance stays warm, then reset to the snapshot.
const SERVERLESS = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY);
export const WORKING_FILE = process.env.JSON_DB_FILE
  ? path.resolve(process.env.JSON_DB_FILE)
  : SERVERLESS
    ? path.join(os.tmpdir(), "school-erp", "data.json")
    : path.join(ROOT, ".poc", "data.json");
const DAY = 86_400_000;

export class Store {
  tables = new Map<string, Row[]>();
  byId = new Map<string, Map<string, Row>>();
  loadedFrom = "";
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor() {
    this.load();
  }

  /** Converts JSON values back to the types Prisma returns (Date, Decimal, BigInt) using the schema. */
  private hydrate(model: string, raw: Row, shiftMs: number): Row {
    const m = meta(model);
    const row: Row = {};
    for (const [name, f] of m.scalars) {
      let v = raw[name];
      if (v === undefined) v = f.isList ? [] : null;
      if (v !== null && !f.isList) {
        if (f.type === "DateTime") v = new Date(new Date(v as string).getTime() + shiftMs);
        else if (f.type === "Decimal") v = new Prisma.Decimal(v as string);
        else if (f.type === "BigInt") v = BigInt(v as string);
      }
      row[name] = v;
    }
    return row;
  }

  private load(fromSnapshot = false) {
    const useWorking = !fromSnapshot && fs.existsSync(WORKING_FILE);
    const file = useWorking ? WORKING_FILE : SNAPSHOT_FILE;
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { exportedAt: string; tables: Record<string, Row[]> };
    // A fresh snapshot is moved forward towards today so "today", "overdue" and "this month" stay meaningful whenever the
    // demo is opened. It moves in whole weeks, so weekday-bound data (attendance, weekly offs) stays on the right weekday;
    // the newest data is therefore at most 6 days old. The working copy is already current and is never shifted.
    const shiftMs = useWorking ? 0 : Math.max(0, Math.floor((Date.now() - new Date(json.exportedAt).getTime()) / (7 * DAY))) * 7 * DAY;
    this.tables.clear();
    for (const model of MODEL_NAMES) this.tables.set(model, (json.tables[model] ?? []).map((r) => this.hydrate(model, r, shiftMs)));
    this.reindex();
    this.loadedFrom = file;
    if (!useWorking) this.saveNow();
  }

  reindex(models: Iterable<string> = MODEL_NAMES) {
    for (const model of models) {
      if (!meta(model).scalars.has("id")) continue;
      this.byId.set(model, new Map(this.tables.get(model)!.map((r) => [r.id as string, r])));
    }
  }

  rows(model: string): Row[] {
    return this.tables.get(model)!;
  }

  insert(model: string, row: Row) {
    this.tables.get(model)!.push(row);
    if (row.id !== undefined) this.byId.get(model)?.set(row.id as string, row);
    this.touch();
  }

  replace(model: string, oldRow: Row, newRow: Row) {
    const t = this.tables.get(model)!;
    t[t.indexOf(oldRow)] = newRow;
    const idx = this.byId.get(model);
    if (idx) {
      if (oldRow.id !== newRow.id) idx.delete(oldRow.id as string);
      idx.set(newRow.id as string, newRow);
    }
    this.touch();
  }

  remove(model: string, rows: Set<Row>) {
    if (!rows.size) return;
    this.tables.set(model, this.tables.get(model)!.filter((r) => !rows.has(r)));
    const idx = this.byId.get(model);
    if (idx) for (const r of rows) idx.delete(r.id as string);
    this.touch();
  }

  /** Shallow copy of every table (rows are immutable), used to roll back a failed transaction. */
  snapshot(): Map<string, Row[]> {
    return new Map([...this.tables].map(([k, v]) => [k, v.slice()]));
  }

  restore(snap: Map<string, Row[]>) {
    this.tables = snap;
    this.reindex();
    this.touch();
  }

  /** Throws away all changes and reloads the pristine mock data. */
  reset() {
    this.load(true);
  }

  private touch() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, 800);
    this.saveTimer.unref?.();
  }

  saveNow() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const tables = Object.fromEntries(this.tables);
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), tables }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    try {
      fs.mkdirSync(path.dirname(WORKING_FILE), { recursive: true });
      const tmp = `${WORKING_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, WORKING_FILE);
    } catch (err) {
      // The data stays correct in memory; a failed save must never take the site down.
      console.warn(`[json-db] could not save ${WORKING_FILE}: ${(err as Error).message}`);
    }
    this.dirty = false;
  }

  flush() {
    if (this.dirty) this.saveNow();
  }
}

const g = globalThis as unknown as { __jsonStore?: Store };
export function getStore(): Store {
  if (!g.__jsonStore) {
    g.__jsonStore = new Store();
    process.once("beforeExit", () => g.__jsonStore?.flush());
    process.once("exit", () => g.__jsonStore?.flush());
  }
  return g.__jsonStore;
}
