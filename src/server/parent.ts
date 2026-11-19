import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, requireUserOrThrow } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

/** For parent portal pages: the signed-in parent and their children. Parents only ever see their own children. */
export async function requireParent() {
  const user = await requireUser("parent.portal");
  const guardian = await db.guardian.findUnique({ where: { userId: user.id } });
  const children = guardian
    ? await db.student.findMany({ where: { guardians: { some: { guardianId: guardian.id } }, status: "ACTIVE" }, include: { schoolClass: true, section: true }, orderBy: { dob: "asc" } })
    : [];
  return { user, guardian, children };
}

/** Load one of the parent's own children or 404. */
export async function parentChild(studentId: string) {
  const p = await requireParent();
  const child = p.children.find((c) => c.id === studentId);
  if (!child) notFound();
  return { ...p, child };
}

/** For parent actions/API routes: throws unless the student belongs to the signed-in parent. Returns the user. */
export async function assertParentOf(studentId: string) {
  const user = await requireUserOrThrow("parent.portal");
  const link = await db.studentGuardian.findFirst({ where: { studentId, guardian: { userId: user.id } } });
  if (!link) throw new AppError("You can only view your own children's information.", "FORBIDDEN");
  return user;
}
