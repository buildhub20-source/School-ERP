import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { leaveChecks, siblingsOf } from "@/server/students/service";
import { PageHeader, Card, CardHeader, CardBody, DescList, Badge, StatusBadge, LinkButton, Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui";
import { fullName, fmtDate, money, toNum, isoDate } from "@/lib/format";
import { Pencil, IdCard } from "lucide-react";
import { FeeNameLink } from "../../fees/fee-name-link";
import { LeaveSchoolButton, RejoinButton } from "./student-actions";
import { studentAttendanceSummary, STATUS_LABEL } from "@/server/attendance/service";
import { currentAcademicYear } from "@/lib/settings";

export const metadata = { title: "Student profile" };

export default async function StudentProfile({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("students.view");
  const { id } = await params;
  const s = await db.student.findFirst({
    where: { id, branchId: user.branchId },
    include: {
      schoolClass: true, section: true, staffUser: true,
      guardians: { include: { guardian: { include: { user: { select: { lastLoginAt: true } } } } }, orderBy: { isPrimary: "desc" } },
      enrolments: { include: { academicYear: true, schoolClass: true, section: true }, orderBy: { createdAt: "desc" } },
      sizeProfile: { include: { item: true } },
    },
  });
  if (!s) notFound();
  const canFees = hasPerm(user, "fees.view");
  const canTransportFees = hasPerm(user, "transport.fees.view");
  const canAttendance = hasPerm(user, ["attendance.view", "attendance.manage"]);
  const yearStart = canAttendance ? (await currentAcademicYear())?.startDate : undefined;
  const attendance = canAttendance && yearStart ? await studentAttendanceSummary(s.id, yearStart, new Date()) : null;
  const [siblings, checks, fees, orders, allocation, issued, concessions] = await Promise.all([
    siblingsOf(s.id),
    leaveChecks(s.id),
    canFees || canTransportFees ? db.studentFee.findMany({ where: { studentId: s.id, status: { not: "CANCELLED" }, ...(canFees ? {} : { feeHead: { type: "TRANSPORT" } }) }, include: { academicYear: true, allocations: { include: { payment: { select: { id: true, receiptNo: true, status: true } } } } }, orderBy: { dueDate: "asc" } }) : Promise.resolve([]),
    hasPerm(user, "uniforms.view") ? db.uniformOrder.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "desc" }, take: 5 }) : Promise.resolve([]),
    hasPerm(user, ["transport.view", "students.view"]) ? db.transportAllocation.findFirst({ where: { studentId: s.id, status: "ACTIVE" }, include: { bus: true, route: true, stop: true } }) : Promise.resolve(null),
    hasPerm(user, "stationery.view") ? db.stockMovement.findMany({ where: { studentId: s.id }, include: { item: true }, orderBy: { createdAt: "desc" }, take: 10 }) : Promise.resolve([]),
    canFees ? db.concession.findMany({ where: { studentId: s.id }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const totals = fees.reduce((a, f) => ({ net: a.net + toNum(f.amount) - toNum(f.concessionAmount) + toNum(f.lateFeeAmount) + toNum(f.adjustmentAmount), paid: a.paid + toNum(f.paidAmount), bal: a.bal + Math.max(0, toNum(f.balance)) }), { net: 0, paid: 0, bal: 0 });
  const overdue = fees.filter((f) => (f.status === "PENDING" || f.status === "PARTIAL") && f.dueDate < new Date()).reduce((a, f) => a + toNum(f.balance), 0);

  return (
    <>
      <PageHeader title={fullName(s)} breadcrumbs={[{ label: "Students", href: "/students" }, { label: fullName(s) }]}
        description={<>{s.admissionNo} · {s.schoolClass.name}{s.section ? ` - ${s.section.name}` : ""} · <StatusBadge status={s.status} /></>}
        actions={<>
          {hasPerm(user, ["uniforms.manage", "students.manage"]) && <LinkButton href={`/api/uniforms/id-cards?studentIds=${s.id}`} target="_blank" variant="secondary"><IdCard className="size-4" />ID card</LinkButton>}
          {hasPerm(user, "students.manage") && <LinkButton href={`/students/${s.id}/edit`} variant="secondary"><Pencil className="size-4" />Edit</LinkButton>}
          {hasPerm(user, "students.manage") && s.status === "ACTIVE" && <LeaveSchoolButton id={s.id} checks={checks} today={isoDate()} />}
          {hasPerm(user, "students.manage") && s.status === "LEFT" && <RejoinButton id={s.id} />}
        </>} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Personal details" />
            <CardBody className="flex flex-col gap-5 sm:flex-row">
              {s.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.photoUrl} alt="" className="size-28 shrink-0 rounded-xl object-cover" />
                : <div className="grid size-28 shrink-0 place-items-center rounded-xl bg-slate-100 text-3xl font-semibold text-slate-400">{s.firstName.charAt(0)}</div>}
              <DescList cols={3} items={[
                { label: "Gender", value: s.gender.charAt(0) + s.gender.slice(1).toLowerCase() }, { label: "Date of birth", value: fmtDate(s.dob) },
                { label: "Blood group", value: s.bloodGroup }, { label: "Roll no", value: s.rollNo }, { label: "Admitted", value: fmtDate(s.admissionDate) },
                { label: "Emergency phone", value: s.emergencyPhone }, { label: "Address", value: s.address },
                { label: "Medical notes", value: s.medicalNotes }, { label: "Staff child", value: s.isStaffChild ? `Yes${s.staffUser ? ` (${s.staffUser.name})` : ""}` : "No" },
                ...(s.status !== "ACTIVE" ? [{ label: "Left on", value: `${fmtDate(s.leftOn)} — ${s.leftReason ?? ""}` }] : []),
              ]} />
            </CardBody>
          </Card>

          {(canFees || canTransportFees) && (
            <Card>
              <CardHeader title={canFees ? "Fee account" : "Transport fees"} description={`Paid ${money(totals.paid)} of ${money(totals.net)} · Balance ${money(totals.bal)}${overdue > 0 ? ` · Overdue ${money(overdue)}` : ""}`}
                actions={<>{hasPerm(user, "fees.collect") && <LinkButton href={`/fees/collect?studentId=${s.id}`} size="sm" variant="primary">Collect fee</LinkButton>}<LinkButton href={`/fees/accounts/${s.id}`} size="sm">Full account</LinkButton></>} />
              <Table>
                <THead><tr><TH>Fee</TH><TH>Year</TH><TH>Due</TH><TH align="right">Amount</TH><TH align="right">Paid</TH><TH align="right">Balance</TH><TH>Status</TH></tr></THead>
                <TBody>
                  {fees.length === 0 && <EmptyRow colSpan={7} message="No fees on this account yet." />}
                  {fees.slice(-12).map((f) => (
                    <TR key={f.id} highlight={(f.status === "PENDING" || f.status === "PARTIAL") && f.dueDate < new Date() ? "red" : undefined}>
                      <TD><FeeNameLink name={f.description} full={canFees} receipts={f.allocations.filter((a) => a.payment.status === "SUCCESS" && a.payment.receiptNo && toNum(a.amount) > 0).map((a) => ({ id: a.payment.id, receiptNo: a.payment.receiptNo! }))} /></TD><TD>{f.academicYear.name}</TD><TD>{fmtDate(f.dueDate)}</TD>
                      <TD align="right">{money(toNum(f.amount) - toNum(f.concessionAmount) + toNum(f.lateFeeAmount) + toNum(f.adjustmentAmount))}</TD>
                      <TD align="right">{money(f.paidAmount)}</TD><TD align="right">{money(f.balance)}</TD><TD><StatusBadge status={f.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}

          {hasPerm(user, "uniforms.view") && (
            <Card>
              <CardHeader title="Uniforms" actions={hasPerm(user, "uniforms.orders") && <LinkButton href={`/uniforms/orders/new?studentId=${s.id}`} size="sm">New order</LinkButton>} />
              <CardBody className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Size profile (last ordered)</p>
                  {s.sizeProfile.length === 0 ? <p className="text-sm text-slate-500">No sizes recorded yet.</p> : (
                    <div className="flex flex-wrap gap-2">{s.sizeProfile.map((p) => <Badge key={p.id} tone="indigo">{p.item.name}: {p.size}</Badge>)}</div>
                  )}
                </div>
                <div className="space-y-1">
                  {orders.length === 0 ? <p className="text-sm text-slate-500">No orders.</p> : orders.map((o) => (
                    <Link key={o.id} href={`/uniforms/orders/${o.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <span className="font-mono text-xs">{o.orderNo}{o.isPreOrder && " (pre-order)"}</span><span>{money(o.total)}</span><StatusBadge status={o.status} />
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {hasPerm(user, "stationery.view") && issued.length > 0 && (
            <Card>
              <CardHeader title="Stationery issued to this student" />
              <Table>
                <THead><tr><TH>Date</TH><TH>Item</TH><TH align="right">Qty</TH><TH>Type</TH></tr></THead>
                <TBody>{issued.map((m) => <TR key={m.id}><TD>{fmtDate(m.createdAt)}</TD><TD>{m.item.name}</TD><TD align="right">{Math.abs(m.qty)}</TD><TD><StatusBadge status={m.type} /></TD></TR>)}</TBody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {attendance && (
            <Card>
              <CardHeader title="Attendance this year" description={attendance.marked ? `${attendance.marked} school days marked` : undefined}
                actions={s.sectionId && <LinkButton href={`/attendance/month?sectionId=${s.sectionId}`} size="sm">Month view</LinkButton>} />
              <CardBody>
                {attendance.marked === 0 ? <p className="text-sm text-slate-500">No attendance marked yet.</p> : (
                  <>
                    <p className={`text-3xl font-semibold ${attendance.percent !== null && attendance.percent < 75 ? "text-rose-700" : "text-ink"}`}>{attendance.percent}%</p>
                    <p className="mt-1 text-sm text-muted">{attendance.counts.absent} absent · {attendance.counts.late} late · {attendance.counts.half} half day</p>
                    {attendance.notPresent.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm">
                        {attendance.notPresent.slice(0, 5).map((d) => <li key={d.date.toISOString()} className="flex justify-between gap-3"><span>{fmtDate(d.date)}{d.note ? <span className="text-xs text-muted"> · {d.note}</span> : null}</span><span className={d.status === "ABSENT" ? "text-rose-700" : "text-muted"}>{STATUS_LABEL[d.status]}</span></li>)}
                      </ul>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Parents / guardians" />
            <CardBody className="space-y-3">
              {s.guardians.map((g) => (
                <div key={g.guardianId} className="text-sm">
                  <p className="font-medium text-slate-900">{g.guardian.name} <span className="font-normal text-slate-500">· {g.relation}</span> {g.isPrimary && <Badge tone="indigo">Primary</Badge>}</p>
                  <p className="text-slate-600"><a href={`tel:${g.guardian.phone}`} className="hover:underline">{g.guardian.phone}</a>{g.guardian.email && <> · {g.guardian.email}</>}</p>
                  <p className="text-xs text-slate-400">{g.guardian.user?.lastLoginAt ? `Portal last used ${fmtDate(g.guardian.user.lastLoginAt)}` : "Has not used the parent portal yet"}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="School transport" actions={hasPerm(user, "transport.manage") && <LinkButton href={`/transport/allocations?studentId=${s.id}`} size="sm">{allocation ? "Change" : "Assign bus"}</LinkButton>} />
            <CardBody>
              {allocation ? <DescList cols={1} items={[{ label: "Bus", value: allocation.bus.busNo }, { label: "Route", value: allocation.route.name }, { label: "Stop", value: `${allocation.stop.name}${allocation.stop.pickupTime ? ` · pickup ${allocation.stop.pickupTime}` : ""}` }, { label: "Since", value: fmtDate(allocation.startDate) }]} /> : <p className="text-sm text-slate-500">Not using school transport.</p>}
            </CardBody>
          </Card>
          {siblings.length > 0 && (
            <Card>
              <CardHeader title="Siblings" />
              <CardBody className="space-y-1">
                {siblings.map((x) => <Link key={x.id} href={`/students/${x.id}`} className="block text-sm hover:text-brand-700">{fullName(x)} <span className="text-slate-500">· {x.schoolClass.name}{x.section ? `-${x.section.name}` : ""}</span> {x.status !== "ACTIVE" && <StatusBadge status={x.status} />}</Link>)}
              </CardBody>
            </Card>
          )}
          {concessions.length > 0 && (
            <Card>
              <CardHeader title="Concessions" />
              <CardBody className="space-y-2 text-sm">
                {concessions.map((c) => <div key={c.id} className="flex items-center justify-between gap-2"><span>{c.type.replace("_", " ")} · {c.mode === "PERCENT" ? `${toNum(c.value)}%` : money(c.value)}</span><StatusBadge status={c.status} /></div>)}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Class history" />
            <CardBody className="space-y-1 text-sm">
              {s.enrolments.length === 0 ? <p className="text-slate-500">—</p> : s.enrolments.map((e) => (
                <div key={e.id} className="flex justify-between"><span>{e.academicYear.name}</span><span className="text-slate-600">{e.schoolClass.name}{e.section ? `-${e.section.name}` : ""}{e.outcome ? ` · ${e.outcome.toLowerCase()}` : ""}</span></div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
