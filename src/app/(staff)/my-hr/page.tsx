import { LogIn, LogOut, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { addDays, fmtDate, fmtDateTime, today } from "@/lib/format";
import { ATT_LABEL, LEAVE_LABEL, dayOff, leaveBalances, myProfile, workCalendar } from "@/server/hr/service";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, EmptyState, Badge, StatusBadge } from "@/components/ui";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { applyLeaveAction, cancelLeaveAction, checkInAction, checkOutAction } from "../hr/actions";
import { LeaveFields } from "../hr/_components/fields";

export const metadata = { title: "My leave & attendance" };

const ATT_TONE = { PRESENT: "OK", LATE: "PENDING", HALF_DAY: "PARTIAL", ABSENT: "OVERDUE", ON_LEAVE: "ISSUED" } as const;
const time = (d: Date | null) => (d ? fmtDateTime(d).split(", ").pop() : "—");

export default async function MyHrPage() {
  const user = await requireUser("hr.self");
  const me = await myProfile(user.id);
  if (!me || !me.isActive) {
    return (
      <>
        <PageHeader title="My leave & attendance" />
        <EmptyState title="Your HR profile is not set up yet" description="Ask the office to add you under HR → Staff. After that you can apply for leave and check in here." />
      </>
    );
  }
  const t = today();
  const [rules, balances, leaves, recent, cal, covering] = await Promise.all([
    getSetting("hr", me.branchId),
    leaveBalances(me.branchId, me.id),
    db.leaveRequest.findMany({ where: { staffId: me.id }, include: { leaveType: true, substitute: true }, orderBy: { fromDate: "desc" }, take: 15 }),
    db.staffAttendance.findMany({ where: { staffId: me.id, date: { gte: addDays(t, -30) } }, orderBy: { date: "desc" } }),
    workCalendar(me.branchId, t, t),
    db.leaveRequest.findMany({ where: { substituteId: me.id, status: "APPROVED", toDate: { gte: t } }, include: { staff: true }, orderBy: { fromDate: "asc" } }),
  ]);
  const todayRow = recent.find((r) => r.date.getTime() === t.getTime());
  const off = dayOff(cal, t);
  const c = (s: keyof typeof ATT_LABEL) => recent.filter((r) => r.status === s).length;
  return (
    <>
      <PageHeader title="My leave & attendance" description={`${me.name} · ${me.employeeCode} · ${me.designation}`}
        actions={
          <ModalForm trigger="Apply for leave" icon={<Plus className="size-4" />} title="Apply for leave" description="Your approver is told straight away. You will get a message when it is decided." action={applyLeaveAction} successMessage="@result">
            <LeaveFields types={balances.map((b) => ({ id: b.typeId, name: b.name, allowHalfDay: b.allowHalfDay, left: b.available }))} />
          </ModalForm>
        } />

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Today" description={`${fmtDate(t)}${off ? ` · ${off}` : ` · school starts ${rules.workStart}`}`} />
          <CardBody className="space-y-4">
            {todayRow ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={ATT_TONE[todayRow.status]} label={ATT_LABEL[todayRow.status]} />
                <span className="text-sm text-muted">In {time(todayRow.checkIn)} · Out {time(todayRow.checkOut)}</span>
              </div>
            ) : <p className="text-sm text-muted">{off ? "No attendance needed today." : "Not marked yet."}</p>}
            {rules.selfCheckIn ? (
              <div className="flex flex-wrap gap-2">
                {!todayRow?.checkIn && todayRow?.status !== "ON_LEAVE" && <ActionButton action={checkInAction} args={{}} variant="primary" size="md" successMessage="@result"><LogIn className="size-4" /> Check in</ActionButton>}
                {todayRow?.checkIn && !todayRow.checkOut && <ActionButton action={checkOutAction} args={{}} size="md" successMessage="@result"><LogOut className="size-4" /> Check out</ActionButton>}
              </div>
            ) : <p className="text-xs text-muted">The office marks attendance on the register.</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Leave balance" description="This academic year" />
          <Table>
            <THead><tr><TH>Type</TH><TH align="right">Allowed</TH><TH align="right">Taken</TH><TH align="right">Pending</TH><TH align="right">Left</TH></tr></THead>
            <TBody>
              {balances.length === 0 && <EmptyRow colSpan={5} message="Leave types have not been set up yet." />}
              {balances.map((b) => (
                <TR key={b.typeId}>
                  <TD className="font-medium text-ink">{b.name}</TD>
                  <TD align="right">{b.entitled ?? "No limit"}</TD>
                  <TD align="right">{b.used}</TD>
                  <TD align="right">{b.pending || "—"}</TD>
                  <TD align="right" className="font-semibold text-ink">{b.available ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>

      {covering.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="You are covering for" />
          <Table>
            <THead><tr><TH>Colleague</TH><TH>Dates</TH></tr></THead>
            <TBody>{covering.map((l) => <TR key={l.id}><TD className="font-medium text-ink">{l.staff.name}<span className="block text-xs font-normal text-muted">{l.staff.designation}</span></TD><TD className="whitespace-nowrap">{fmtDate(l.fromDate)}{l.toDate > l.fromDate && <> – {fmtDate(l.toDate)}</>}</TD></TR>)}</TBody>
          </Table>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="My leave" />
        <Table>
          <THead><tr><TH>Leave</TH><TH>Dates</TH><TH align="right">Days</TH><TH>Status</TH><TH /></tr></THead>
          <TBody>
            {leaves.length === 0 && <EmptyRow colSpan={5} message="No leave applied yet." />}
            {leaves.map((l) => {
              const canCancel = l.status === "PENDING" || (l.status === "APPROVED" && l.fromDate > t);
              return (
                <TR key={l.id}>
                  <TD>{l.leaveType.name}<span className="block text-xs text-muted">{l.reason}</span>{l.decisionNote && <span className="block text-xs text-muted">{l.decidedByName}: {l.decisionNote}</span>}{l.substitute && <span className="block text-xs text-muted">Substitute: {l.substitute.name}</span>}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(l.fromDate)}{l.toDate > l.fromDate && <> – {fmtDate(l.toDate)}</>}{l.halfDay && <Badge className="ml-1.5">Half day</Badge>}</TD>
                  <TD align="right">{Number(l.days)}</TD>
                  <TD><StatusBadge status={l.status} label={LEAVE_LABEL[l.status]} /></TD>
                  <TD align="right">{canCancel && <ActionButton action={cancelLeaveAction} args={{ id: l.id }} confirm={`Cancel your ${l.leaveType.name.toLowerCase()} from ${fmtDate(l.fromDate)}?`} successMessage="Leave cancelled">Cancel</ActionButton>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card className="mt-5">
        <CardHeader title="My attendance, last 30 days" description={`${c("PRESENT") + c("LATE")} present · ${c("LATE")} late · ${c("HALF_DAY")} half day · ${c("ABSENT")} absent · ${c("ON_LEAVE")} on leave`} />
        <Table>
          <THead><tr><TH>Date</TH><TH>Status</TH><TH>In</TH><TH>Out</TH></tr></THead>
          <TBody>
            {recent.length === 0 && <EmptyRow colSpan={4} message="Nothing marked in the last 30 days." />}
            {recent.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap">{fmtDate(r.date)}</TD>
                <TD><StatusBadge status={ATT_TONE[r.status]} label={ATT_LABEL[r.status]} /></TD>
                <TD>{time(r.checkIn)}</TD>
                <TD>{time(r.checkOut)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
