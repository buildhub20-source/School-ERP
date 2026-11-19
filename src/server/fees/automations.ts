import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { addDays, daysBetween, fullName, isoDate, money, round2, toNum, today, fmtDate } from "@/lib/format";
import { notifyGuardians, notifyPermission, sendExternal } from "@/lib/messaging/notify";
import type { Policies } from "@/lib/settings";
import { generateDues, recalcFee } from "./core";
import { istDayRange, MODE_LABEL } from "./access";
import { reconcileOnlinePayments } from "./payments";

/** "New term starts": generate dues from the fee structure (term 1 also brings the annual fees). */
export async function feeTermDues(c: Record<string, unknown>): Promise<string> {
  const before = Math.max(0, Number(c.daysBeforeTermStart ?? 0) || 0);
  const horizon = addDays(today(), before);
  const terms = await db.term.findMany({ where: { duesGeneratedAt: null, startDate: { lte: horizon }, academicYear: { closedAt: null } }, include: { academicYear: true }, orderBy: { startDate: "asc" } });
  if (!terms.length) return "No term is starting; nothing to generate";
  const parts: string[] = [];
  for (const t of terms) {
    const created = await generateDues({ academicYearId: t.academicYearId, termId: t.id, includeAnnual: t.sequence === 1 });
    await db.term.update({ where: { id: t.id }, data: { duesGeneratedAt: new Date() } });
    parts.push(`${t.academicYear.name} ${t.name}: ${created} student-fee entries`);
    await notifyPermission("fees.collect", { title: `Fee dues generated for ${t.name}`, body: `${created} student-fee entries were created from the fee structure (${t.academicYear.name}).`, link: "/fees/accounts", category: "FEES" });
  }
  return `Generated dues — ${parts.join("; ")}`;
}

/** Reminders N days before the due date (default 7 and 1) with a pay-now link. Deduped with StudentFee.lastReminderDays. */
export async function feeReminders(c: Record<string, unknown>): Promise<string> {
  const raw = Array.isArray(c.daysBefore) ? c.daysBefore : [7, 1];
  const days = [...new Set(raw.map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0))].sort((a, b) => b - a);
  let students = 0, lines = 0;
  for (const n of days) {
    const due = addDays(today(), n);
    const open = await db.studentFee.findMany({
      where: { dueDate: due, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 }, student: { status: "ACTIVE" }, OR: [{ lastReminderDays: null }, { lastReminderDays: { not: n } }] },
      include: { student: { include: { schoolClass: true } } },
    });
    const byStudent = new Map<string, typeof open>();
    for (const f of open) byStudent.set(f.studentId, [...(byStudent.get(f.studentId) ?? []), f]);
    for (const [studentId, fs] of byStudent) {
      const s = fs[0].student;
      const amount = round2(fs.reduce((x, f) => x + toNum(f.balance), 0));
      await notifyGuardians(studentId, {
        title: n === 0 ? "Fee due today" : `Fee due in ${n} day${n === 1 ? "" : "s"}`,
        body: `Dear parent, ${money(amount)} (${fs.map((f) => f.description).join(", ")}) for ${fullName(s)} (${s.schoolClass.name}) is due on ${fmtDate(due)}. Pay now:`,
        link: "/parent/fees", category: "FEES", channels: ["SMS", "WHATSAPP", "EMAIL"], template: "FEE_REMINDER",
        ta: {
          title: n === 0 ? "கட்டணம் இன்று செலுத்த வேண்டும்" : `கட்டணம் ${n} நாளில் செலுத்த வேண்டும்`,
          body: `அன்புள்ள பெற்றோரே, ${fullName(s)} (${s.schoolClass.name}) க்கான ${money(amount)} (${fs.map((f) => f.description).join(", ")}) ${fmtDate(due)} அன்று செலுத்த வேண்டும். இப்போது செலுத்த:`,
        },
      });
      await db.studentFee.updateMany({ where: { id: { in: fs.map((f) => f.id) } }, data: { lastReminderDays: n } });
      students++;
      lines += fs.length;
    }
  }
  return `Sent due-date reminders to ${students} families (${lines} fee lines; days before: ${days.join(", ")})`;
}

/** Late fee for one overdue line under the policy (before cap / never below the current value). */
export function lateFeeFor(policy: Policies["lateFee"], line: { amount: unknown; concessionAmount: unknown; dueDate: Date }, onDate: Date): number {
  if (!policy.enabled || !(policy.amount > 0)) return 0;
  const daysLate = daysBetween(line.dueDate, onDate) - Math.max(0, policy.graceDays || 0);
  if (daysLate <= 0) return 0;
  let fee = 0;
  if (policy.type === "FIXED") fee = policy.amount;
  else if (policy.type === "PER_DAY") fee = policy.amount * daysLate;
  else if (policy.type === "PERCENT") fee = (Math.max(0, toNum(line.amount as number) - toNum(line.concessionAmount as number)) * policy.amount) / 100;
  if (policy.maxAmount > 0) fee = Math.min(fee, policy.maxAmount);
  return round2(fee);
}

/**
 * "Due date passes": apply policies.lateFee to open, overdue lines whose fee head has late fee enabled. Idempotent:
 * the late fee is set to the policy value for today and never lowered (waivers go through adjustments).
 * Lines that cross the defaulter threshold appear on the defaulter list automatically.
 */
export async function feeLateFees(_c: Record<string, unknown> = {}): Promise<string> {
  const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
  let updated = 0, added = 0, disabled = 0;
  for (const b of branches) {
    const policies = await getSetting("policies", b.id);
    const policy = policies.lateFee;
    if (!policy.enabled) { disabled++; continue; }
    const open = await db.studentFee.findMany({
      where: { student: { branchId: b.id }, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 }, dueDate: { lt: today() }, feeHead: { lateFeeApplies: true } },
    });
    for (const f of open) {
      const target = lateFeeFor(policy, f, today());
      const current = toNum(f.lateFeeAmount);
      if (target - current <= 0.009) continue;
      await db.$transaction(async (tx) => {
        await tx.studentFee.update({ where: { id: f.id }, data: { lateFeeAmount: target } });
        await recalcFee(tx, f.id);
      });
      added = round2(added + target - current);
      updated++;
    }
  }
  if (disabled === branches.length) return "Late fee is switched off in Policies; nothing applied";
  return `Late fee applied/updated on ${updated} fee lines (total added ${money(added)})`;
}

/** "End of day": email the day's collection summary to Accountants and the Principal. Also runs online reconciliation. */
export async function feeDailySummary(_c: Record<string, unknown> = {}): Promise<string> {
  const rec = await reconcileOnlinePayments();
  const branches = await db.branch.findMany({ where: { isActive: true } });
  const date = isoDate();
  const out: string[] = [];
  for (const b of branches) {
    const range = istDayRange(date);
    const [ok, pending] = await Promise.all([
      db.payment.findMany({ where: { branchId: b.id, status: "SUCCESS", paidAt: range } }),
      db.payment.aggregate({ where: { branchId: b.id, status: "PENDING", source: "ONLINE" }, _sum: { amount: true }, _count: true }),
    ]);
    const byMode: Record<string, { count: number; amount: number }> = {};
    for (const p of ok) {
      const m = (byMode[p.mode] ??= { count: 0, amount: 0 });
      m.count++;
      m.amount = round2(m.amount + toNum(p.amount));
    }
    const total = round2(ok.reduce((s, p) => s + toNum(p.amount), 0));
    const feeTotal = round2(ok.filter((p) => p.purpose === "FEE").reduce((s, p) => s + toNum(p.amount), 0));
    const lines = Object.entries(byMode).map(([m, v]) => `  ${MODE_LABEL[m].padEnd(14)} ${String(v.count).padStart(4)}  ${money(v.amount)}`);
    const body = [
      `Collection summary for ${fmtDate(new Date(date))} — ${b.name}`, "",
      ...(lines.length ? lines : ["  No collections today."]), "",
      `Receipts: ${ok.length}   Total: ${money(total)} (fees ${money(feeTotal)}, uniforms ${money(round2(total - feeTotal))})`,
      `Online payments pending: ${pending._count} (${money(pending._sum.amount)})`,
      rec.summary,
    ].join("\n");
    const subject = `Fee collection ${date}: ${money(total)} (${ok.length} receipts)`;
    await notifyPermission("fees.collect", { title: subject, body, link: `/fees/cashbook?date=${date}`, category: "FEES", channels: ["EMAIL"] }, b.id);
    const school = await getSetting("school", b.id);
    if (school.principalEmail) await sendExternal("EMAIL", school.principalEmail, { subject, body, category: "FEES", branchId: b.id });
    out.push(`${b.code}: ${money(total)} / ${ok.length} receipts`);
  }
  return `Daily summary sent — ${out.join("; ")}. ${rec.summary}`;
}
