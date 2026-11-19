import "server-only";
import type { DocType, StaffType } from "@prisma/client";
import { db, type DbOrTx, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSetting, currentAcademicYear } from "@/lib/settings";
import { addDays, dateOnly, today, toNum } from "@/lib/format";
import { recalcFee } from "@/server/fees/core";
import { checkCapacity, createTransportFees, endAllocation, seatsTaken } from "./core";

/**
 * TRANSPORT SERVICE — buses, staff, routes/stops, fee slabs, allocations, documents and maintenance.
 * All functions are branch-scoped. Run them inside defineAction / runWithContext so writes are audited.
 */

const TX = { timeout: 30000, maxWait: 10000 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lock bus rows (in id order to avoid deadlocks) so two allocations can never take the same last seat. */
async function lockBuses(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT id FROM "Bus" WHERE id = ${id} FOR UPDATE`;
}

async function busInBranch(client: DbOrTx, branchId: string, busId: string) {
  const bus = await client.bus.findFirst({ where: { id: busId, branchId } });
  if (!bus) throw new AppError("Bus not found.");
  return bus;
}

// ───────────────────────── Buses ─────────────────────────

export type BusInput = {
  id?: string; busNo: string; registrationNo: string; capacity: number; make?: string; model?: string; year?: number;
  odometerKm?: number; serviceIntervalKm: number; serviceIntervalDays: number; lastServiceDate?: Date; lastServiceKm?: number; isActive?: boolean;
};

export async function saveBus(branchId: string, input: BusInput) {
  const reg = input.registrationNo.toUpperCase().replace(/\s+/g, " ").trim();
  if (input.capacity < 1 || input.capacity > 120) throw new AppError("Capacity must be between 1 and 120 seats.", "VALIDATION", { capacity: "1–120" });
  const dup = await db.bus.findFirst({ where: { branchId, busNo: { equals: input.busNo, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (dup) throw new AppError(`Another bus is already called "${input.busNo}".`, "VALIDATION", { busNo: "Already used" });
  const data = {
    busNo: input.busNo, registrationNo: reg, capacity: input.capacity, make: input.make ?? null, model: input.model ?? null, year: input.year ?? null,
    serviceIntervalKm: input.serviceIntervalKm, serviceIntervalDays: input.serviceIntervalDays,
    lastServiceDate: input.lastServiceDate ? dateOnly(input.lastServiceDate) : null, lastServiceKm: input.lastServiceKm ?? null,
    ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  if (!input.id) return db.bus.create({ data: { ...data, branchId } });
  return db.$transaction(async (tx) => {
    await lockBuses(tx, [input.id!]);
    const bus = await busInBranch(tx, branchId, input.id!);
    const taken = await seatsTaken(tx, bus.id);
    if (input.capacity < taken) throw new AppError(`${taken} students are allocated to ${bus.busNo}; capacity cannot be less than that.`, "VALIDATION", { capacity: `At least ${taken}` });
    if (input.odometerKm !== undefined && input.odometerKm < bus.odometerKm) throw new AppError(`Odometer cannot go back (currently ${bus.odometerKm} km).`, "VALIDATION", { odometerKm: `At least ${bus.odometerKm}` });
    if (input.isActive === false && taken > 0) throw new AppError(`Move the ${taken} students on ${bus.busNo} to another bus before deactivating it.`);
    return tx.bus.update({ where: { id: bus.id }, data });
  }, TX);
}

export async function setBusActive(branchId: string, busId: string, active: boolean) {
  return db.$transaction(async (tx) => {
    await lockBuses(tx, [busId]);
    const bus = await busInBranch(tx, branchId, busId);
    if (!active) {
      const taken = await seatsTaken(tx, bus.id);
      if (taken > 0) throw new AppError(`Move the ${taken} students on ${bus.busNo} to another bus before deactivating it.`);
      await tx.route.updateMany({ where: { busId: bus.id }, data: { busId: null } });
    }
    return tx.bus.update({ where: { id: bus.id }, data: { isActive: active, ...(active ? {} : { driverId: null, attendantId: null }) } });
  }, TX);
}

/** Assign (or clear) the driver and attendant of a bus. A staff member moves off any other bus they were on. */
export async function assignCrew(branchId: string, busId: string, driverId: string | null, attendantId: string | null) {
  return db.$transaction(async (tx) => {
    const bus = await busInBranch(tx, branchId, busId);
    if (driverId) {
      const d = await tx.transportStaff.findFirst({ where: { id: driverId, branchId, isActive: true } });
      if (!d || d.type !== "DRIVER") throw new AppError("Choose an active driver.");
      await tx.bus.updateMany({ where: { driverId, id: { not: bus.id } }, data: { driverId: null } });
    }
    if (attendantId) {
      const a = await tx.transportStaff.findFirst({ where: { id: attendantId, branchId, isActive: true } });
      if (!a || a.type !== "ATTENDANT") throw new AppError("Choose an active attendant.");
      await tx.bus.updateMany({ where: { attendantId, id: { not: bus.id } }, data: { attendantId: null } });
    }
    return tx.bus.update({ where: { id: bus.id }, data: { driverId, attendantId } });
  }, TX);
}

// ───────────────────────── Staff ─────────────────────────

export type StaffInput = { id?: string; type: StaffType; name: string; phone: string; licenseNo?: string; address?: string; isActive?: boolean };

export async function saveStaff(branchId: string, input: StaffInput) {
  if (input.type === "DRIVER" && !input.licenseNo) throw new AppError("Enter the driving licence number.", "VALIDATION", { licenseNo: "Required for drivers" });
  return db.$transaction(async (tx) => {
    const data = { type: input.type, name: input.name, phone: input.phone, licenseNo: input.licenseNo ?? null, address: input.address ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
    if (!input.id) return tx.transportStaff.create({ data: { ...data, branchId } });
    const s = await tx.transportStaff.findFirst({ where: { id: input.id, branchId }, include: { drivesBus: true, attendsBus: true } });
    if (!s) throw new AppError("Staff member not found.");
    if (s.type !== input.type && (s.drivesBus || s.attendsBus)) throw new AppError("Remove this person from their bus before changing their role.");
    if (s.userId) {
      const clash = await tx.user.findFirst({ where: { phone: input.phone, id: { not: s.userId } } });
      if (clash) throw new AppError("This mobile number is already used by another login.", "VALIDATION", { phone: "Already used" });
      await tx.user.update({ where: { id: s.userId }, data: { name: input.name, phone: input.phone, ...(input.isActive === false ? { isActive: false } : {}) } });
      if (input.isActive === false) await tx.session.deleteMany({ where: { userId: s.userId } });
    }
    if (input.isActive === false) {
      await tx.bus.updateMany({ where: { driverId: s.id }, data: { driverId: null } });
      await tx.bus.updateMany({ where: { attendantId: s.id }, data: { attendantId: null } });
    }
    return tx.transportStaff.update({ where: { id: s.id }, data });
  }, TX);
}

/** Create (or re-activate) a DRIVER-role login so the staff member can sign in by OTP on their mobile. */
export async function enableStaffLogin(branchId: string, staffId: string) {
  return db.$transaction(async (tx) => {
    const s = await tx.transportStaff.findFirst({ where: { id: staffId, branchId } });
    if (!s) throw new AppError("Staff member not found.");
    if (!s.isActive) throw new AppError("Activate this staff member first.");
    if (!/^\d{10}$/.test(s.phone)) throw new AppError("Add a valid 10-digit mobile number first.");
    if (s.userId) {
      const u = await tx.user.update({ where: { id: s.userId }, data: { isActive: true, phone: s.phone, name: s.name } });
      return u;
    }
    const role = await tx.role.findUniqueOrThrow({ where: { key: "DRIVER" } });
    const existing = await tx.user.findUnique({ where: { phone: s.phone }, include: { role: true, transportStaff: true } });
    if (existing) throw new AppError(`The mobile number ${s.phone} already has a ${existing.role.name} login. Use a different number for the app.`);
    const user = await tx.user.create({ data: { branchId, roleId: role.id, name: s.name, phone: s.phone, preferredChannel: "SMS" } });
    await tx.transportStaff.update({ where: { id: s.id }, data: { userId: user.id } });
    return user;
  }, TX);
}

export async function disableStaffLogin(branchId: string, staffId: string) {
  const s = await db.transportStaff.findFirst({ where: { id: staffId, branchId } });
  if (!s?.userId) throw new AppError("This staff member has no app login.");
  await db.user.update({ where: { id: s.userId }, data: { isActive: false } });
  await db.session.deleteMany({ where: { userId: s.userId } });
  return true;
}

// ───────────────────────── Routes & stops ─────────────────────────

export type RouteInput = { id?: string; code: string; name: string; description?: string; busId?: string | null; isActive?: boolean };

export async function saveRoute(branchId: string, input: RouteInput) {
  const code = input.code.toUpperCase().trim();
  if (input.busId) await busInBranch(db, branchId, input.busId);
  const data = { code, name: input.name, description: input.description ?? null, busId: input.busId ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  if (!input.id) return db.route.create({ data: { ...data, branchId } });
  const r = await db.route.findFirst({ where: { id: input.id, branchId } });
  if (!r) throw new AppError("Route not found.");
  if (input.isActive === false) {
    const n = await db.transportAllocation.count({ where: { routeId: r.id, status: "ACTIVE" } });
    if (n) throw new AppError(`${n} students are allocated to this route. Move them before deactivating it.`);
  }
  return db.route.update({ where: { id: r.id }, data });
}

export type StopInput = {
  id?: string; routeId: string; name: string; sequence?: number; lat?: number; lng?: number;
  pickupTime?: string; dropTime?: string; distanceKm: number; feeAmount?: number | null;
};

export async function saveStop(branchId: string, input: StopInput) {
  const route = await db.route.findFirst({ where: { id: input.routeId, branchId } });
  if (!route) throw new AppError("Route not found.");
  for (const k of ["pickupTime", "dropTime"] as const) {
    if (input[k] && !TIME_RE.test(input[k]!)) throw new AppError("Use 24-hour time like 07:15.", "VALIDATION", { [k]: "HH:MM" });
  }
  if ((input.lat === undefined) !== (input.lng === undefined)) throw new AppError("Pick the stop location on the map (both latitude and longitude).");
  if (input.lat !== undefined && (Math.abs(input.lat) > 90 || Math.abs(input.lng!) > 180)) throw new AppError("Latitude/longitude out of range.");
  return db.$transaction(async (tx) => {
    const count = await tx.stop.count({ where: { routeId: route.id } });
    const data = {
      name: input.name, lat: input.lat ?? null, lng: input.lng ?? null, pickupTime: input.pickupTime ?? null, dropTime: input.dropTime ?? null,
      distanceKm: input.distanceKm, feeAmount: input.feeAmount ?? null,
    };
    if (!input.id) {
      const seq = Math.min(Math.max(1, input.sequence ?? count + 1), count + 1);
      await tx.stop.updateMany({ where: { routeId: route.id, sequence: { gte: seq } }, data: { sequence: { increment: 1 } } });
      return tx.stop.create({ data: { ...data, routeId: route.id, sequence: seq } });
    }
    const s = await tx.stop.findFirst({ where: { id: input.id, routeId: route.id } });
    if (!s) throw new AppError("Stop not found.");
    const updated = await tx.stop.update({ where: { id: s.id }, data });
    if (input.sequence && input.sequence !== s.sequence) await resequence(tx, route.id, s.id, input.sequence);
    return updated;
  }, TX);
}

/** Move a stop to position `to` and renumber the route's stops 1..n. */
async function resequence(tx: Tx, routeId: string, stopId: string, to: number) {
  const stops = await tx.stop.findMany({ where: { routeId }, orderBy: [{ sequence: "asc" }, { name: "asc" }] });
  const list = stops.filter((s) => s.id !== stopId);
  const moving = stops.find((s) => s.id === stopId)!;
  list.splice(Math.min(Math.max(0, to - 1), list.length), 0, moving);
  for (const [i, s] of list.entries()) if (s.sequence !== i + 1) await tx.stop.update({ where: { id: s.id }, data: { sequence: i + 1 } });
}

export async function moveStop(branchId: string, stopId: string, dir: "up" | "down") {
  const s = await db.stop.findFirst({ where: { id: stopId, route: { branchId } } });
  if (!s) throw new AppError("Stop not found.");
  return db.$transaction((tx) => resequence(tx, s.routeId, s.id, s.sequence + (dir === "up" ? -1 : 1)), TX);
}

export async function deleteStop(branchId: string, stopId: string) {
  const s = await db.stop.findFirst({ where: { id: stopId, route: { branchId } } });
  if (!s) throw new AppError("Stop not found.");
  const n = await db.transportAllocation.count({ where: { stopId } });
  if (n) throw new AppError(`This stop has ${n} allocation record(s). Move the students to another stop first; stops with history cannot be deleted.`);
  return db.$transaction(async (tx) => {
    await tx.stop.delete({ where: { id: s.id } });
    const rest = await tx.stop.findMany({ where: { routeId: s.routeId }, orderBy: { sequence: "asc" } });
    for (const [i, x] of rest.entries()) if (x.sequence !== i + 1) await tx.stop.update({ where: { id: x.id }, data: { sequence: i + 1 } });
  }, TX);
}

// ───────────────────────── Fee slabs ─────────────────────────

export async function saveSlab(branchId: string, input: { id?: string; fromKm: number; toKm: number; amount: number }) {
  if (input.toKm < input.fromKm) throw new AppError("'To km' must be greater than or equal to 'From km'.", "VALIDATION", { toKm: "Must be ≥ from" });
  const others = await db.transportFeeSlab.findMany({ where: { branchId, ...(input.id ? { id: { not: input.id } } : {}) } });
  const clash = others.find((o) => input.fromKm <= toNum(o.toKm) && input.toKm >= toNum(o.fromKm));
  if (clash) throw new AppError(`Overlaps the ${toNum(clash.fromKm)}–${toNum(clash.toKm)} km slab.`);
  const data = { fromKm: input.fromKm, toKm: input.toKm, amount: input.amount };
  if (!input.id) return db.transportFeeSlab.create({ data: { ...data, branchId } });
  const s = await db.transportFeeSlab.findFirst({ where: { id: input.id, branchId } });
  if (!s) throw new AppError("Slab not found.");
  return db.transportFeeSlab.update({ where: { id: s.id }, data });
}

export async function deleteSlab(branchId: string, id: string) {
  const s = await db.transportFeeSlab.findFirst({ where: { id, branchId } });
  if (!s) throw new AppError("Slab not found.");
  return db.transportFeeSlab.delete({ where: { id } });
}

// ───────────────────────── Allocations ─────────────────────────

export type AllocationInput = { studentId: string; routeId: string; stopId: string; busId?: string; startDate?: Date; override?: boolean };

async function resolveTarget(tx: DbOrTx, branchId: string, input: { routeId: string; stopId: string; busId?: string }) {
  const route = await tx.route.findFirst({ where: { id: input.routeId, branchId }, include: { stops: { where: { id: input.stopId } } } });
  if (!route) throw new AppError("Route not found.");
  if (!route.isActive) throw new AppError(`${route.name} is inactive.`);
  if (!route.stops.length) throw new AppError("Choose a stop on the selected route.", "VALIDATION", { stopId: "Not on this route" });
  const busId = input.busId || route.busId;
  if (!busId) throw new AppError(`${route.name} has no bus assigned. Assign a bus to the route or choose one.`, "VALIDATION", { busId: "Required" });
  const bus = await busInBranch(tx, branchId, busId);
  if (!bus.isActive) throw new AppError(`${bus.busNo} is inactive.`);
  return { route, stop: route.stops[0], bus };
}

/** Capacity per policy. WARN without override throws a CAPACITY_WARN error the UI turns into an "allocate anyway" prompt. */
async function enforceCapacity(tx: Tx, branchId: string, busId: string, override: boolean) {
  const policies = await getSetting("policies", branchId);
  const bus = await tx.bus.findUniqueOrThrow({ where: { id: busId } });
  const taken = await seatsTaken(tx, busId);
  if (taken >= bus.capacity && policies.capacityPolicy === "WARN" && !override) {
    throw new AppError(`${bus.busNo} is full (${taken}/${bus.capacity} seats). Tick "Allocate anyway" to go over capacity.`, "CAPACITY_WARN", { override: "Bus is full" });
  }
  // In BLOCK mode an override is never honoured.
  const warning = await checkCapacity(tx, busId, policies.capacityPolicy === "WARN" && override);
  return warning;
}

function yearDate(year: { startDate: Date; endDate: Date }, d: Date | undefined) {
  const t = today();
  let x = d ? dateOnly(d) : t;
  if (!d && x < year.startDate) x = year.startDate;
  if (x < year.startDate || x > year.endDate) throw new AppError("The date must fall within the current academic year.", "VALIDATION", { startDate: "Outside academic year" });
  return x;
}

export async function allocateStudent(branchId: string, userId: string | undefined, input: AllocationInput) {
  const year = await currentAcademicYear();
  if (!year) throw new AppError("Set up the current academic year first.");
  const startDate = yearDate(year, input.startDate);
  return db.$transaction(async (tx) => {
    const target = await resolveTarget(tx, branchId, input);
    await lockBuses(tx, [target.bus.id]);
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${input.studentId} FOR UPDATE`;
    const student = await tx.student.findFirst({ where: { id: input.studentId, branchId } });
    if (!student) throw new AppError("Student not found.");
    if (student.status !== "ACTIVE") throw new AppError("Only active students can be allocated a bus seat.");
    const current = await tx.transportAllocation.findFirst({ where: { studentId: student.id, status: "ACTIVE" }, include: { bus: true } });
    if (current) throw new AppError(`This student already has a seat on ${current.bus.busNo}. Use "Change" to move them.`);
    const warning = await enforceCapacity(tx, branchId, target.bus.id, !!input.override);
    const allocation = await tx.transportAllocation.create({
      data: { studentId: student.id, academicYearId: year.id, busId: target.bus.id, routeId: target.route.id, stopId: target.stop.id, startDate, capacityOverride: !!warning, createdById: userId },
    });
    const feeLines = await createTransportFees(tx, allocation.id);
    return { allocation, warning, feeLines };
  }, TX);
}

/**
 * Move a student to another stop/route/bus from `changeDate`: the old allocation ends the day before and a new one starts.
 * Terms billed on both: if the old line is untouched (unpaid) it is cancelled so the new stop's fee applies; otherwise the new line is cancelled.
 */
export async function changeAllocation(branchId: string, userId: string | undefined, input: { allocationId: string; routeId: string; stopId: string; busId?: string; changeDate?: Date; override?: boolean }) {
  const year = await currentAcademicYear();
  if (!year) throw new AppError("Set up the current academic year first.");
  const changeDate = yearDate(year, input.changeDate);
  return db.$transaction(async (tx) => {
    const old = await tx.transportAllocation.findFirst({ where: { id: input.allocationId, status: "ACTIVE", student: { branchId } } });
    if (!old) throw new AppError("This allocation has already ended.");
    const target = await resolveTarget(tx, branchId, input);
    if (target.stop.id === old.stopId && target.bus.id === old.busId) throw new AppError("The student is already on this bus and stop.");
    if (changeDate < old.startDate) throw new AppError("The change date cannot be before the current allocation started.", "VALIDATION", { changeDate: "Too early" });
    await lockBuses(tx, [old.busId, target.bus.id]);
    const endDate = changeDate > old.startDate ? addDays(changeDate, -1) : old.startDate;
    await endAllocation(tx, old.id, endDate);
    const warning = await enforceCapacity(tx, branchId, target.bus.id, !!input.override);
    const allocation = await tx.transportAllocation.create({
      data: { studentId: old.studentId, academicYearId: year.id, busId: target.bus.id, routeId: target.route.id, stopId: target.stop.id, startDate: changeDate, capacityOverride: !!warning, createdById: userId },
    });
    let feeLines = await createTransportFees(tx, allocation.id);
    feeLines -= await resolveOverlap(tx, old.id, allocation.id);
    return { allocation, warning, feeLines };
  }, TX);
}

async function cancelFee(tx: Tx, id: string) {
  await tx.studentFee.update({ where: { id }, data: { status: "CANCELLED" } });
  await recalcFee(tx, id);
}

/** Returns the number of new lines cancelled. */
async function resolveOverlap(tx: Tx, oldId: string, newId: string) {
  const [oldFees, newFees] = await Promise.all([
    tx.studentFee.findMany({ where: { allocationId: oldId, status: { not: "CANCELLED" } } }),
    tx.studentFee.findMany({ where: { allocationId: newId, status: { not: "CANCELLED" } } }),
  ]);
  let cancelledNew = 0;
  for (const nf of newFees) {
    const of = oldFees.find((o) => (o.termId ?? "ANNUAL") === (nf.termId ?? "ANNUAL"));
    if (!of) continue;
    const untouched = of.status === "PENDING" && toNum(of.paidAmount) === 0;
    if (untouched) await cancelFee(tx, of.id);
    else { await cancelFee(tx, nf.id); cancelledNew++; }
  }
  return cancelledNew;
}

export async function endStudentAllocation(branchId: string, allocationId: string, endDate?: Date) {
  return db.$transaction(async (tx) => {
    const a = await tx.transportAllocation.findFirst({ where: { id: allocationId, status: "ACTIVE", student: { branchId } } });
    if (!a) throw new AppError("This allocation has already ended.");
    const d = endDate ? dateOnly(endDate) : today();
    if (d < a.startDate) throw new AppError("The end date cannot be before the allocation started.", "VALIDATION", { endDate: "Too early" });
    await lockBuses(tx, [a.busId]);
    return endAllocation(tx, a.id, d);
  }, TX);
}

// ───────────────────────── Documents ─────────────────────────

export type DocInput = { busId?: string; staffId?: string; type: DocType; number?: string; issueDate?: Date; expiryDate: Date; fileUrl?: string };

async function checkDocOwner(branchId: string, input: { busId?: string; staffId?: string; type: DocType }) {
  if (input.type === "DRIVER_LICENCE") {
    if (!input.staffId) throw new AppError("Choose the driver for a driver licence.", "VALIDATION", { staffId: "Required" });
    const s = await db.transportStaff.findFirst({ where: { id: input.staffId, branchId } });
    if (!s) throw new AppError("Staff member not found.");
    return { busId: null, staffId: s.id };
  }
  if (input.busId) { await busInBranch(db, branchId, input.busId); return { busId: input.busId, staffId: null }; }
  if (input.staffId && input.type === "OTHER") {
    const s = await db.transportStaff.findFirst({ where: { id: input.staffId, branchId } });
    if (!s) throw new AppError("Staff member not found.");
    return { busId: null, staffId: s.id };
  }
  throw new AppError("Choose the bus this document belongs to.", "VALIDATION", { busId: "Required" });
}

export async function addDocument(branchId: string, input: DocInput) {
  const owner = await checkDocOwner(branchId, input);
  if (input.issueDate && input.issueDate > input.expiryDate) throw new AppError("Expiry date must be after the issue date.", "VALIDATION", { expiryDate: "Before issue date" });
  if (input.type !== "OTHER") {
    const cur = await db.transportDocument.findFirst({ where: { ...owner, type: input.type, isCurrent: true } });
    if (cur) throw new AppError("A current document of this type already exists. Use Renew on it instead.");
  }
  return db.transportDocument.create({ data: { ...owner, type: input.type, number: input.number ?? null, issueDate: input.issueDate ? dateOnly(input.issueDate) : null, expiryDate: dateOnly(input.expiryDate), fileUrl: input.fileUrl ?? null } });
}

/** Renewal: a new current document replaces the old one (kept as history, no longer alerted). */
export async function renewDocument(branchId: string, docId: string, input: { number?: string; issueDate?: Date; expiryDate: Date; fileUrl?: string }) {
  return db.$transaction(async (tx) => {
    const old = await tx.transportDocument.findFirst({ where: { id: docId, isCurrent: true, OR: [{ bus: { branchId } }, { staff: { branchId } }] } });
    if (!old) throw new AppError("Document not found or already renewed.");
    const expiry = dateOnly(input.expiryDate);
    if (expiry <= old.expiryDate) throw new AppError("The new expiry date must be later than the current one.", "VALIDATION", { expiryDate: "Must be later" });
    if (input.issueDate && input.issueDate > expiry) throw new AppError("Expiry date must be after the issue date.");
    await tx.transportDocument.update({ where: { id: old.id }, data: { isCurrent: false } });
    return tx.transportDocument.create({ data: { busId: old.busId, staffId: old.staffId, type: old.type, number: input.number ?? old.number, issueDate: input.issueDate ? dateOnly(input.issueDate) : null, expiryDate: expiry, fileUrl: input.fileUrl ?? null } });
  }, TX);
}

// ───────────────────────── Maintenance & fuel ─────────────────────────

export const MAINTENANCE_TYPES = ["SERVICE", "REPAIR", "TYRES", "OTHER"] as const;

export async function addMaintenance(branchId: string, userId: string | undefined, input: { busId: string; date: Date; type: (typeof MAINTENANCE_TYPES)[number]; description: string; odometerKm?: number; cost: number; vendor?: string }) {
  const date = dateOnly(input.date);
  if (date > today()) throw new AppError("The date cannot be in the future.", "VALIDATION", { date: "In the future" });
  return db.$transaction(async (tx) => {
    const bus = await busInBranch(tx, branchId, input.busId);
    const rec = await tx.maintenanceRecord.create({ data: { busId: bus.id, date, type: input.type, description: input.description, odometerKm: input.odometerKm ?? null, cost: input.cost, vendor: input.vendor ?? null, createdById: userId } });
    const odo = Math.max(bus.odometerKm, input.odometerKm ?? 0);
    if (input.type === "SERVICE") {
      const newer = !bus.lastServiceDate || date >= bus.lastServiceDate;
      await tx.bus.update({ where: { id: bus.id }, data: { odometerKm: odo, ...(newer ? { lastServiceDate: date, lastServiceKm: input.odometerKm ?? bus.odometerKm } : {}) } });
      if (newer) await tx.maintenanceReminder.updateMany({ where: { busId: bus.id, status: "OPEN" }, data: { status: "DONE", doneAt: new Date() } });
    } else if (odo !== bus.odometerKm) {
      await tx.bus.update({ where: { id: bus.id }, data: { odometerKm: odo } });
    }
    return rec;
  }, TX);
}

export async function addFuel(branchId: string, userId: string | undefined, input: { busId: string; date: Date; litres: number; cost: number; odometerKm?: number }) {
  const date = dateOnly(input.date);
  if (date > today()) throw new AppError("The date cannot be in the future.", "VALIDATION", { date: "In the future" });
  if (input.litres <= 0) throw new AppError("Enter the litres filled.", "VALIDATION", { litres: "Must be more than 0" });
  return db.$transaction(async (tx) => {
    const bus = await busInBranch(tx, branchId, input.busId);
    const rec = await tx.fuelLog.create({ data: { busId: bus.id, date, litres: input.litres, cost: input.cost, odometerKm: input.odometerKm ?? null, createdById: userId } });
    if (input.odometerKm && input.odometerKm > bus.odometerKm) await tx.bus.update({ where: { id: bus.id }, data: { odometerKm: input.odometerKm } });
    return rec;
  }, TX);
}

export async function completeReminder(branchId: string, id: string) {
  const r = await db.maintenanceReminder.findFirst({ where: { id, status: "OPEN", bus: { branchId } } });
  if (!r) throw new AppError("Reminder not found or already done.");
  return db.maintenanceReminder.update({ where: { id }, data: { status: "DONE", doneAt: new Date() } });
}
