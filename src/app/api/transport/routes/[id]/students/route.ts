import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPdf, pdfTable } from "@/lib/pdf";
import { pdfResponse } from "@/lib/excel";
import { className, fullName, isoDate } from "@/lib/format";

/** Printable route-wise student list (optionally one stop). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUserOrThrow("transport.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const { id } = await params;
  const stopId = new URL(req.url).searchParams.get("stopId") || undefined;
  const route = await db.route.findFirst({ where: { id, branchId: user.branchId }, include: { bus: { include: { driver: true, attendant: true } } } });
  if (!route) return new Response("Not found", { status: 404 });
  const allocs = await db.transportAllocation.findMany({
    where: { routeId: route.id, status: "ACTIVE", ...(stopId ? { stopId } : {}) },
    include: { bus: true, stop: true, student: { include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" }, take: 1 } } } },
    orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
  });
  const crew = [route.bus && `Bus: ${route.bus.busNo} (${route.bus.registrationNo})`, route.bus?.driver && `Driver: ${route.bus.driver.name} ${route.bus.driver.phone}`, route.bus?.attendant && `Attendant: ${route.bus.attendant.name} ${route.bus.attendant.phone}`].filter(Boolean).join("   ");
  const pdf = await createPdf({ title: `Route ${route.code} · ${route.name} — student list`, subtitle: `${crew}${crew ? "   ·   " : ""}${allocs.length} students`, layout: "landscape", branchId: user.branchId });
  pdfTable(pdf.doc, [
    { key: "n", label: "#", width: 26, align: "right" }, { key: "stop", label: "Stop", width: 130 }, { key: "pickup", label: "Pickup", width: 46 }, { key: "drop", label: "Drop", width: 46 },
    { key: "student", label: "Student" }, { key: "adm", label: "Adm. no", width: 80 }, { key: "class", label: "Class", width: 70 }, { key: "bus", label: "Bus", width: 50 },
    { key: "parent", label: "Parent" }, { key: "phone", label: "Phone", width: 76 },
  ], allocs.map((a, i) => ({
    n: i + 1, stop: `${a.stop.sequence}. ${a.stop.name}`, pickup: a.stop.pickupTime ?? "", drop: a.stop.dropTime ?? "", student: fullName(a.student), adm: a.student.admissionNo,
    class: className(a.student.schoolClass, a.student.section), bus: a.bus.busNo, parent: a.student.guardians[0]?.guardian.name ?? "", phone: a.student.guardians[0]?.guardian.phone ?? "",
  })));
  return pdfResponse(await pdf.finish(), `route-${route.code}-students-${isoDate()}.pdf`);
}
