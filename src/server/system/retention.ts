import "server-only";
import { db } from "@/lib/db";
import { runWithContext } from "@/lib/context";

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
const num = (v: unknown, dflt: number) => (typeof v === "number" && v >= 0 ? v : dflt);

/**
 * Nightly clean-up so system tables don't grow without limit. 0 days = keep forever.
 * Business records (fees, payments, stock, orders, students) are never deleted.
 */
export async function dataRetention(config: Record<string, unknown>): Promise<string> {
  return runWithContext({ userName: "Retention", skipAudit: true }, async () => {
    const out: string[] = [];
    const gps = num(config.gpsDays, 90), msgs = num(config.messagesDays, 365), notes = num(config.notificationsDays, 180), audit = num(config.auditDays, 0);
    if (gps) out.push(`${(await db.busLocation.deleteMany({ where: { recordedAt: { lt: daysAgo(gps) } } })).count} GPS points`);
    if (msgs) out.push(`${(await db.messageLog.deleteMany({ where: { createdAt: { lt: daysAgo(msgs) } } })).count} outbox messages`);
    if (notes) out.push(`${(await db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: daysAgo(notes) } } })).count} read notifications`);
    if (audit) out.push(`${(await db.auditLog.deleteMany({ where: { createdAt: { lt: daysAgo(audit) } } })).count} audit entries`);
    out.push(`${(await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count} expired sessions`);
    out.push(`${(await db.rateLimit.deleteMany({ where: { resetAt: { lt: daysAgo(1) } } })).count} old rate-limit entries`);
    out.push(`${(await db.otpCode.deleteMany({ where: { createdAt: { lt: daysAgo(1) } } })).count} old OTPs`);
    out.push(`${(await db.automationRun.deleteMany({ where: { startedAt: { lt: daysAgo(180) } } })).count} old automation runs`);
    return `Removed ${out.join(", ")}`;
  });
}
