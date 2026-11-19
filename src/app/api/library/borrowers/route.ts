import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fullName, today } from "@/lib/format";

/** Borrower search for the issue desk: active students (name / admission no) and staff (name). */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("library.circulate"); } catch { return Response.json({ error: "Forbidden" }, { status: 403 }); }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const [students, staff] = await Promise.all([
    db.student.findMany({
      where: { branchId: user.branchId, status: "ACTIVE", OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }] },
      include: { schoolClass: true, section: true, libraryLoans: { where: { returnedAt: null }, select: { dueDate: true } } }, take: 8, orderBy: { firstName: "asc" },
    }),
    db.user.findMany({
      where: { branchId: user.branchId, isActive: true, name: { contains: q, mode: "insensitive" }, role: { NOT: { permissions: { hasSome: ["parent.portal", "driver.portal"] } } } },
      include: { role: true, libraryLoans: { where: { returnedAt: null }, select: { dueDate: true } } }, take: 5, orderBy: { name: "asc" },
    }),
  ]);
  const t = today();
  return Response.json({
    results: [
      ...students.map((s) => ({ value: `student:${s.id}`, label: fullName(s), sub: `${s.admissionNo} · ${s.schoolClass.name}${s.section ? "-" + s.section.name : ""}`, loans: s.libraryLoans.length, overdue: s.libraryLoans.some((l) => l.dueDate < t) })),
      ...staff.map((u) => ({ value: `staff:${u.id}`, label: u.name, sub: `Staff · ${u.role.name}`, loans: u.libraryLoans.length, overdue: u.libraryLoans.some((l) => l.dueDate < t) })),
    ],
  });
}
