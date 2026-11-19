import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, EmptyState, LinkButton } from "@/components/ui";
import { fullName, fmtDate } from "@/lib/format";
import { Printer, ClipboardCheck } from "lucide-react";

export const metadata = { title: "My class" };

export default async function MyClassPage() {
  const user = await requireUser("class.view");
  const sections = await db.section.findMany({ where: { classTeacherId: user.id }, include: { schoolClass: true } });
  const lists = await Promise.all(sections.map((s) => db.student.findMany({
    where: { sectionId: s.id, status: "ACTIVE" },
    include: { guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } }, allocations: { where: { status: "ACTIVE" }, include: { bus: true, stop: true } } },
    orderBy: [{ rollNo: "asc" }, { firstName: "asc" }],
  })));
  return (
    <>
      <PageHeader title="My class" description="Students in the sections where you are the class teacher." />
      {sections.length === 0 && <EmptyState title="You are not a class teacher yet" description="The administrator assigns class teachers in Settings → Academic years & classes." />}
      <div className="space-y-5">
        {sections.map((s, i) => (
          <Card key={s.id}>
            <CardHeader title={`${s.schoolClass.name} - ${s.name}`} description={`${lists[i].length} students`}
              actions={<>
                {hasPerm(user, ["attendance.mark", "attendance.manage"]) && <LinkButton href={`/attendance/mark?sectionId=${s.id}`} size="sm" variant="primary"><ClipboardCheck className="size-4" />Mark attendance</LinkButton>}
                {hasPerm(user, "reports.students") && <LinkButton href={`/api/reports/students-contacts?format=pdf&sectionId=${s.id}`} target="_blank" size="sm"><Printer className="size-4" />Print list</LinkButton>}
              </>} />
            <Table>
              <THead><tr><TH>Roll</TH><TH>Student</TH><TH>Date of birth</TH><TH>Parents</TH><TH>Bus</TH><TH>Medical notes</TH></tr></THead>
              <TBody>
                {lists[i].length === 0 && <EmptyRow colSpan={6} />}
                {lists[i].map((st) => (
                  <TR key={st.id}>
                    <TD>{st.rollNo}</TD>
                    <TD className="font-medium">{hasPerm(user, "students.view") ? <Link href={`/students/${st.id}`} className="hover:text-brand-700">{fullName(st)}</Link> : fullName(st)}<span className="block text-xs font-normal text-slate-500">{st.admissionNo}</span></TD>
                    <TD>{fmtDate(st.dob)}</TD>
                    <TD className="text-xs">{st.guardians.map((g) => <div key={g.guardianId}>{g.guardian.name} ({g.relation}) <a href={`tel:${g.guardian.phone}`} className="text-brand-700">{g.guardian.phone}</a></div>)}</TD>
                    <TD className="text-xs">{st.allocations[0] ? `${st.allocations[0].bus.busNo} · ${st.allocations[0].stop.name}` : "—"}</TD>
                    <TD className="text-xs">{st.medicalNotes ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        ))}
      </div>
    </>
  );
}
