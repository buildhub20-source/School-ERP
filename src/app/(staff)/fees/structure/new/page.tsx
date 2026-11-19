import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { currentAcademicYear } from "@/lib/settings";
import { PageHeader, Card } from "@/components/ui";
import { isoDate, today } from "@/lib/format";
import { OtherFeeForm } from "../../fee-forms";

export const metadata = { title: "Add new fee" };

export default async function NewFeePage() {
  const user = await requireUser("fees.setup");
  const [year, classes] = await Promise.all([currentAcademicYear(), db.schoolClass.findMany({ where: { branchId: user.branchId }, orderBy: { grade: "asc" } })]);
  return (
    <>
      <PageHeader title="Add new fee" description={`Creates a new fee (e.g. Miscellaneous Fee) in the Fee structure${year ? ` for ${year.name}` : ""} with an amount for each class. Students are billed when dues are generated.`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Fee structure", href: "/fees/structure" }, { label: "Add new fee" }]} />
      {!year ? <Card><div className="p-5">Set the current academic year first (Settings → Academic years).</div></Card> : (
        <Card><div className="p-5 sm:p-6">
          <OtherFeeForm terms={year.terms.map((t) => ({ value: t.id, label: t.name }))} classes={classes.map((c) => ({ id: c.id, name: c.name }))} today={isoDate(today())} backTo="/fees/structure" />
        </div></Card>
      )}
    </>
  );
}
