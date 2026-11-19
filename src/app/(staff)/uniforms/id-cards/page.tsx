import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { PageHeader, Card, sp, LinkButton } from "@/components/ui";
import { FilterBar, FilterSelect, SearchField } from "@/components/ui/client";
import { fmtDate, fullName } from "@/lib/format";
import { IdCardPicker } from "../_components/forms";
import { Printer } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "ID cards" };

export default async function IdCardsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["uniforms.manage", "uniforms.orders", "students.manage"]);
  const s = await searchParams;
  const classes = await classOptions(user.branchId);
  const classId = sp(s, "classId");
  const sectionId = sp(s, "sectionId");
  const q = sp(s, "q");
  const selected = classes.find((c) => c.id === classId);
  const where: Prisma.StudentWhereInput | null = classId || q ? {
    branchId: user.branchId, status: "ACTIVE",
    ...(classId ? { classId } : {}), ...(sectionId ? { sectionId } : {}),
    ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }] } : {}),
  } : null;
  const students = where ? await db.student.findMany({ where, include: { schoolClass: true, section: true, idCards: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ schoolClass: { grade: "asc" } }, { section: { name: "asc" } }, { firstName: "asc" }], take: 200 }) : [];
  const bulk = sectionId ? `/api/uniforms/id-cards?sectionId=${sectionId}` : classId ? `/api/uniforms/id-cards?classId=${classId}` : null;
  return (
    <>
      <PageHeader title="ID cards" description="Print ID cards with photo, class, blood group, bus route and a QR code from student records." breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "ID cards" }]}
        actions={bulk && <LinkButton href={bulk} target="_blank" variant="secondary"><Printer className="size-4" />Print whole {sectionId ? "section" : "class"}</LinkButton>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name or admission no" />
            <FilterSelect name="classId" label="Choose class" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            {selected && <FilterSelect name="sectionId" label="All sections" options={selected.sections.map((x) => ({ value: x.id, label: x.name }))} />}
          </FilterBar>
        </div>
        <IdCardPicker students={students.map((st) => ({ id: st.id, name: fullName(st), admissionNo: st.admissionNo, className: `${st.schoolClass.name}${st.section ? ` - ${st.section.name}` : ""}`, lastPrinted: st.idCards[0] ? fmtDate(st.idCards[0].createdAt) : null, hasPhoto: !!st.photoUrl }))} />
      </Card>
    </>
  );
}
