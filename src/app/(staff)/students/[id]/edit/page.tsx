import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions, staffOptions } from "@/server/lookups";
import { PageHeader } from "@/components/ui";
import { fullName, isoDate } from "@/lib/format";
import { StudentForm } from "../../student-form";

export const metadata = { title: "Edit student" };

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("students.manage");
  const { id } = await params;
  const s = await db.student.findFirst({ where: { id, branchId: user.branchId }, include: { guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } });
  if (!s) notFound();
  const [classes, staff] = await Promise.all([classOptions(user.branchId), staffOptions(user.branchId)]);
  return (
    <>
      <PageHeader title={`Edit ${fullName(s)}`} breadcrumbs={[{ label: "Students", href: "/students" }, { label: fullName(s), href: `/students/${s.id}` }, { label: "Edit" }]} />
      <StudentForm classes={classes} staff={staff} initial={{
        ...s, dob: s.dob ? isoDate(s.dob) : undefined, admissionDate: isoDate(s.admissionDate),
        guardians: s.guardians.map((g) => ({ relation: g.relation, name: g.guardian.name, phone: g.guardian.phone, email: g.guardian.email, occupation: g.guardian.occupation })),
      }} />
    </>
  );
}
