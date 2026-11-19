import "server-only";
import { db } from "@/lib/db";

/** Commonly used dropdown data. */
export async function classOptions(branchId: string) {
  const classes = await db.schoolClass.findMany({ where: { branchId }, include: { sections: { orderBy: { name: "asc" } } }, orderBy: { grade: "asc" } });
  return classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade, sections: c.sections.map((s) => ({ id: s.id, name: s.name })) }));
}
export type ClassOption = Awaited<ReturnType<typeof classOptions>>[number];

export async function staffOptions(branchId: string, roleKeys?: string[]) {
  return db.user.findMany({
    where: { branchId, isActive: true, role: { key: roleKeys ? { in: roleKeys } : { notIn: ["PARENT", "DRIVER"] } } },
    select: { id: true, name: true, role: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
}

export async function departmentOptions(branchId: string) {
  return db.department.findMany({ where: { branchId }, orderBy: { name: "asc" } });
}
