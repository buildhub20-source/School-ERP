import { requireUser } from "@/lib/auth/session";
import { classOptions, staffOptions } from "@/server/lookups";
import { PageHeader } from "@/components/ui";
import { StudentForm } from "../student-form";

export const metadata = { title: "Add student" };

export default async function NewStudentPage() {
  const user = await requireUser("students.manage");
  const [classes, staff] = await Promise.all([classOptions(user.branchId), staffOptions(user.branchId)]);
  return (
    <>
      <PageHeader title="Add student" breadcrumbs={[{ label: "Students", href: "/students" }, { label: "Add" }]} />
      <StudentForm classes={classes} staff={staff} />
    </>
  );
}
