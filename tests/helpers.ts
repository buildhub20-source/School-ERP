import { db } from "@/lib/db";
import { runWithContext } from "@/lib/context";

/** Main branch + current academic year + an admin user for service-level tests. */
export async function testCtx() {
  const branch = await db.branch.findUniqueOrThrow({ where: { code: "MAIN" } });
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true }, include: { terms: { orderBy: { sequence: "asc" } } } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "superadmin@school.test" } });
  return { branchId: branch.id, year, adminId: admin.id };
}

export const asUser = <T>(userId: string, fn: () => Promise<T>) => runWithContext({ userId, userName: "Test" }, fn);

export const uniq = (p = "T") => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
