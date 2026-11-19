import Link from "next/link";
import type { LeaveStatus, Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { LEAVE_LABEL } from "@/server/hr/service";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, StatusBadge, Pagination, pageParams, sp, Tabs, Field, FormGrid, Input, Select } from "@/components/ui";
import { ModalForm, ActionButton, FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { applyLeaveAction, approveLeaveAction, cancelLeaveAction, rejectLeaveAction } from "../actions";
import { LeaveFields } from "../_components/fields";

export const metadata = { title: "Staff leave" };
const STATUSES: LeaveStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

export default async function LeavePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hr.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const status = STATUSES.find((x) => x === sp(s, "status"));
  const q = sp(s, "q");
  const where: Prisma.LeaveRequestWhereInput = {
    branchId: user.branchId, ...(status ? { status } : {}), ...(sp(s, "typeId") ? { leaveTypeId: sp(s, "typeId") } : {}),
    ...(q ? { OR: [{ requestNo: { contains: q, mode: "insensitive" } }, { staff: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const canApprove = hasPerm(user, "hr.leave.approve"), canManage = hasPerm(user, "hr.manage");
  const [total, leaves, pendingCount, types, staff] = await Promise.all([
    db.leaveRequest.count({ where }),
    db.leaveRequest.findMany({ where, include: { staff: { include: { department: true } }, leaveType: true, substitute: true }, orderBy: status === "PENDING" ? { appliedAt: "asc" } : { fromDate: "desc" }, skip, take }),
    db.leaveRequest.count({ where: { branchId: user.branchId, status: "PENDING" } }),
    db.leaveType.findMany({ where: { branchId: user.branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    canApprove || canManage ? db.staffProfile.findMany({ where: { branchId: user.branchId, isActive: true }, select: { id: true, name: true, designation: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const tab = status ?? "ALL";
  return (
    <>
      <PageHeader title="Staff leave" description="Leave requests from staff, oldest pending first. Approved leave is marked on the attendance register automatically."
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Leave" }]}
        actions={canManage && (
          <ModalForm trigger="Record leave" icon={<Plus className="size-4" />} title="Record leave for a staff member" description="For staff without a login, or leave agreed in person." action={applyLeaveAction} successMessage="@result">
            <LeaveFields staff={staff.map((p) => ({ id: p.id, name: `${p.name} · ${p.designation}` }))} types={types.filter((x) => x.isActive).map((x) => ({ id: x.id, name: x.name, allowHalfDay: x.allowHalfDay, left: null }))} canApprove={canApprove} />
          </ModalForm>
        )} />
      <Tabs active={tab === "ALL" ? "/hr/leave" : `/hr/leave?status=${tab}`} tabs={[
        { href: "/hr/leave?status=PENDING", label: "Pending", count: pendingCount },
        { href: "/hr/leave?status=APPROVED", label: "Approved" }, { href: "/hr/leave?status=REJECTED", label: "Rejected" }, { href: "/hr/leave?status=CANCELLED", label: "Cancelled" }, { href: "/hr/leave", label: "All" },
      ]} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterBar>
            <SearchField placeholder="Name or request no" />
            <FilterSelect name="typeId" label="All leave types" options={types.map((x) => ({ value: x.id, label: x.name }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Staff</TH><TH>Leave</TH><TH>Dates</TH><TH align="right">Days</TH><TH>Reason</TH><TH>Status</TH>{canApprove && <TH />}</tr></THead>
          <TBody>
            {leaves.length === 0 && <EmptyRow colSpan={7} message={status === "PENDING" ? "No leave waiting for approval." : "No leave requests."} />}
            {leaves.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap"><span id={l.id} className="scroll-mt-24" /><Link href={`/hr/staff/${l.staffId}`} className="font-medium text-ink hover:text-brand-700">{l.staff.name}</Link><span className="block text-xs text-muted">{l.staff.designation}{l.staff.department ? `, ${l.staff.department.name}` : ""}</span></TD>
                <TD className="whitespace-nowrap">{l.leaveType.name}<span className="block font-mono text-xs text-muted">{l.requestNo}</span></TD>
                <TD className="whitespace-nowrap">{fmtDate(l.fromDate)}{l.toDate > l.fromDate && <> – {fmtDate(l.toDate)}</>}{l.halfDay && <Badge className="ml-1.5">Half day</Badge>}</TD>
                <TD align="right" className="tabular-nums">{Number(l.days)}</TD>
                <TD className="max-w-xs">
                  {l.reason}
                  <span className="block text-xs text-muted">Applied by {l.appliedByName}, {fmtDateTime(l.appliedAt)}</span>
                  {l.decisionNote && <span className="block text-xs text-muted">{l.decidedByName}: {l.decisionNote}</span>}
                  {l.substitute && <span className="block text-xs text-muted">Substitute: {l.substitute.name}</span>}
                </TD>
                <TD><StatusBadge status={l.status} label={LEAVE_LABEL[l.status]} /></TD>
                {canApprove && (
                  <TD align="right">
                    {l.status === "PENDING" && l.staff.userId !== user.id && (
                      <div className="flex justify-end gap-1.5">
                        <ModalForm trigger="Approve" triggerSize="sm" title={`Approve ${l.requestNo}`} description={`${l.staff.name}: ${l.leaveType.name}, ${Number(l.days)} day${Number(l.days) === 1 ? "" : "s"}`} action={approveLeaveAction} extra={{ id: l.id }} submitLabel="Approve" successMessage="Approved · attendance updated">
                          <FormGrid cols={1}>
                            <Field label="Substitute" hint="Who covers their classes or duties (they are told)">
                              <Select name="substituteId" placeholder="None">{staff.filter((p) => p.id !== l.staffId).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.designation}</option>)}</Select>
                            </Field>
                            <Field label="Note"><Input name="note" maxLength={300} /></Field>
                          </FormGrid>
                        </ModalForm>
                        <ActionButton action={rejectLeaveAction} args={{ id: l.id }} variant="danger" reason reasonLabel="Why is it not approved?" successMessage="Rejected">Reject</ActionButton>
                      </div>
                    )}
                    {l.status === "PENDING" && l.staff.userId === user.id && <span className="text-xs text-muted">Your own request</span>}
                    {l.status === "APPROVED" && <ActionButton action={cancelLeaveAction} args={{ id: l.id }} reason="optional" confirm={`Cancel ${l.requestNo}? Attendance marked from it is removed.`} successMessage="Leave cancelled">Cancel</ActionButton>}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/hr/leave" />
      </Card>
    </>
  );
}
