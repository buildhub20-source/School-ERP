import { requireParent } from "@/server/parent";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { fill, modeLabel, statusLabel } from "@/lib/i18n/dict";
import { MODE_LABEL } from "@/server/fees/access";
import { Card, CardHeader, StatusBadge, Badge } from "@/components/ui";
import { fullName, money, fmtDate, fmtDateTime, toNum, round2, today } from "@/lib/format";
import { PayForm } from "./pay-form";
import { FileText, Download, CheckCircle2, XCircle } from "lucide-react";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.fees") };
}

export default async function ParentFees({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { children } = await requireParent();
  const s = await searchParams;
  const { t } = await getT();
  const ids = children.map((c) => c.id);
  const [lines, payments] = await Promise.all([
    db.studentFee.findMany({ where: { studentId: { in: ids }, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] }),
    db.payment.findMany({ where: { studentId: { in: ids }, OR: [{ status: { in: ["SUCCESS", "BOUNCED", "CANCELLED"] } }, { status: "FAILED", source: "ONLINE", createdAt: { gt: new Date(Date.now() - 7 * 86400000) } }] }, orderBy: { paidAt: "desc" }, take: 60 }),
  ]);
  const td = today();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t("nav.fees")}</h1>
      {s.payment === "success" && <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{t("parent.paymentSuccess")}{s.receipt ? fill(t("parent.receiptNo"), { no: s.receipt }) : ""}. {t("parent.receiptSent")}</div>}
      {s.payment === "failed" && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><XCircle className="mt-0.5 size-4 shrink-0" />{t("parent.paymentFailed")}</div>}
      {s.payment === "cancelled" && <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">{t("parent.paymentCancelled")}</div>}
      {children.length === 0 && <Card><p className="p-5 text-sm text-slate-500">{t("parent.noChildrenFees")}</p></Card>}
      {children.map((c) => {
        const mine = lines.filter((l) => l.studentId === c.id);
        const due = round2(mine.reduce((a, l) => a + toNum(l.balance), 0));
        const overdue = round2(mine.filter((l) => l.dueDate < td).reduce((a, l) => a + toNum(l.balance), 0));
        const pays = payments.filter((p) => p.studentId === c.id);
        return (
          <section key={c.id} className="space-y-3">
            <Card>
              <CardHeader title={fullName(c)} description={`${c.schoolClass.name}${c.section ? ` - ${c.section.name}` : ""} · ${c.admissionNo}`}
                actions={<a href={`/api/fees/statement/${c.id}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><FileText className="size-4" />{t("parent.statement")}</a>} />
              <div className="grid grid-cols-2 gap-3 px-4 py-3 text-sm sm:px-5">
                <div><p className="text-xs uppercase text-slate-500">{t("parent.feesDue")}</p><p className="text-lg font-semibold tabular-nums">{money(due)}</p></div>
                <div><p className="text-xs uppercase text-slate-500">{t("parent.overdue")}</p><p className={`text-lg font-semibold tabular-nums ${overdue > 0 ? "text-rose-700" : ""}`}>{money(overdue)}</p></div>
              </div>
              {mine.length > 0 ? (
                <div className="border-t border-slate-100">
                  <PayForm studentId={c.id} labels={{ payNow: t("parent.payNow"), payAll: t("parent.payAll"), overdue: t("parent.overdue"), due: t("parent.dueOn") }}
                    lines={mine.map((l) => ({ id: l.id, description: l.description, due: fmtDate(l.dueDate), balance: toNum(l.balance), overdue: l.dueDate < td }))} />
                </div>
              ) : <p className="border-t border-slate-100 px-5 py-4 text-sm text-emerald-700">{t("parent.allPaid")}</p>}
            </Card>
            <Card>
              <CardHeader title={t("parent.paymentHistory")} />
              <ul className="divide-y divide-slate-100">
                {pays.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">{t("parent.noPayments")}</li>}
                {pays.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium tabular-nums">{money(p.amount)} <span className="font-normal text-slate-500">· {modeLabel(t, p.mode) ?? MODE_LABEL[p.mode]}{p.purpose === "UNIFORM" ? ` · ${t("parent.uniformTag")}` : ""}</span></p>
                      <p className="truncate text-xs text-slate-500">{p.receiptNo ?? t("parent.noReceipt")} · {fmtDateTime(p.paidAt)}</p>
                    </div>
                    {p.status === "SUCCESS" ? <Badge dot tone="green">{t("common.paid")}</Badge> : <StatusBadge status={p.status} label={statusLabel(t, p.status)} />}
                    {p.receiptNo && <a href={`/api/fees/receipts/${p.id}`} target="_blank" className="rounded-lg p-2 text-brand-700 hover:bg-brand-50" aria-label={t("parent.downloadReceipt")}><Download className="size-4" /></a>}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
