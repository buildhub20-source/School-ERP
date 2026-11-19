import Link from "next/link";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { fmtDate, fullName } from "@/lib/format";

export const metadata = { title: "Verify student ID" };

/**
 * Opened from the QR code on a student ID card. Requires sign-in. Parents can only verify their own children,
 * drivers/attendants only students allocated to their bus, other staff only students of their branch (Super Admin: any).
 */
export default async function VerifyStudent({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const isParent = user.permissions.includes("parent.portal");
  const isDriver = user.permissions.includes("driver.portal");
  const scope = isParent ? { guardians: { some: { guardian: { userId: user.id } } } }
    : isDriver ? { allocations: { some: { status: "ACTIVE" as const, bus: { OR: [{ driver: { userId: user.id } }, { attendant: { userId: user.id } }] } } } }
    : user.roleKey === "SUPER_ADMIN" ? {} : { branchId: user.branchId };
  const s = await db.student.findFirst({
    where: { id, ...scope },
    include: { schoolClass: true, section: true, branch: true },
  });
  const [school, year] = await Promise.all([getSetting("school", s?.branchId ?? null), db.academicYear.findFirst({ where: { isCurrent: true } })]);
  const valid = !!s && s.status === "ACTIVE";
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-line bg-surface-2 px-5 py-3 text-center text-ink">
          <p className="text-sm font-semibold">{school.name}</p>
          <p className="text-xs opacity-80">Student ID verification</p>
        </div>
        {!s ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600"><ShieldAlert className="size-6" /></div>
            <h1 className="font-semibold">Card not recognised</h1>
            <p className="mt-1 text-sm text-slate-500">No student record matches this ID card{isParent ? " among your children" : isDriver ? " on your bus" : ""}.</p>
          </div>
        ) : (
          <div className="p-6 text-center">
            {s.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={s.photoUrl} alt="" className="mx-auto size-28 rounded-xl object-cover" />
              : <div className="mx-auto grid size-28 place-items-center rounded-xl bg-slate-100 text-4xl font-semibold text-slate-400">{s.firstName.charAt(0)}</div>}
            <h1 className="mt-4 text-lg font-semibold">{fullName(s)}</h1>
            <p className="text-sm text-slate-600">{s.schoolClass.name}{s.section ? ` - ${s.section.name}` : ""} · {s.admissionNo}</p>
            <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${valid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {valid ? <BadgeCheck className="size-4" /> : <ShieldAlert className="size-4" />}
              {valid ? `Valid${year ? ` till ${fmtDate(year.endDate)}` : ""}` : `Not valid — student ${s.status.toLowerCase()}`}
            </div>
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3 text-center text-xs text-slate-500">
          Checked by {user.name} · <Link href="/" className="text-brand-700 hover:underline">Home</Link>
        </div>
      </div>
    </div>
  );
}
