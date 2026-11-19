import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { canPay, safeReturnTo } from "@/server/fees/payments";
import { fullName, money } from "@/lib/format";
import { fill, statusLabel, type DictKey } from "@/lib/i18n/dict";

export async function loadCheckout(paymentId: string, sp: Record<string, string | undefined>) {
  const user = await requireUser();
  const p = await canPay(user, paymentId);
  if (!p) notFound();
  const returnTo = safeReturnTo(sp.returnTo, user.permissions.includes("parent.portal") ? "/parent/fees" : `/fees/accounts/${p.studentId}`);
  if (p.status === "SUCCESS") redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}payment=success&receipt=${encodeURIComponent(p.receiptNo ?? "")}`);
  const school = await getSetting("school", p.branchId);
  return { user, p, returnTo, school };
}

export function CheckoutFrame({ t, school, title, p, children, badge }: { t: (k: DictKey) => string; school: { name: string }; title: string; badge?: string; p: { amount: unknown; purpose: string; status: string; student: { firstName: string; lastName: string | null; admissionNo: string; schoolClass: { name: string } } }; children: React.ReactNode; returnTo: string }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div><p className="text-xs uppercase tracking-wide text-slate-500">{title}</p><h1 className="text-lg font-semibold">{school.name}</h1></div>
          {badge && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">{badge}</span>}
        </div>
        <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="text-slate-500">{p.purpose === "UNIFORM" ? t("pay.uniformFor") : t("pay.feesFor")}</p>
          <p className="font-medium">{fullName(p.student)} · {p.student.schoolClass.name} · {p.student.admissionNo}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{money(p.amount as number)}</p>
        </div>
        {p.status === "PENDING" ? children : <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{fill(t("pay.notPending"), { status: (statusLabel(t, p.status) ?? p.status).toLowerCase() })}</p>}
        <p className="mt-4 text-center text-xs text-slate-400"><Link href="/" className="hover:underline">{t("pay.backToPortal")}</Link></p>
      </div>
    </div>
  );
}
