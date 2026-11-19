import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { studentWhere } from "@/server/students/service";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, LinkButton, StatusBadge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fullName, fmtDate } from "@/lib/format";
import { Plus, Upload, Download } from "lucide-react";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("students.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const classes = await classOptions(user.branchId);
  const where = studentWhere(user.branchId, { q: sp(s, "q"), classId: sp(s, "classId"), sectionId: sp(s, "sectionId"), status: sp(s, "status"), gender: sp(s, "gender") });
  const [total, students] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({ where, include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, where: { isPrimary: true } } }, orderBy: [{ schoolClass: { grade: "asc" } }, { section: { name: "asc" } }, { firstName: "asc" }], skip, take }),
  ]);
  const selected = classes.find((c) => c.id === sp(s, "classId"));
  const exportQs = new URLSearchParams(Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "page")).toString();
  return (
    <>
      <PageHeader title="Students" description={`${total} student${total === 1 ? "" : "s"}`}
        actions={<>
          <LinkButton href={`/api/students/export?${exportQs}`} variant="secondary"><Download className="size-4" />Excel</LinkButton>
          {hasPerm(user, "students.import") && <LinkButton href="/students/import" variant="secondary"><Upload className="size-4" />Import</LinkButton>}
          {hasPerm(user, "students.manage") && <LinkButton href="/students/new" variant="primary"><Plus className="size-4" />Add student</LinkButton>}
        </>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name, admission no or parent mobile" />
            <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            {selected && <FilterSelect name="sectionId" label="All sections" options={selected.sections.map((x) => ({ value: x.id, label: x.name }))} />}
            <FilterSelect name="gender" label="Any gender" options={[{ value: "MALE", label: "Boys" }, { value: "FEMALE", label: "Girls" }]} />
            <FilterSelect name="status" label="Active" options={[{ value: "LEFT", label: "Left" }, { value: "GRADUATED", label: "Graduated" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Admission no</TH><TH>Class</TH><TH>Parent</TH><TH>Admitted</TH><TH>Status</TH></tr></THead>
          <TBody>
            {students.length === 0 && <EmptyRow colSpan={6} />}
            {students.map((st) => (
              <TR key={st.id}>
                <TD>
                  <Link href={`/students/${st.id}`} className="flex items-center gap-3 font-medium text-slate-900 hover:text-brand-700">
                    {st.photoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={st.photoUrl} alt="" className="size-8 rounded-full object-cover" />
                      : <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">{st.firstName.charAt(0)}</span>}
                    {fullName(st)}
                  </Link>
                </TD>
                <TD className="font-mono text-xs">{st.admissionNo}</TD>
                <TD className="whitespace-nowrap">{st.schoolClass.name}{st.section ? ` - ${st.section.name}` : ""}</TD>
                <TD>{st.guardians[0] ? <>{st.guardians[0].guardian.name}<span className="block text-xs text-slate-500">{st.guardians[0].guardian.phone}</span></> : "—"}</TD>
                <TD>{fmtDate(st.admissionDate)}</TD>
                <TD><StatusBadge status={st.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/students" />
      </Card>
    </>
  );
}
