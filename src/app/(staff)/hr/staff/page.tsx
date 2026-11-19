import Link from "next/link";
import type { Prisma, StaffCategory } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { CATEGORY_LABEL, EMPLOYMENT_LABEL, loginsWithoutProfile } from "@/server/hr/service";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Pagination, pageParams, sp } from "@/components/ui";
import { FilterBar, FilterSelect, SearchField, ModalForm } from "@/components/ui/client";
import { saveStaffAction } from "../actions";
import { StaffFields } from "../_components/fields";

export const metadata = { title: "Staff" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hr.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const category = sp(s, "category") as StaffCategory | undefined;
  const where: Prisma.StaffProfileWhereInput = {
    branchId: user.branchId,
    isActive: sp(s, "status") !== "left",
    ...(category && category in CATEGORY_LABEL ? { category } : {}),
    ...(sp(s, "departmentId") ? { departmentId: sp(s, "departmentId") } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }, { designation: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const canManage = hasPerm(user, "hr.manage");
  const [total, staff, departments, logins] = await Promise.all([
    db.staffProfile.count({ where }),
    db.staffProfile.findMany({ where, include: { department: true, user: { select: { isActive: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }], skip, take }),
    db.department.findMany({ where: { branchId: user.branchId }, orderBy: { name: "asc" } }),
    canManage ? loginsWithoutProfile(user.branchId) : [],
  ]);
  return (
    <>
      <PageHeader title="Staff" description="Every employee, with or without a login: teaching, office and support staff."
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Staff" }]}
        actions={canManage && (
          <ModalForm trigger="Add staff" icon={<Plus className="size-4" />} title="Add staff member" size="xl" action={saveStaffAction} successMessage="Staff member added" redirectTo="/hr/staff/[id]">
            <StaffFields departments={departments} logins={logins.map((u) => ({ id: u.id, name: `${u.name} · ${u.role.name}` }))} />
          </ModalForm>
        )} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterBar>
            <SearchField placeholder="Name, code, designation or mobile" />
            <FilterSelect name="category" label="All categories" options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="departmentId" label="All departments" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            <FilterSelect name="status" label="Current staff" options={[{ value: "left", label: "Left" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Name</TH><TH>Designation</TH><TH>Department</TH><TH>Employment</TH><TH>Joined</TH><TH>Mobile</TH><TH>Login</TH></tr></THead>
          <TBody>
            {staff.length === 0 && <EmptyRow colSpan={7} message={q ? "No staff match the search." : "No staff yet. Use “Add staff”."} />}
            {staff.map((p) => (
              <TR key={p.id}>
                <TD className="whitespace-nowrap"><Link href={`/hr/staff/${p.id}`} className="font-medium text-ink hover:text-brand-700">{p.name}</Link><span className="block font-mono text-xs text-muted">{p.employeeCode}</span></TD>
                <TD>{p.designation}<span className="block text-xs text-muted">{CATEGORY_LABEL[p.category]}</span></TD>
                <TD>{p.department?.name ?? "—"}</TD>
                <TD>{p.employmentType === "PERMANENT" ? EMPLOYMENT_LABEL[p.employmentType] : <Badge tone={p.employmentType === "PROBATION" ? "yellow" : "blue"}>{EMPLOYMENT_LABEL[p.employmentType]}</Badge>}</TD>
                <TD className="whitespace-nowrap">{p.isActive ? fmtDate(p.joiningDate) : <>Left {fmtDate(p.leftOn)}</>}</TD>
                <TD>{p.phone ?? "—"}</TD>
                <TD>{p.userId ? (p.user?.isActive ? <Badge tone="green">Yes</Badge> : <Badge>Off</Badge>) : <span className="text-muted">—</span>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/hr/staff" />
      </Card>
    </>
  );
}
