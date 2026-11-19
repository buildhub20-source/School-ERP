import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDateTime, fullName } from "@/lib/format";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Field, FormGrid, Input, StatusBadge, Tabs } from "@/components/ui";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { createOutpassAction, markReturnedAction } from "../actions";
import { StudentPicker } from "../_components/student-picker";

export const metadata = { title: "Outpasses" };

export default async function OutpassesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hostel.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const tab = sp(s, "tab") ?? "out";
  const now = new Date();
  const where: Prisma.HostelOutpassWhereInput = { branchId: user.branchId, ...(tab === "out" ? { returnedAt: null } : tab === "returned" ? { returnedAt: { not: null } } : {}) };
  const [total, passes, outCount] = await Promise.all([
    db.hostelOutpass.count({ where }),
    db.hostelOutpass.findMany({ where, include: { student: { include: { schoolClass: true } } }, orderBy: tab === "out" ? { expectedReturn: "asc" } : { outAt: "desc" }, skip, take }),
    db.hostelOutpass.count({ where: { branchId: user.branchId, returnedAt: null } }),
  ]);
  const canIssue = hasPerm(user, "hostel.warden");
  const local = new Date(now.getTime() + 330 * 60000 + 24 * 3600000).toISOString().slice(0, 16);
  return (
    <>
      <PageHeader title="Outpasses" description="Residents leaving the hostel for a home visit or outing. Parents get an SMS when their child leaves and returns." breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: "Outpasses" }]}
        actions={canIssue && (
          <ModalForm trigger="New outpass" icon={<Plus className="size-4" />} title="New outpass" action={createOutpassAction} successMessage="Outpass issued · parents notified">
            <FormGrid cols={2}>
              <Field label="Resident" required className="sm:col-span-2"><StudentPicker residentsOnly /></Field>
              <Field label="Back by" required><Input name="expectedReturn" type="datetime-local" defaultValue={local} required /></Field>
              <Field label="Reason" required><Input name="reason" required placeholder="e.g. Home visit for the weekend" /></Field>
              <Field label="Picked up by"><Input name="escortName" placeholder="Parent / guardian name" /></Field>
              <Field label="Their phone"><Input name="escortPhone" inputMode="tel" /></Field>
            </FormGrid>
          </ModalForm>
        )} />
      <Tabs active={`/hostel/outpasses?tab=${tab}`} tabs={[{ href: "/hostel/outpasses?tab=out", label: "Out now", count: outCount }, { href: "/hostel/outpasses?tab=returned", label: "Returned" }, { href: "/hostel/outpasses?tab=all", label: "All" }]} />
      <Card>
        <Table>
          <THead><tr><TH>Student</TH><TH>Left</TH><TH>Back by</TH><TH>Reason</TH><TH>With</TH><TH>Status</TH>{canIssue && <TH />}</tr></THead>
          <TBody>
            {passes.length === 0 && <EmptyRow colSpan={7} message={tab === "out" ? "Every resident is in." : "No outpasses."} />}
            {passes.map((p) => {
              const late = !p.returnedAt && p.expectedReturn < now;
              return (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap font-medium text-ink">{fullName(p.student)}<span className="block text-xs font-normal text-muted">{p.student.schoolClass.name}</span></TD>
                  <TD className="whitespace-nowrap">{fmtDateTime(p.outAt)}</TD>
                  <TD className="whitespace-nowrap">{fmtDateTime(p.expectedReturn)}</TD>
                  <TD>{p.reason}</TD>
                  <TD>{p.escortName ?? "—"}{p.escortPhone && <span className="block text-xs text-muted">{p.escortPhone}</span>}</TD>
                  <TD>{p.returnedAt ? <StatusBadge status="DONE" label={`Back ${fmtDateTime(p.returnedAt)}`} /> : <StatusBadge status={late ? "OVERDUE" : "PENDING"} label={late ? "Late" : "Out"} />}</TD>
                  {canIssue && <TD align="right">{!p.returnedAt && <ActionButton action={markReturnedAction} args={{ id: p.id }} successMessage="Marked back · parents notified">Back now</ActionButton>}</TD>}
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/hostel/outpasses" />
      </Card>
    </>
  );
}
