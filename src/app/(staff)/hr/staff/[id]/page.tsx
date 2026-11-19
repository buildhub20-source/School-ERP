import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, fmtDate, fmtDateTime, isoDate, today } from "@/lib/format";
import { ATT_LABEL, CATEGORY_LABEL, EMPLOYMENT_LABEL, LEAVE_LABEL, leaveBalances, loginsWithoutProfile } from "@/server/hr/service";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, StatusBadge, Field, FormGrid, Input, Checkbox } from "@/components/ui";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { addStaffDocumentAction, applyLeaveAction, cancelLeaveAction, deleteStaffDocumentAction, markLeftAction, rejoinAction, saveStaffAction, setAllocationAction } from "../../actions";
import { LeaveFields, StaffFields } from "../../_components/fields";

export const metadata = { title: "Staff profile" };

const ATT_TONE = { PRESENT: "OK", LATE: "PENDING", HALF_DAY: "PARTIAL", ABSENT: "OVERDUE", ON_LEAVE: "ISSUED" } as const;

export default async function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("hr.view");
  const { id } = await params;
  const staff = await db.staffProfile.findFirst({
    where: { id, branchId: user.branchId },
    include: { department: true, user: { include: { role: true } }, documents: { orderBy: { createdAt: "desc" } } },
  });
  if (!staff) notFound();
  const t = today();
  const canManage = hasPerm(user, "hr.manage"), canApprove = hasPerm(user, "hr.leave.approve");
  const [balances, leaves, attendance, departments, logins] = await Promise.all([
    leaveBalances(user.branchId, staff.id),
    db.leaveRequest.findMany({ where: { staffId: staff.id }, include: { leaveType: true, substitute: true }, orderBy: { fromDate: "desc" }, take: 20 }),
    db.staffAttendance.findMany({ where: { staffId: staff.id, date: { gte: addDays(t, -30) } }, orderBy: { date: "desc" } }),
    canManage ? db.department.findMany({ where: { branchId: user.branchId }, orderBy: { name: "asc" } }) : [],
    canManage ? loginsWithoutProfile(user.branchId) : [],
  ]);
  const loginOpts = [...(staff.user ? [{ id: staff.user.id, name: `${staff.user.name} · ${staff.user.role.name}` }] : []), ...logins.map((u) => ({ id: u.id, name: `${u.name} · ${u.role.name}` }))];
  const years = (d: Date) => Math.max(0, Math.floor((t.getTime() - d.getTime()) / (365.25 * 86400000)));
  const count = (s: keyof typeof ATT_LABEL) => attendance.filter((a) => a.status === s).length;
  return (
    <>
      <PageHeader title={staff.name} description={`${staff.employeeCode} · ${staff.designation}${staff.department ? ` · ${staff.department.name}` : ""}`}
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Staff", href: "/hr/staff" }, { label: staff.name }]}
        actions={<>
          {canManage && staff.isActive && (
            <ModalForm trigger="Record leave" triggerVariant="secondary" title={`Record leave for ${staff.name}`} action={applyLeaveAction} extra={{ staffId: staff.id }} successMessage="@result">
              <LeaveFields types={balances.map((b) => ({ id: b.typeId, name: b.name, allowHalfDay: b.allowHalfDay, left: b.available }))} canApprove={canApprove && staff.userId !== user.id} />
            </ModalForm>
          )}
          {canManage && staff.isActive && (
            <ModalForm trigger="Mark as left" triggerVariant="secondary" title={`${staff.name} is leaving`} description="Their profile is kept for records. Pending leave is cancelled." action={markLeftAction} extra={{ id: staff.id }} successMessage="Marked as left">
              <FormGrid cols={1}>
                <Field label="Last working day" required><Input name="leftOn" type="date" defaultValue={isoDate()} required /></Field>
                <Field label="Reason" required><Input name="reason" required placeholder="Resigned, retired, contract ended …" /></Field>
                {staff.userId && <Checkbox name="disableLogin" value="true" defaultChecked label="Switch off their login and sign them out" />}
              </FormGrid>
            </ModalForm>
          )}
          {canManage && !staff.isActive && <ActionButton action={rejoinAction} args={{ id: staff.id }} confirm={`Mark ${staff.name} as working here again?`} successMessage="Back on the staff roll">Rejoined</ActionButton>}
          {canManage && (
            <ModalForm trigger="Edit" icon={<Pencil className="size-4" />} title="Edit staff member" size="xl" action={saveStaffAction} extra={{ id: staff.id }} successMessage="Saved">
              <StaffFields staff={staff} departments={departments} logins={loginOpts} />
            </ModalForm>
          )}
        </>} />
      {!staff.isActive && <Card className="mb-5 border-amber-300 px-5 py-3 text-sm text-ink">Left on {fmtDate(staff.leftOn)}: {staff.leftReason}</Card>}
      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={3} items={[
              { label: "Category", value: CATEGORY_LABEL[staff.category] },
              { label: "Employment", value: <>{EMPLOYMENT_LABEL[staff.employmentType]}{staff.probationEndsOn && staff.employmentType === "PROBATION" ? ` until ${fmtDate(staff.probationEndsOn)}` : ""}</> },
              { label: "Joined", value: `${fmtDate(staff.joiningDate)} (${years(staff.joiningDate)} yr${years(staff.joiningDate) === 1 ? "" : "s"})` },
              { label: "Total experience", value: `${years(staff.joiningDate) + (staff.priorExperienceYears ?? 0)} years` },
              { label: "Qualifications", value: staff.qualifications },
              { label: "Subjects", value: staff.subjects },
              { label: "Mobile", value: staff.phone },
              { label: "Email", value: staff.email },
              { label: "Date of birth", value: staff.dob ? fmtDate(staff.dob) : null },
              { label: "Blood group", value: staff.bloodGroup },
              { label: "Emergency contact", value: staff.emergencyName ? `${staff.emergencyName}${staff.emergencyPhone ? `, ${staff.emergencyPhone}` : ""}` : null },
              { label: "Login", value: staff.user ? `${staff.user.email ?? staff.user.phone} · ${staff.user.role.name}${staff.user.isActive ? "" : " (switched off)"}` : "No login" },
              { label: "Address", value: staff.address },
              { label: "Notes", value: staff.notes },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leave balance" description="This academic year" />
          <Table>
            <THead><tr><TH>Type</TH><TH align="right">Allowed</TH><TH align="right">Taken</TH><TH align="right">Left</TH>{canManage && <TH />}</tr></THead>
            <TBody>
              {balances.length === 0 && <EmptyRow colSpan={5} message="No leave types yet." />}
              {balances.map((b) => (
                <TR key={b.typeId}>
                  <TD>{b.name}{b.pending > 0 && <span className="block text-xs text-amber-700">{b.pending} pending</span>}</TD>
                  <TD align="right">{b.entitled ?? "No limit"}{b.custom && <span className="block text-[11px] text-muted">custom</span>}</TD>
                  <TD align="right">{b.used}</TD>
                  <TD align="right" className="font-semibold">{b.available ?? "—"}</TD>
                  {canManage && <TD align="right">{b.isPaid && (
                    <ModalForm trigger="Set" triggerVariant="ghost" triggerSize="sm" title={`${b.name}: days allowed this year`} action={setAllocationAction} extra={{ staffId: staff.id, leaveTypeId: b.typeId }} successMessage="Balance updated">
                      <FormGrid cols={1}>
                        <Field label="Days allowed" required hint="Half days allowed, e.g. 7.5"><Input name="days" type="number" step="0.5" min={0} defaultValue={b.entitled ?? 0} required /></Field>
                        <Field label="Note"><Input name="note" placeholder="e.g. Joined mid-year, pro-rated" /></Field>
                      </FormGrid>
                    </ModalForm>
                  )}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Leave history" />
        <Table>
          <THead><tr><TH>Request</TH><TH>Type</TH><TH>Dates</TH><TH align="right">Days</TH><TH>Reason</TH><TH>Status</TH>{canApprove && <TH />}</tr></THead>
          <TBody>
            {leaves.length === 0 && <EmptyRow colSpan={7} message="No leave taken yet." />}
            {leaves.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">{l.requestNo}</TD>
                <TD>{l.leaveType.name}</TD>
                <TD className="whitespace-nowrap">{fmtDate(l.fromDate)}{l.toDate > l.fromDate && <> – {fmtDate(l.toDate)}</>}{l.halfDay && <Badge className="ml-1.5">Half day</Badge>}</TD>
                <TD align="right">{Number(l.days)}</TD>
                <TD className="max-w-xs">{l.reason}{l.decisionNote && <span className="block text-xs text-muted">{l.decidedByName}: {l.decisionNote}</span>}{l.substitute && <span className="block text-xs text-muted">Substitute: {l.substitute.name}</span>}</TD>
                <TD><StatusBadge status={l.status} label={LEAVE_LABEL[l.status]} /></TD>
                {canApprove && <TD align="right">{(l.status === "PENDING" || l.status === "APPROVED") && <ActionButton action={cancelLeaveAction} args={{ id: l.id }} reason="optional" confirm={`Cancel ${l.requestNo}? Attendance marked from it is removed.`} successMessage="Leave cancelled">Cancel</ActionButton>}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Attendance, last 30 days" description={`${count("PRESENT") + count("LATE")} present · ${count("LATE")} late · ${count("HALF_DAY")} half · ${count("ABSENT")} absent · ${count("ON_LEAVE")} on leave`} />
          <Table>
            <THead><tr><TH>Date</TH><TH>Status</TH><TH>In / out</TH><TH>Note</TH></tr></THead>
            <TBody>
              {attendance.length === 0 && <EmptyRow colSpan={4} message="No attendance in the last 30 days." />}
              {attendance.slice(0, 12).map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap">{fmtDate(a.date)}</TD>
                  <TD><StatusBadge status={ATT_TONE[a.status]} label={ATT_LABEL[a.status]} /></TD>
                  <TD className="whitespace-nowrap text-xs">{a.checkIn ? fmtDateTime(a.checkIn).split(", ").pop() : "—"}{a.checkOut ? ` – ${fmtDateTime(a.checkOut).split(", ").pop()}` : ""}</TD>
                  <TD className="text-xs text-muted">{a.note ?? (a.source === "SELF" ? "Phone check-in" : "")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Documents" description="Certificates, ID proof, police verification, contract" actions={canManage && (
            <ModalForm trigger="Add" triggerSize="sm" icon={<Plus className="size-4" />} title="Add document" action={addStaffDocumentAction} extra={{ staffId: staff.id }} successMessage="Document added">
              <FormGrid cols={2}>
                <Field label="Document" required className="sm:col-span-2"><Input name="title" required placeholder="e.g. B.Ed. certificate, Police verification" maxLength={100} /></Field>
                <Field label="Number"><Input name="number" maxLength={60} /></Field>
                <Field label="Valid until" hint="HR is reminded before it expires"><Input name="expiresOn" type="date" /></Field>
                <Field label="Scan / photo" hint="PDF, JPG, PNG or WEBP, up to 5 MB" className="sm:col-span-2"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="h-auto py-1.5" /></Field>
              </FormGrid>
            </ModalForm>
          )} />
          <Table>
            <THead><tr><TH>Document</TH><TH>Valid until</TH>{canManage && <TH />}</tr></THead>
            <TBody>
              {staff.documents.length === 0 && <EmptyRow colSpan={3} message="No documents yet." />}
              {staff.documents.map((d) => (
                <TR key={d.id}>
                  <TD>{d.fileUrl ? <a href={d.fileUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">{d.title}</a> : <span className="font-medium text-ink">{d.title}</span>}{d.number && <span className="block text-xs text-muted">{d.number}</span>}</TD>
                  <TD className="whitespace-nowrap">{d.expiresOn ? (d.expiresOn < t ? <span className="font-medium text-rose-700">Expired {fmtDate(d.expiresOn)}</span> : fmtDate(d.expiresOn)) : "—"}</TD>
                  {canManage && <TD align="right"><ActionButton action={deleteStaffDocumentAction} args={{ id: d.id }} variant="ghost" confirm={`Remove ${d.title}?`} successMessage="Removed" title="Remove"><Trash2 className="size-4" /></ActionButton></TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
