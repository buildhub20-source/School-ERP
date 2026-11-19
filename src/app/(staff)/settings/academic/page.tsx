import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { staffOptions } from "@/server/lookups";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, LinkButton } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fmtDate, isoDate } from "@/lib/format";
import { SettingsTabs } from "../tabs";
import { YearForm, ClassForm, DepartmentForm, ClassTeacherSelect } from "./academic-forms";
import { deleteClass, deleteDepartment } from "../actions";

export const metadata = { title: "Academic years & classes" };

export default async function AcademicPage() {
  const user = await requireUser("settings.manage");
  const [years, classes, departments, teachers] = await Promise.all([
    db.academicYear.findMany({ include: { terms: { orderBy: { sequence: "asc" } } }, orderBy: { startDate: "desc" } }),
    db.schoolClass.findMany({ where: { branchId: user.branchId }, include: { sections: { include: { classTeacher: true, _count: { select: { students: { where: { status: "ACTIVE" } } } } }, orderBy: { name: "asc" } } }, orderBy: { grade: "asc" } }),
    db.department.findMany({ where: { branchId: user.branchId }, include: { _count: { select: { users: true } } }, orderBy: { name: "asc" } }),
    staffOptions(user.branchId, ["TEACHER", "SCHOOL_ADMIN"]),
  ]);
  return (
    <>
      <PageHeader title="Settings" description="Academic years and terms, classes with sections and class teachers, departments." />
      <SettingsTabs user={user} active="/settings/academic" />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Academic years" description="Close the current year and roll forward from Students → Promotion & year close."
            actions={<><LinkButton href="/students/promotion" size="sm">Promotion & year close</LinkButton><YearForm /></>} />
          <Table>
            <THead><tr><TH>Year</TH><TH>Dates</TH><TH>Terms</TH><TH>Status</TH><TH /></tr></THead>
            <TBody>
              {years.length === 0 && <EmptyRow colSpan={5} />}
              {years.map((y) => (
                <TR key={y.id}>
                  <TD className="font-medium">{y.name}</TD>
                  <TD>{fmtDate(y.startDate)} – {fmtDate(y.endDate)}</TD>
                  <TD className="text-xs">{y.terms.map((t) => <div key={t.id}>{t.name}: {fmtDate(t.startDate)} – {fmtDate(t.endDate)}{t.duesGeneratedAt && <span className="text-emerald-600"> · dues generated</span>}</div>)}</TD>
                  <TD>{y.isCurrent ? <Badge tone="green">Current</Badge> : y.closedAt ? <Badge>Closed</Badge> : <Badge tone="blue">Upcoming</Badge>}</TD>
                  <TD align="right"><YearForm initial={{ id: y.id, name: y.name, startDate: isoDate(y.startDate), endDate: isoDate(y.endDate), terms: y.terms.map((t) => ({ name: t.name, startDate: isoDate(t.startDate), endDate: isoDate(t.endDate) })) }} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Classes and sections" description="Grade sets the promotion order (a student moves to the class with the next grade)." actions={<ClassForm />} />
          <Table>
            <THead><tr><TH>Class</TH><TH align="center">Grade</TH><TH>Sections · class teacher · students</TH><TH /></tr></THead>
            <TBody>
              {classes.length === 0 && <EmptyRow colSpan={4} />}
              {classes.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD align="center">{c.grade}</TD>
                  <TD>
                    <div className="space-y-1">
                      {c.sections.map((s) => (
                        <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge tone="indigo">{s.name}</Badge>
                          <ClassTeacherSelect sectionId={s.id} value={s.classTeacherId ?? ""} teachers={teachers.map((t) => ({ id: t.id, name: t.name }))} />
                          <span className="text-xs text-slate-500">{s._count.students} students</span>
                        </div>
                      ))}
                    </div>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-2">
                      <ClassForm initial={{ id: c.id, name: c.name, grade: c.grade, sections: c.sections.map((s) => s.name).join(", ") }} />
                      <ActionButton action={deleteClass} args={{ id: c.id }} variant="ghost" confirm={`Delete ${c.name}?`} successMessage="Class deleted">Delete</ActionButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Departments" description="Used for staff and for stationery budgets." actions={<DepartmentForm />} />
          <Table>
            <THead><tr><TH>Department</TH><TH align="right">Staff</TH><TH /></tr></THead>
            <TBody>
              {departments.map((d) => (
                <TR key={d.id}>
                  <TD>{d.name}</TD><TD align="right">{d._count.users}</TD>
                  <TD align="right"><div className="flex justify-end gap-2"><DepartmentForm initial={{ id: d.id, name: d.name }} /><ActionButton action={deleteDepartment} args={{ id: d.id }} variant="ghost" confirm={`Delete ${d.name}?`} successMessage="Department deleted">Delete</ActionButton></div></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
