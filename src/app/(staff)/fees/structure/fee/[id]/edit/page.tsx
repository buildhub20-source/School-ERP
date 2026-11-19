import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { currentAcademicYear } from "@/lib/settings";
import { PageHeader, Card } from "@/components/ui";
import { isoDate, toNum, today } from "@/lib/format";
import { OtherFeeForm } from "../../../../fee-forms";

export const metadata = { title: "Edit fee" };

export default async function EditFeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("fees.setup");
  const { id } = await params;
  const head = await db.feeHead.findFirst({ where: { id, branchId: user.branchId } });
  if (!head || head.type !== "OTHER") notFound();
  const [year, classes] = await Promise.all([currentAcademicYear(), db.schoolClass.findMany({ where: { branchId: user.branchId }, orderBy: { grade: "asc" } })]);
  const lines = year ? await db.feeStructure.findMany({ where: { feeHeadId: head.id, academicYearId: year.id }, include: { _count: { select: { studentFees: true } } } }) : [];
  const perTerm = new Set(lines.map((l) => l.termId ?? "ANNUAL")).size > 1;
  const first = lines[0];

  return (
    <>
      <PageHeader title={`Edit — ${head.name}`} description="Changes apply to this year's Fee structure. Classes already billed keep their amount; only their due date can change."
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Fee structure", href: "/fees/structure" }, { label: head.name }]} />
      {!year ? <Card><div className="p-5">Set the current academic year first (Settings → Academic years).</div></Card>
        : perTerm ? <Card><div className="p-5">{head.name} is set up separately for each term. Edit it in <Link href="/fees/structure" className="text-brand-700 hover:underline">Fee structure</Link>.</div></Card>
        : (
          <Card><div className="p-5 sm:p-6">
            <OtherFeeForm terms={year.terms.map((t) => ({ value: t.id, label: t.name }))} classes={classes.map((c) => ({ id: c.id, name: c.name }))} today={isoDate(today())} backTo="/fees/structure"
              row={{
                id: head.id, name: head.name, lateFeeApplies: head.lateFeeApplies, isActive: head.isActive,
                termId: first?.termId ?? null, dueDate: first ? isoDate(first.dueDate) : isoDate(today()), instalments: first?.instalments ?? 1,
                lines: lines.map((l) => ({ classId: l.classId, amount: toNum(l.amount), billed: l._count.studentFees })),
              }} />
          </div></Card>
        )}
    </>
  );
}
