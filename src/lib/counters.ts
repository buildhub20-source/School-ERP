import { db, type DbOrTx } from "./db";

/**
 * Atomically get the next number for a sequence, e.g. nextNumber("RCPT-2026-27") → 1, 2, 3 …
 * (The JSON data engine runs each operation in one step, so this upsert cannot interleave with another.)
 */
export async function nextNumber(key: string, client: DbOrTx = db): Promise<number> {
  const row = await client.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return Number(row.value);
}

export async function nextCode(prefix: string, scope: string, pad = 5, client: DbOrTx = db): Promise<string> {
  const n = await nextNumber(`${prefix}-${scope}`, client);
  return `${prefix}/${scope}/${String(n).padStart(pad, "0")}`;
}
