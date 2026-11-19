import type { LeaveType } from "@prisma/client";
import { Pencil, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Field, FormGrid, Input, Checkbox } from "@/components/ui";
import { ModalForm, ActionForm, ActionButton } from "@/components/ui/client";
import { carryForwardAction, saveHrRulesAction, saveLeaveTypeAction } from "../actions";

export const metadata = { title: "Leave types & rules" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function TypeFields({ t }: { t?: LeaveType }) {
  return (
    <FormGrid cols={2}>
      <Field label="Name" required><Input name="name" defaultValue={t?.name} required maxLength={60} placeholder="e.g. Casual leave" /></Field>
      <Field label="Short code" required hint="e.g. CL, SL, EL"><Input name="code" defaultValue={t?.code} required maxLength={8} /></Field>
      <Field label="Days per academic year" hint="Ignored for unpaid leave"><Input name="daysPerYear" type="number" min={0} max={365} defaultValue={t?.daysPerYear ?? 12} /></Field>
      <Field label="Carry forward up to" hint="Unused days moved to next year (0 = none)"><Input name="carryForwardMax" type="number" min={0} max={365} defaultValue={t?.carryForwardMax ?? 0} /></Field>
      <Field label="Order in lists"><Input name="sortOrder" type="number" min={0} defaultValue={t?.sortOrder ?? 0} /></Field>
      <div className="flex flex-col justify-end gap-2 pb-1">
        <Checkbox name="isPaid" value="true" defaultChecked={t?.isPaid ?? true} label="Paid leave (has a yearly limit)" />
        <Checkbox name="allowHalfDay" value="true" defaultChecked={t?.allowHalfDay ?? true} label="Can be taken as a half day" />
        <Checkbox name="isActive" value="true" defaultChecked={t?.isActive ?? true} label="In use" />
      </div>
    </FormGrid>
  );
}

export default async function HrRulesPage() {
  const user = await requireUser("hr.manage");
  const [types, rules] = await Promise.all([
    db.leaveType.findMany({ where: { branchId: user.branchId }, include: { _count: { select: { requests: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getSetting("hr", user.branchId),
  ]);
  return (
    <>
      <PageHeader title="Leave types & rules" breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Leave types & rules" }]}
        description="Leave types and yearly allowances, school hours for late marking, and weekly offs. School holidays come from Circulars & events (type Holiday)." />
      <Card>
        <CardHeader title="Leave types" actions={<>
          <ActionButton action={carryForwardAction} args={{}} confirm="Carry each person's unused leave from last academic year into this year, up to each type's carry-forward limit?" successMessage="@result">Carry forward from last year</ActionButton>
          <ModalForm trigger="Add leave type" triggerSize="sm" icon={<Plus className="size-4" />} title="Add leave type" action={saveLeaveTypeAction} successMessage="Leave type added"><TypeFields /></ModalForm>
        </>} />
        <Table>
          <THead><tr><TH>Leave type</TH><TH align="right">Days / year</TH><TH align="right">Carry forward</TH><TH>Half day</TH><TH align="right">Requests</TH><TH /></tr></THead>
          <TBody>
            {types.length === 0 && <EmptyRow colSpan={6} message="No leave types yet. Add Casual, Sick and Earned leave to start." />}
            {types.map((t) => (
              <TR key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <TD><span className="font-medium text-ink">{t.name}</span> <Badge>{t.code}</Badge>{!t.isPaid && <Badge tone="yellow" className="ml-1">Unpaid</Badge>}{!t.isActive && <Badge className="ml-1">Not in use</Badge>}</TD>
                <TD align="right">{t.isPaid ? t.daysPerYear : "No limit"}</TD>
                <TD align="right">{t.carryForwardMax || "—"}</TD>
                <TD>{t.allowHalfDay ? "Yes" : "No"}</TD>
                <TD align="right">{t._count.requests}</TD>
                <TD align="right"><ModalForm trigger="Edit" triggerVariant="ghost" triggerSize="sm" icon={<Pencil className="size-4" />} title={`Edit ${t.name}`} action={saveLeaveTypeAction} extra={{ id: t.id }} successMessage="Saved"><TypeFields t={t} /></ModalForm></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card className="mt-5">
        <CardHeader title="Attendance rules" />
        <CardBody>
          <ActionForm action={saveHrRulesAction} successMessage="Rules saved" submitLabel="Save rules">
            <FormGrid cols={2}>
              <Field label="School starts at" required hint="Phone check-ins after this time plus the grace minutes are marked late"><Input name="workStart" type="time" defaultValue={rules.workStart} required /></Field>
              <Field label="Grace minutes" required><Input name="lateGraceMinutes" type="number" min={0} max={240} defaultValue={rules.lateGraceMinutes} required /></Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium text-ink">Weekly off</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">{DAYS.map((d) => <Checkbox key={d} name="weeklyOff[]" value={d} defaultChecked={rules.weeklyOff.includes(d)} label={d} />)}</div>
              </fieldset>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium text-ink">Saturdays off</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">{[1, 2, 3, 4, 5].map((n) => <Checkbox key={n} name="offSaturdays[]" value={String(n)} defaultChecked={rules.offSaturdays.includes(n)} label={`${["1st", "2nd", "3rd", "4th", "5th"][n - 1]} Saturday`} />)}</div>
              </fieldset>
              <div className="sm:col-span-2"><Checkbox name="selfCheckIn" value="true" defaultChecked={rules.selfCheckIn} label="Staff may check in and out from their phone (My leave & attendance)" /></div>
            </FormGrid>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
