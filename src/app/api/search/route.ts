import { getUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fullName, money } from "@/lib/format";

/** Global search: student name, admission number, receipt number or bus number. */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !hasPerm(user, "search.global")) return Response.json({ results: [] }, { status: user ? 403 : 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });
  const parts = q.split(/\s+/).filter(Boolean);
  const results: { type: string; label: string; sub?: string; href: string }[] = [];

  if (hasPerm(user, ["students.view", "fees.view", "transport.view", "uniforms.view"])) {
    const students = await db.student.findMany({
      where: {
        branchId: user.branchId,
        OR: [
          { admissionNo: { contains: q, mode: "insensitive" } },
          { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) },
        ],
      },
      include: { schoolClass: true, section: true },
      take: 8,
      orderBy: { firstName: "asc" },
    });
    for (const s of students) results.push({ type: "Student", label: fullName(s), sub: `${s.admissionNo} · ${s.schoolClass.name}${s.section ? "-" + s.section.name : ""}${s.status !== "ACTIVE" ? " · " + s.status : ""}`, href: `/students/${s.id}` });
  }
  if (hasPerm(user, "fees.view")) {
    const receipts = await db.payment.findMany({ where: { branchId: user.branchId, receiptNo: { contains: q, mode: "insensitive" } }, include: { student: true }, take: 5 });
    for (const p of receipts) results.push({ type: "Receipt", label: p.receiptNo!, sub: `${fullName(p.student)} · ${money(p.amount)}`, href: `/fees/payments/${p.id}` });
  }
  if (hasPerm(user, "transport.view")) {
    const buses = await db.bus.findMany({ where: { branchId: user.branchId, OR: [{ busNo: { contains: q, mode: "insensitive" } }, { registrationNo: { contains: q, mode: "insensitive" } }] }, take: 5 });
    for (const b of buses) results.push({ type: "Bus", label: b.busNo, sub: `${b.registrationNo} · capacity ${b.capacity}`, href: `/transport/buses/${b.id}` });
  }
  if (hasPerm(user, ["uniforms.view"])) {
    const orders = await db.uniformOrder.findMany({ where: { branchId: user.branchId, orderNo: { contains: q, mode: "insensitive" } }, include: { student: true }, take: 3 });
    for (const o of orders) results.push({ type: "Order", label: o.orderNo, sub: fullName(o.student), href: `/uniforms/orders/${o.id}` });
  }
  if (hasPerm(user, ["stationery.view"])) {
    const reqs = await db.stationeryRequest.findMany({ where: { branchId: user.branchId, requestNo: { contains: q, mode: "insensitive" } }, include: { requestedBy: true }, take: 3 });
    for (const r of reqs) results.push({ type: "Request", label: r.requestNo, sub: r.requestedBy.name, href: `/stationery/requests/${r.id}` });
  }
  return Response.json({ results });
}
