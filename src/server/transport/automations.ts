import "server-only";
import { db } from "@/lib/db";
import { notifyPermission } from "@/lib/messaging/notify";
import { fmtDate, today } from "@/lib/format";
import { DOC_LABELS, daysUntil, serviceDueInfo } from "./helpers";

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/**
 * Scheduled "transport.docExpiry": current documents expiring within `daysBefore` days (or already expired) alert the
 * Transport Managers of the branch; repeated every `repeatEveryDays` (tracked by lastAlertAt) until the document is renewed.
 */
export async function transportDocExpiry(c: Record<string, unknown>): Promise<string> {
  const daysBefore = num(c.daysBefore, 30);
  const repeat = Math.max(1, num(c.repeatEveryDays, 7));
  const t = today();
  const limit = new Date(t.getTime() + daysBefore * 86400000);
  const repeatCutoff = new Date(Date.now() - repeat * 86400000 + 3600000); // 1 h slack so a daily job at the same time still repeats on day N
  const docs = await db.transportDocument.findMany({
    where: { isCurrent: true, expiryDate: { lte: limit }, OR: [{ lastAlertAt: null }, { lastAlertAt: { lte: repeatCutoff } }] },
    include: { bus: true, staff: true },
    orderBy: { expiryDate: "asc" },
  });
  const byBranch = new Map<string, typeof docs>();
  for (const d of docs) {
    const branchId = d.bus?.branchId ?? d.staff?.branchId;
    if (!branchId) continue;
    byBranch.set(branchId, [...(byBranch.get(branchId) ?? []), d]);
  }
  for (const [branchId, list] of byBranch) {
    const lines = list.map((d) => {
      const left = daysUntil(d.expiryDate, t);
      const owner = d.bus?.busNo ?? d.staff?.name ?? "";
      return `• ${owner} — ${DOC_LABELS[d.type]}${d.number ? ` (${d.number})` : ""}: ${left < 0 ? `expired ${-left} day(s) ago` : left === 0 ? "expires today" : `expires in ${left} day(s)`} on ${fmtDate(d.expiryDate)}`;
    });
    await notifyPermission("transport.manage", {
      title: `${list.length} transport document${list.length === 1 ? "" : "s"} need renewal`,
      body: lines.join("\n"), link: "/transport/documents?status=ATTENTION", category: "TRANSPORT",
    }, branchId);
    await db.transportDocument.updateMany({ where: { id: { in: list.map((d) => d.id) } }, data: { lastAlertAt: new Date() } });
  }
  return docs.length ? `Alerted ${docs.length} expiring document(s) in ${byBranch.size} branch(es)` : "No documents due for an alert";
}

/**
 * Scheduled "transport.serviceDue": a bus whose next service (last service date + interval days, or last service km + interval km)
 * is within `daysAhead` days / `kmAhead` km gets one OPEN MaintenanceReminder (never duplicated) and the Transport Managers are alerted.
 */
export async function transportServiceDue(c: Record<string, unknown>): Promise<string> {
  const daysAhead = num(c.daysAhead, 7);
  const kmAhead = num(c.kmAhead, 500);
  const t = today();
  const buses = await db.bus.findMany({ where: { isActive: true }, include: { reminders: { where: { status: "OPEN" } } } });
  const created: { branchId: string; text: string }[] = [];
  for (const b of buses) {
    if (b.reminders.length) continue;
    const info = serviceDueInfo(b, t, { daysAhead, kmAhead });
    if (!info.dueByDate && !info.dueByKm) continue;
    const reason = info.dueByDate && info.dueByKm ? "DATE_KM" : info.dueByKm ? "KM" : "DATE";
    // Re-check inside a transaction so two runs at the same time cannot both create a reminder.
    const made = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Bus" WHERE id = ${b.id} FOR UPDATE`;
      const open = await tx.maintenanceReminder.findFirst({ where: { busId: b.id, status: "OPEN" } });
      if (open) return false;
      await tx.maintenanceReminder.create({ data: { busId: b.id, reason, dueDate: info.nextDate, dueKm: info.nextKm } });
      return true;
    });
    if (made) created.push({ branchId: b.branchId, text: `• ${b.busNo} (${b.registrationNo}): ${info.reason} — next service ${fmtDate(info.nextDate)} or ${info.nextKm.toLocaleString("en-IN")} km (now ${b.odometerKm.toLocaleString("en-IN")} km)` });
  }
  const branches = [...new Set(created.map((x) => x.branchId))];
  for (const br of branches) {
    const lines = created.filter((x) => x.branchId === br).map((x) => x.text);
    await notifyPermission("transport.manage", { title: `${lines.length} bus${lines.length === 1 ? "" : "es"} due for service`, body: lines.join("\n"), link: "/transport/maintenance?tab=reminders", category: "TRANSPORT" }, br);
  }
  return created.length ? `Created ${created.length} service reminder(s)` : "No buses newly due for service";
}
