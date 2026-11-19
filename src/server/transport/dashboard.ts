import "server-only";
import { db } from "@/lib/db";
import { today } from "@/lib/format";
import { automation } from "@/lib/automations/config";
import { DOC_LABELS, serviceDueInfo } from "./helpers";

async function alertWindow() {
  const [doc, svc] = await Promise.all([automation("transport.docExpiry"), automation("transport.serviceDue")]);
  return {
    daysBefore: Number(doc.config.daysBefore ?? 30) || 30,
    daysAhead: Number(svc.config.daysAhead ?? 7) || 7,
    kmAhead: Number(svc.config.kmAhead ?? 500) || 500,
  };
}

/** Current documents of a branch expiring within the alert window (or already expired), soonest first. */
export async function expiringDocuments(branchId: string, daysBefore?: number) {
  const days = daysBefore ?? (await alertWindow()).daysBefore;
  const limit = new Date(today().getTime() + days * 86400000);
  return db.transportDocument.findMany({
    where: { isCurrent: true, expiryDate: { lte: limit }, OR: [{ bus: { branchId } }, { staff: { branchId } }] },
    include: { bus: true, staff: { include: { drivesBus: true } } },
    orderBy: { expiryDate: "asc" },
  });
}

/** Buses due (or overdue) for service by date or km, plus any with an OPEN reminder. */
export async function busesDueForService(branchId: string) {
  const w = await alertWindow();
  const t = today();
  const buses = await db.bus.findMany({ where: { branchId, isActive: true }, include: { reminders: { where: { status: "OPEN" } } }, orderBy: { busNo: "asc" } });
  const out: { busId: string; busNo: string; reason: string }[] = [];
  for (const b of buses) {
    const info = serviceDueInfo(b, t, w);
    if (info.reason) out.push({ busId: b.id, busNo: b.busNo, reason: info.reason });
    else if (b.reminders.length) out.push({ busId: b.id, busNo: b.busNo, reason: "open maintenance reminder" });
  }
  return out;
}

export async function transportDashboard(branchId: string): Promise<{
  buses: number; routes: number; seats: number; seatsFilled: number; studentsUsingTransport: number;
  docsExpiringSoon: { id: string; busNo: string; type: string; expiryDate: Date }[];
  busesDueForService: { busId: string; busNo: string; reason: string }[];
}> {
  const [buses, routes, seatAgg, seatsFilled, students, docs, due] = await Promise.all([
    db.bus.count({ where: { branchId, isActive: true } }),
    db.route.count({ where: { branchId, isActive: true } }),
    db.bus.aggregate({ where: { branchId, isActive: true }, _sum: { capacity: true } }),
    db.transportAllocation.count({ where: { status: "ACTIVE", bus: { branchId, isActive: true } } }),
    db.transportAllocation.findMany({ where: { status: "ACTIVE", student: { branchId, status: "ACTIVE" } }, distinct: ["studentId"], select: { studentId: true } }),
    expiringDocuments(branchId),
    busesDueForService(branchId),
  ]);
  return {
    buses, routes, seats: seatAgg._sum.capacity ?? 0, seatsFilled, studentsUsingTransport: students.length,
    docsExpiringSoon: docs.map((d) => ({
      id: d.id,
      busNo: d.bus?.busNo ?? (d.staff ? `${d.staff.name}${d.staff.drivesBus ? ` (${d.staff.drivesBus.busNo})` : ""}` : "—"),
      type: DOC_LABELS[d.type] ?? d.type, expiryDate: d.expiryDate,
    })),
    busesDueForService: due,
  };
}

/** Parent home tile: one row per child who has an active bus allocation. */
export async function parentBusSummary(studentIds: string[]): Promise<{ studentId: string; busNo: string; stopName: string; pickupTime: string | null; tripActive: boolean }[]> {
  if (!studentIds.length) return [];
  const allocs = await db.transportAllocation.findMany({ where: { studentId: { in: studentIds }, status: "ACTIVE" }, include: { bus: { include: { trips: { where: { endedAt: null }, take: 1 } } }, stop: true } });
  return studentIds.flatMap((id) => {
    const a = allocs.find((x) => x.studentId === id);
    return a ? [{ studentId: id, busNo: a.bus.busNo, stopName: a.stop.name, pickupTime: a.stop.pickupTime, tripActive: a.bus.trips.length > 0 }] : [];
  });
}
