import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { runWithContext, getRequestContext } from "@/lib/context";
import { getSetting } from "@/lib/settings";
import { automation } from "@/lib/automations/config";
import { notifyGuardians } from "@/lib/messaging/notify";
import { className, fullName } from "@/lib/format";
import { haversineMeters } from "./helpers";

/**
 * TRIPS — driver/attendant app: their bus, trips, GPS pings (+ near-stop alerts), boarding attendance, emergency sheet.
 * A driver or attendant only ever sees the bus they are assigned to (TransportStaff.userId → drivesBus / attendsBus).
 */

const timeFmt = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The signed-in staff member and their bus (null bus when not assigned). */
export async function staffBus(userId: string) {
  const staff = await db.transportStaff.findUnique({ where: { userId }, include: { drivesBus: true, attendsBus: true } });
  if (!staff || !staff.isActive) return { staff: null, bus: null };
  const bus = staff.drivesBus ?? staff.attendsBus;
  return { staff, bus: bus && bus.isActive ? bus : null };
}

async function requireStaffBus(userId: string) {
  const { staff, bus } = await staffBus(userId);
  if (!staff) throw new AppError("Your login is not linked to a driver or attendant record. Contact the transport office.", "FORBIDDEN");
  if (!bus) throw new AppError("You are not assigned to a bus yet. Contact the transport office.", "FORBIDDEN");
  return { staff, bus };
}

export async function activeTrip(busId: string) {
  return db.busTrip.findFirst({ where: { busId, endedAt: null }, orderBy: { startedAt: "desc" } });
}

export async function startTrip(userId: string, type: "PICKUP" | "DROP") {
  const { bus } = await requireStaffBus(userId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Bus" WHERE id = ${bus.id} FOR UPDATE`;
    const open = await tx.busTrip.findFirst({ where: { busId: bus.id, endedAt: null } });
    if (open) throw new AppError(`A ${open.type === "PICKUP" ? "pickup" : "drop"} trip is already running. End it first.`);
    return tx.busTrip.create({ data: { busId: bus.id, type, startedById: userId } });
  });
}

export async function endTrip(userId: string, tripId: string) {
  const { bus } = await requireStaffBus(userId);
  const trip = await db.busTrip.findFirst({ where: { id: tripId, busId: bus.id } });
  if (!trip) throw new AppError("Trip not found.");
  if (trip.endedAt) throw new AppError("This trip has already ended.");
  return db.busTrip.update({ where: { id: trip.id }, data: { endedAt: new Date() } });
}

/** Near-stop radius: automation config `meters`, falling back to the GPS policy. */
async function nearStopMeters(branchId: string) {
  const a = await automation("transport.nearStop");
  if (!a.enabled) return null;
  const m = Number(a.config.meters);
  if (Number.isFinite(m) && m > 0) return m;
  return (await getSetting("policies", branchId)).gpsNearStopMeters;
}

/**
 * Automation "transport.nearStop": for stops on the bus's routes within N metres that have not been notified in this trip,
 * notify guardians of the students allocated to that stop on this bus. TripStopEvent (tripId, stopId) is unique → once per trip.
 */
export async function checkNearStops(tripId: string, lat: number, lng: number) {
  const trip = await db.busTrip.findUniqueOrThrow({ where: { id: tripId }, include: { bus: true } });
  if (trip.endedAt) return [];
  const meters = await nearStopMeters(trip.bus.branchId);
  if (!meters) return [];
  const stops = await db.stop.findMany({ where: { route: { busId: trip.busId, isActive: true }, lat: { not: null }, lng: { not: null }, tripEvents: { none: { tripId } } } });
  const notified: string[] = [];
  for (const stop of stops) {
    if (haversineMeters({ lat, lng }, { lat: stop.lat!, lng: stop.lng! }) > meters) continue;
    try {
      await db.tripStopEvent.create({ data: { tripId, stopId: stop.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // another ping got there first
      throw e;
    }
    notified.push(stop.id);
    const allocs = await db.transportAllocation.findMany({ where: { stopId: stop.id, busId: trip.busId, status: "ACTIVE", student: { status: "ACTIVE" } }, include: { student: true } });
    const verb = trip.type === "PICKUP" ? "Please have your child ready for pickup." : "Please be at the stop to receive your child.";
    for (const a of allocs) {
      await notifyGuardians(a.studentId, {
        title: `${trip.bus.busNo} is near ${stop.name}`,
        body: `${trip.bus.busNo} is about ${Math.round(meters)} m from ${stop.name}. ${verb} (${fullName(a.student)})`,
        link: "/parent/bus", category: "TRANSPORT", template: "BUS_NEAR_STOP",
        ta: {
          title: `${trip.bus.busNo} ${stop.name} அருகில் உள்ளது`,
          body: `${trip.bus.busNo} ${stop.name} இலிருந்து சுமார் ${Math.round(meters)} மீ தொலைவில் உள்ளது. ${trip.type === "PICKUP" ? "உங்கள் குழந்தையை ஏற்றுவதற்கு தயாராக வைத்திருங்கள்." : "உங்கள் குழந்தையைப் பெற நிறுத்தத்தில் இருங்கள்."} (${fullName(a.student)})`,
        },
      });
    }
  }
  return notified;
}

/** GPS ping from the driver's phone while a trip is active. High volume → not audited. */
export async function recordLocation(userId: string, p: { lat: number; lng: number; speed?: number | null }) {
  const { bus } = await requireStaffBus(userId);
  const trip = await activeTrip(bus.id);
  if (!trip) throw new AppError("No active trip. Start a trip to share your location.", "NO_TRIP");
  const ctx = getRequestContext();
  return runWithContext({ ...ctx, skipAudit: true }, async () => {
    const now = new Date();
    await db.busLocation.create({ data: { busId: bus.id, lat: p.lat, lng: p.lng, speed: p.speed ?? null, recordedAt: now } });
    await db.bus.update({ where: { id: bus.id }, data: { lastLat: p.lat, lastLng: p.lng, lastLocationAt: now } });
    const near = await checkNearStops(trip.id, p.lat, p.lng);
    return { tripId: trip.id, nearStops: near.length };
  });
}

/** Mark a student boarded / got off on the active trip (tap or ID-card scan); guardians are notified. */
export async function markBoarding(userId: string, input: { tripId: string; studentId: string; event: "BOARDED" | "ALIGHTED"; method: "APP" | "SCAN" }) {
  const { bus } = await requireStaffBus(userId);
  const trip = await db.busTrip.findFirst({ where: { id: input.tripId, busId: bus.id } });
  if (!trip) throw new AppError("Trip not found.");
  if (trip.endedAt) throw new AppError("This trip has ended. Start a new trip to mark attendance.");
  const alloc = await db.transportAllocation.findFirst({ where: { studentId: input.studentId, busId: bus.id, status: "ACTIVE" }, include: { student: true, stop: true } });
  if (!alloc) throw new AppError(input.method === "SCAN" ? "This student is not allocated to your bus." : "Student not found on your bus.");
  const rec = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BusTrip" WHERE id = ${trip.id} FOR UPDATE`;
    const last = await tx.boardingRecord.findFirst({ where: { tripId: trip.id, studentId: alloc.studentId }, orderBy: { at: "desc" } });
    if (last?.event === input.event) throw new AppError(`${fullName(alloc.student)} is already marked ${input.event === "BOARDED" ? "on the bus" : "off the bus"}.`);
    if (!last && input.event === "ALIGHTED") throw new AppError(`${fullName(alloc.student)} has not been marked as boarded on this trip.`);
    return tx.boardingRecord.create({ data: { tripId: trip.id, studentId: alloc.studentId, event: input.event, method: input.method, markedById: userId } });
  });
  const name = fullName(alloc.student);
  const where = input.event === "BOARDED" ? (trip.type === "PICKUP" ? ` at ${alloc.stop.name}` : " at school") : (trip.type === "DROP" ? ` at ${alloc.stop.name}` : " at school");
  await notifyGuardians(alloc.studentId, {
    title: input.event === "BOARDED" ? `${name} boarded ${bus.busNo}` : `${name} got off ${bus.busNo}`,
    body: `${name} ${input.event === "BOARDED" ? "boarded" : "got off"} ${bus.busNo}${where} at ${timeFmt(rec.at)}.`,
    link: "/parent/bus", category: "TRANSPORT", template: "BUS_BOARDING",
    ta: {
      title: input.event === "BOARDED" ? `${name} ${bus.busNo} இல் ஏறினார்` : `${name} ${bus.busNo} இலிருந்து இறங்கினார்`,
      body: `${name} ${timeFmt(rec.at)} மணிக்கு ${bus.busNo} ${input.event === "BOARDED" ? "இல் ஏறினார்" : "இலிருந்து இறங்கினார்"}${(input.event === "BOARDED") === (trip.type === "PICKUP") ? ` (${alloc.stop.name})` : " (பள்ளி)"}.`,
    },
  });
  return { record: rec, studentName: name };
}

/** Students on a bus with their latest event in a trip. */
export async function tripRoster(busId: string, tripId: string | null) {
  const allocs = await db.transportAllocation.findMany({
    where: { busId, status: "ACTIVE", student: { status: "ACTIVE" } },
    include: { student: { include: { schoolClass: true, section: true } }, stop: true },
    orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
  });
  const records = tripId ? await db.boardingRecord.findMany({ where: { tripId }, orderBy: { at: "asc" } }) : [];
  const last = new Map<string, { event: string; at: Date }>();
  for (const r of records) last.set(r.studentId, { event: r.event, at: r.at });
  return allocs.map((a) => ({
    studentId: a.studentId, name: fullName(a.student), admissionNo: a.student.admissionNo, className: className(a.student.schoolClass, a.student.section),
    photoUrl: a.student.photoUrl, stopName: a.stop.name, stopSeq: a.stop.sequence, pickupTime: a.stop.pickupTime, dropTime: a.stop.dropTime,
    last: last.get(a.studentId) ?? null,
  }));
}

export type EmergencySheet = {
  busNo: string; registrationNo: string; routes: string[]; driver: { name: string; phone: string } | null; attendant: { name: string; phone: string } | null;
  schoolPhone: string; generatedAt: string;
  students: { id: string; name: string; admissionNo: string; className: string; stop: string; bloodGroup: string | null; medicalNotes: string | null; emergencyPhone: string | null; contacts: { name: string; relation: string; phone: string }[] }[];
};

/** Per-bus list of students with parent phone numbers and medical notes (cached on the phone for offline use). */
export async function emergencySheet(busId: string): Promise<EmergencySheet> {
  const bus = await db.bus.findUniqueOrThrow({ where: { id: busId }, include: { driver: true, attendant: true, routes: { where: { isActive: true } } } });
  const school = await getSetting("school", bus.branchId);
  const allocs = await db.transportAllocation.findMany({
    where: { busId, status: "ACTIVE", student: { status: "ACTIVE" } },
    include: { stop: true, student: { include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } } },
    orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
  });
  return {
    busNo: bus.busNo, registrationNo: bus.registrationNo, routes: bus.routes.map((r) => `${r.code} · ${r.name}`),
    driver: bus.driver ? { name: bus.driver.name, phone: bus.driver.phone } : null,
    attendant: bus.attendant ? { name: bus.attendant.name, phone: bus.attendant.phone } : null,
    schoolPhone: school.phone, generatedAt: new Date().toISOString(),
    students: allocs.map((a) => ({
      id: a.studentId, name: fullName(a.student), admissionNo: a.student.admissionNo, className: className(a.student.schoolClass, a.student.section), stop: a.stop.name,
      bloodGroup: a.student.bloodGroup, medicalNotes: a.student.medicalNotes, emergencyPhone: a.student.emergencyPhone,
      contacts: a.student.guardians.map((g) => ({ name: g.guardian.name, relation: g.relation, phone: g.guardian.phone })),
    })),
  };
}

/** Last known position + trip state of every active bus in a branch (live map). */
export async function liveBuses(branchId: string) {
  const buses = await db.bus.findMany({
    where: { branchId, isActive: true },
    include: { driver: true, routes: { where: { isActive: true }, select: { name: true, code: true } }, trips: { where: { endedAt: null }, take: 1, orderBy: { startedAt: "desc" } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } },
    orderBy: { busNo: "asc" },
  });
  return buses.map((b) => ({
    id: b.id, busNo: b.busNo, registrationNo: b.registrationNo, driver: b.driver?.name ?? null, driverPhone: b.driver?.phone ?? null,
    routes: b.routes.map((r) => r.code).join(", "), students: b._count.allocations, capacity: b.capacity,
    lat: b.lastLat, lng: b.lastLng, at: b.lastLocationAt?.toISOString() ?? null,
    trip: b.trips[0] ? { id: b.trips[0].id, type: b.trips[0].type, startedAt: b.trips[0].startedAt.toISOString() } : null,
  }));
}

/** What a parent may see about one child's bus (caller has already verified the parent link). */
export async function parentBusInfo(studentId: string) {
  const alloc = await db.transportAllocation.findFirst({
    where: { studentId, status: "ACTIVE" },
    include: { bus: { include: { driver: true, attendant: true } }, route: { include: { stops: { orderBy: { sequence: "asc" } } } }, stop: true },
  });
  if (!alloc) return null;
  const trip = await activeTrip(alloc.busId);
  const lastBoarding = await db.boardingRecord.findFirst({ where: { studentId }, orderBy: { at: "desc" }, include: { trip: true } });
  const stale = alloc.bus.lastLocationAt && trip ? alloc.bus.lastLocationAt < trip.startedAt : true;
  return {
    busNo: alloc.bus.busNo, registrationNo: alloc.bus.registrationNo, routeName: alloc.route.name, routeCode: alloc.route.code,
    stop: { id: alloc.stop.id, name: alloc.stop.name, lat: alloc.stop.lat, lng: alloc.stop.lng, pickupTime: alloc.stop.pickupTime, dropTime: alloc.stop.dropTime },
    routeStops: alloc.route.stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ id: s.id, name: s.name, lat: s.lat!, lng: s.lng! })),
    driver: alloc.bus.driver ? { name: alloc.bus.driver.name, phone: alloc.bus.driver.phone } : null,
    attendant: alloc.bus.attendant ? { name: alloc.bus.attendant.name, phone: alloc.bus.attendant.phone } : null,
    trip: trip ? { type: trip.type, startedAt: trip.startedAt.toISOString() } : null,
    location: trip && !stale && alloc.bus.lastLat !== null && alloc.bus.lastLng !== null ? { lat: alloc.bus.lastLat, lng: alloc.bus.lastLng!, at: alloc.bus.lastLocationAt!.toISOString() } : null,
    lastBoarding: lastBoarding ? { event: lastBoarding.event, at: lastBoarding.at.toISOString(), tripType: lastBoarding.trip.type } : null,
  };
}
