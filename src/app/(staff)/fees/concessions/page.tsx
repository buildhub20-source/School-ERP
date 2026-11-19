import Link from "next/link";
import type { ApprovalStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { concessionSuggestions } from "@/server/fees/service";
import { CONCESSION_LABEL } from "@/server/fees/access";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Tabs, Pagination, pageParams, sp } from "@/components/ui";
import { ActionButton, FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fullName, money, fmtDate, toNum } from "@/lib/format";
import { ConcessionRequestForm } from "../fee-forms";
import { decideConcessionAction } from "../actions";

export const metadata = { title: "Concessions" };

export default async function ConcessionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["fees.concession.request", "fees.concession.approve"]);
  const s = await searchParams;
  const pg = pageParams(s);
  const status = (sp(s, "status") ?? "PENDING") as ApprovalStatus;
  const canApprove = hasPerm(user, "fees.concession.approve");
  const canRequest = hasPerm(user, "fees.concession.request");
  const q = sp(s, "q");
  const where = {
    status, student: { branchId: user.branchId, ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" as const } }, { lastName: { contains: q, mode: "insensitive" as const } }, { admissionNo: { contains: q, mode: "insensitive" as const } }] } : {}) },
    ...(sp(s, "type") ? { type: sp(s, "type") as "SIBLING" } : {}),
  };
  const [counts, total, rows, heads, suggestions, students] = await Promise.all([
    db.concession.groupBy({ by: ["status"], where: { student: { branchId: user.branchId } }, _count: true }),
    db.concession.count({ where }),
    db.concession.findMany({ where, include: { student: { include: { schoolClass: true } }, feeHead: true, academicYear: true }, orderBy: { createdAt: "desc" }, skip: pg.skip, take: pg.take }),
    db.feeHead.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: { name: "asc" } }),
    canRequest ? concessionSuggestions(user.branchId) : Promise.resolve([]),
    canRequest ? db.student.findMany({ where: { branchId: user.branchId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, admissionNo: true }, orderBy: { firstName: "asc" } }) : Promise.resolve([]),
  ]);
  const users = await db.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.requestedById, r.approvedById]).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const count = (st: string) => counts.find((c) => c.status === st)?._count ?? 0;
  const headOpts = heads.map((h) => ({ value: h.id, label: h.name }));
  return (
    <>
      <PageHeader title="Concessions & scholarships" description="Sibling discount, staff-child concession, merit scholarship and others — applied after approval."
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Concessions" }]}
        actions={canRequest && <ConcessionRequestForm heads={headOpts} triggerLabel="New request" students={students.map((x) => ({ value: x.id, label: `${fullName(x)} (${x.admissionNo})` }))} />} />
      <Tabs active={`/fees/concessions?status=${status}`} tabs={(["PENDING", "APPROVED", "REJECTED"] as const).map((st) => ({ href: `/fees/concessions?status=${st}`, label: st.charAt(0) + st.slice(1).toLowerCase(), count: count(st) }))} />
      <Card className="mb-5">
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <input type="hidden" name="status" value={status} />
            <SearchField placeholder="Student or admission no" />
            <FilterSelect name="type" label="All types" options={Object.entries(CONCESSION_LABEL).map(([value, label]) => ({ value, label }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Type</TH><TH>Value</TH><TH>Reason</TH><TH>Requested</TH><TH>{status === "PENDING" ? "" : "Decision"}</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6} />}
            {rows.map((c) => (
              <TR key={c.id}>
                <TD><Link href={`/fees/accounts/${c.studentId}`} className="font-medium hover:text-brand-700">{fullName(c.student)}</Link><span className="block text-xs text-slate-500">{c.student.admissionNo} · {c.student.schoolClass.name} · {c.academicYear.name}</span></TD>
                <TD>{CONCESSION_LABEL[c.type]}<span className="block text-xs text-slate-500">{c.feeHead?.name ?? "Tuition fees"}</span></TD>
                <TD>{c.mode === "PERCENT" ? `${toNum(c.value)}%` : `${money(c.value)} / line`}</TD>
                <TD className="max-w-xs text-xs">{c.reason}</TD>
                <TD className="whitespace-nowrap text-xs">{fmtDate(c.createdAt)}<span className="block text-slate-500">{uname(c.requestedById)}</span></TD>
                <TD className="whitespace-nowrap">
                  {c.status === "PENDING" ? (canApprove ? <div className="flex gap-1">
                    <ActionButton action={decideConcessionAction} args={{ id: c.id, approve: "true" }} variant="success" confirm="Approve and apply this concession?" reason="optional" reasonLabel="Decision note" successMessage="Approved and applied">Approve</ActionButton>
                    <ActionButton action={decideConcessionAction} args={{ id: c.id, approve: "false" }} variant="danger" confirm="Reject this concession?" reason reasonLabel="Reason for rejecting" successMessage="Rejected">Reject</ActionButton>
                  </div> : <StatusBadge status="PENDING" />) : <><StatusBadge status={c.status} /><span className="block text-xs text-slate-500">{uname(c.approvedById)} · {fmtDate(c.decidedAt)}</span>{c.decisionNote && <span className="block max-w-xs whitespace-normal text-xs text-slate-500">{c.decisionNote}</span>}</>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={pg.page} pageSize={pg.pageSize} total={total} searchParams={s} basePath="/fees/concessions" />
      </Card>
      {canRequest && (
        <Card>
          <CardHeader title="Suggested concessions" description="Younger siblings in the same family and children of staff without a concession this year (percentages from Settings → Policies)." />
          <Table>
            <THead><tr><TH>Student</TH><TH>Class</TH><TH>Suggestion</TH><TH>Why</TH><TH></TH></tr></THead>
            <TBody>
              {suggestions.length === 0 && <EmptyRow colSpan={5} message="No suggestions." />}
              {suggestions.slice(0, 50).map((x) => (
                <TR key={`${x.studentId}:${x.type}`}>
                  <TD><Link href={`/fees/accounts/${x.studentId}`} className="font-medium hover:text-brand-700">{x.name}</Link><span className="block text-xs text-slate-500">{x.admissionNo}</span></TD>
                  <TD>{x.className}</TD><TD>{CONCESSION_LABEL[x.type]} {x.percent}%</TD><TD className="text-xs">{x.reason}</TD>
                  <TD align="right"><ConcessionRequestForm studentId={x.studentId} heads={headOpts} triggerLabel="Request" defaults={{ type: x.type, value: x.percent, reason: x.reason }} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
