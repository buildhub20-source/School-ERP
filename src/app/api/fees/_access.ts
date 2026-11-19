import "server-only";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth/session";
import { feeScope, type FeeScope } from "@/server/fees/access";

/** Who may download a student's fee documents: their guardian (parent portal) or staff with a fee scope in the same branch. */
export async function feeDocAccess(studentId: string): Promise<{ ok: true; scope: FeeScope } | { ok: false; status: number }> {
  const user = await getUser();
  if (!user) return { ok: false, status: 401 };
  if (user.permissions.includes("parent.portal")) {
    const link = await db.studentGuardian.findFirst({ where: { studentId, guardian: { userId: user.id } } });
    return link ? { ok: true, scope: "full" } : { ok: false, status: 403 };
  }
  const scope = feeScope(user);
  if (!scope) return { ok: false, status: 403 };
  const s = await db.student.findFirst({ where: { id: studentId, branchId: user.branchId }, select: { id: true } });
  return s ? { ok: true, scope } : { ok: false, status: 404 };
}
