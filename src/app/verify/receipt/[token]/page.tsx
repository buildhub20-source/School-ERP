import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { fmtDateTime, money } from "@/lib/format";
import { CheckCircle2, XCircle } from "lucide-react";

export const metadata = { title: "Verify receipt", robots: { index: false } };

/** Public receipt verification (QR code on the receipt). Shows only what's needed: no surname, no amounts breakdown. */
export default async function VerifyReceipt({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = /^[a-z0-9-]{10,40}$/i.test(token) ? await db.payment.findUnique({ where: { verifyToken: token }, include: { student: { include: { schoolClass: true } } } }) : null;
  const school = await getSetting("school", p?.branchId ?? null);
  const valid = p?.status === "SUCCESS" && !!p.receiptNo;
  const label = !p || !p.receiptNo ? "Not found" : valid ? "Valid receipt" : p.status === "BOUNCED" ? "Cancelled — cheque bounced" : p.status === "CANCELLED" ? "Cancelled" : p.status.toLowerCase();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">{school.name}</p>
        <p className="text-xs text-slate-500">Receipt verification</p>
        <div className={`mx-auto mt-5 grid size-14 place-items-center rounded-full ${valid ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
          {valid ? <CheckCircle2 className="size-8" /> : <XCircle className="size-8" />}
        </div>
        <h1 className={`mt-3 text-lg font-semibold ${valid ? "text-emerald-700" : "text-rose-700"}`}>{label}</h1>
        {p && p.receiptNo ? (
          <dl className="mt-5 space-y-2 text-left text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Receipt no</dt><dd className="font-mono text-xs font-medium">{p.receiptNo}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Date</dt><dd>{fmtDateTime(p.paidAt)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Amount</dt><dd className="font-semibold">{money(p.amount)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Student</dt><dd>{p.student.firstName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Class</dt><dd>{p.student.schoolClass.name}</dd></div>
          </dl>
        ) : <p className="mt-3 text-sm text-slate-500">No receipt matches this code. Please contact the school office.</p>}
      </div>
    </div>
  );
}
