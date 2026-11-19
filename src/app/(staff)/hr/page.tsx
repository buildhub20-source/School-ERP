import Link from "next/link";
import { CalendarClock, CalendarOff, ClipboardCheck, UserCheck, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { fmtDate, today } from "@/lib/format";
import { hrDashboard, loginsWithoutProfile } from "@/server/hr/service";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { profilesFromLoginsAction } from "./actions";

export const metadata = { title: "HR" };

export default async function HrOverview() {
  const user = await requireUser("hr.view");
  const [d, missing] = await Promise.all([hrDashboard(user.branchId), hasPerm(user, "hr.manage") ? loginsWithoutProfile(user.branchId) : []]);
  const t = today();
  return (
    <>
      <PageHeader title="HR" description={`Staff, attendance and leave · ${fmtDate(t)}${d.off ? ` · ${d.off}` : ""}`} />
      {missing.length > 0 && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-sm text-ink"><span className="font-semibold">{missing.length} staff login{missing.length === 1 ? " has" : "s have"} no HR profile</span><span className="text-muted">: {missing.slice(0, 4).map((u) => u.name).join(", ")}{missing.length > 4 ? "…" : ""}. They cannot apply for leave or check in until they have one.</span></p>
          <ActionButton action={profilesFromLoginsAction} args={{}} variant="primary" successMessage="@result">Create their profiles</ActionButton>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Staff" value={d.active} href="/hr/staff" icon={<Users />} />
        <StatCard label="Present today" value={d.off ? "—" : d.present} hint={d.off ? d.off : d.late ? `${d.late} late` : "On time"} href="/hr/attendance" icon={<UserCheck />} />
        <StatCard label="On leave today" value={d.onLeave.length} hint={d.absent ? `${d.absent} absent without leave` : undefined} href="/hr/attendance" icon={<CalendarOff />} />
        <StatCard label={d.off ? "Day off" : "Not marked yet"} value={d.off ? "—" : d.notMarked} hint={!d.off && d.notMarked ? "Mark the register" : undefined} href="/hr/attendance" icon={<ClipboardCheck />} />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="On leave today" actions={d.pending > 0 && <Link href="/hr/leave?status=PENDING" className="text-sm font-medium text-brand-700 hover:underline">{d.pending} waiting for approval</Link>} />
          <Table>
            <THead><tr><TH>Staff</TH><TH>Leave</TH><TH>Until</TH><TH>Substitute</TH></tr></THead>
            <TBody>
              {d.onLeave.length === 0 && <EmptyRow colSpan={4} message="Nobody is on leave today." />}
              {d.onLeave.map((l) => (
                <TR key={l.id}>
                  <TD><Link href={`/hr/staff/${l.staffId}`} className="font-medium text-ink hover:text-brand-700">{l.staff.name}</Link><span className="block text-xs text-muted">{l.staff.designation}</span></TD>
                  <TD>{l.leaveType.name}{l.halfDay && <Badge className="ml-1.5">Half day</Badge>}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(l.toDate)}</TD>
                  <TD>{l.substitute?.name ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Coming up" description="Documents expiring and probation ending in the next 30 days" />
          <Table>
            <THead><tr><TH>Staff</TH><TH>What</TH><TH>Date</TH></tr></THead>
            <TBody>
              {d.docs.length + d.probation.length === 0 && <EmptyRow colSpan={3} message="Nothing due in the next 30 days." />}
              {d.probation.map((p) => (
                <TR key={p.id}><TD><Link href={`/hr/staff/${p.id}`} className="font-medium text-ink hover:text-brand-700">{p.name}</Link></TD><TD>Probation ends</TD><TD className="whitespace-nowrap">{fmtDate(p.probationEndsOn)}</TD></TR>
              ))}
              {d.docs.map((doc) => (
                <TR key={doc.id}>
                  <TD><Link href={`/hr/staff/${doc.staffId}`} className="font-medium text-ink hover:text-brand-700">{doc.staff.name}</Link></TD>
                  <TD>{doc.title}</TD>
                  <TD className="whitespace-nowrap">{doc.expiresOn! < t ? <span className="font-medium text-rose-700">Expired {fmtDate(doc.expiresOn)}</span> : fmtDate(doc.expiresOn)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted"><CalendarClock className="size-3.5" /> Holidays come from Circulars &amp; events (type Holiday). Weekly offs and the start time are set under Leave types &amp; rules.</p>
    </>
  );
}
