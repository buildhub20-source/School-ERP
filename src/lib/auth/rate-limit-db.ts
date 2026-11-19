import "server-only";
import { db } from "../db";

/**
 * Fixed-window rate limit kept in the data store, so it holds across restarts (the in-memory limit in the middleware
 * is only a first line). Expired windows restart at 1.
 */
export async function hitRateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const cur = await db.rateLimit.findUnique({ where: { key } });
  const r = !cur || cur.resetAt < now
    ? await db.rateLimit.upsert({ where: { key }, create: { key, count: 1, resetAt }, update: { count: 1, resetAt } })
    : await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  return { ok: r.count <= limit, retryAfter: Math.max(0, Math.ceil((r.resetAt.getTime() - Date.now()) / 1000)) };
}
