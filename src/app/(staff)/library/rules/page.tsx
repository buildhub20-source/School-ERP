import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardBody, Field, FormGrid, Input } from "@/components/ui";
import { ActionForm } from "@/components/ui/client";
import { saveLibraryRulesAction } from "../actions";

export const metadata = { title: "Library rules" };

export default async function LibraryRulesPage() {
  const user = await requireUser("library.manage");
  const r = await getSetting("library", user.branchId);
  return (
    <>
      <PageHeader title="Library rules" description="Loan periods, borrowing limits and late fines. Fines apply to students only and are added to their fee account when the book comes back." breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Rules" }]} />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={saveLibraryRulesAction} successMessage="Rules saved">
            <FormGrid cols={2}>
              <Field label="Loan period for students (days)" required><Input name="studentLoanDays" type="number" min={1} defaultValue={r.studentLoanDays} required /></Field>
              <Field label="Loan period for staff (days)" required><Input name="staffLoanDays" type="number" min={1} defaultValue={r.staffLoanDays} required /></Field>
              <Field label="Books a student can hold" required><Input name="maxBooksStudent" type="number" min={1} defaultValue={r.maxBooksStudent} required /></Field>
              <Field label="Books a staff member can hold" required><Input name="maxBooksStaff" type="number" min={1} defaultValue={r.maxBooksStaff} required /></Field>
              <Field label="Renewals allowed per loan" required><Input name="maxRenewals" type="number" min={0} defaultValue={r.maxRenewals} required /></Field>
              <Field label="Grace days before a fine" required><Input name="graceDays" type="number" min={0} defaultValue={r.graceDays} required /></Field>
              <Field label="Fine per late day (₹)" required hint="0 = no fines"><Input name="finePerDay" type="number" min={0} step="0.5" defaultValue={r.finePerDay} required /></Field>
              <Field label="Maximum fine per book (₹)" required><Input name="maxFine" type="number" min={0} step="1" defaultValue={r.maxFine} required /></Field>
            </FormGrid>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
