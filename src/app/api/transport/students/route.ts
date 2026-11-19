import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { className, fullName } from "@/lib/format";

/** Student lookup for the allocation form: active students by name / admission no, with their current bus. */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("transport.manage"); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 403 }); }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ students: [] });
  const parts = q.split(/\s+/).filter(Boolean);
  const list = await db.student.findMany({
    where: { branchId: user.branchId, status: "ACTIVE", OR: [{ admissionNo: { contains: q, mode: "insensitive" } }, { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) }] },
    include: { schoolClass: true, section: true, allocations: { where: { status: "ACTIVE" }, include: { bus: true } } },
    orderBy: { firstName: "asc" }, take: 10,
  });
  return Response.json({ students: list.map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, className: className(s.schoolClass, s.section), address: s.address, currentBus: s.allocations[0]?.bus.busNo ?? null })) });
}
