import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { addDays, today } from "@/lib/format";
import { allocateStudent, addMaintenance, endStudentAllocation } from "@/server/transport/service";
import { checkNearStops, recordLocation, startTrip } from "@/server/transport/trips";
import { copyAllocationsToYear } from "@/server/transport/core";
import { transportDocExpiry, transportServiceDue } from "@/server/transport/automations";
import { asUser, testCtx, uniq } from "./helpers";

/** All data lives in a throw-away branch so its policies (BLOCK/WARN) never affect the real school. */
let ctx: Awaited<ReturnType<typeof testCtx>>;
let branchId = "";
let classId = "";
const tag = uniq("TR");
const phone = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const userIds: string[] = [];

async function mkBus(extra: Partial<{ capacity: number; odometerKm: number; lastServiceKm: number; lastServiceDate: Date; serviceIntervalKm: number; serviceIntervalDays: number }> = {}) {
  return db.bus.create({ data: { branchId, busNo: uniq("BUS"), registrationNo: uniq("TN"), capacity: 1, serviceIntervalKm: 10000, serviceIntervalDays: 180, lastServiceDate: today(), lastServiceKm: 0, ...extra } });
}
async function mkStudent() {
  return db.student.create({ data: { branchId, admissionNo: uniq("ADM"), firstName: "Test", lastName: tag, gender: "MALE", classId } });
}

let bus: { id: string }, route: { id: string }, stop: { id: string };
let s1: { id: string }, s2: { id: string };
let guardianUserId = "";
let driverUserId = "";

beforeAll(async () => {
  ctx = await testCtx();
  const branch = await db.branch.create({ data: { code: tag, name: `Test ${tag}` } });
  branchId = branch.id;
  classId = (await db.schoolClass.findFirstOrThrow({ where: { branchId: ctx.branchId } })).id;
  await saveSetting("policies", { capacityPolicy: "BLOCK", transportFeeMode: "STOP", transportFeeBasis: "TERM" }, branchId);
  bus = await mkBus();
  route = await db.route.create({ data: { branchId, code: "T1", name: "Test route", busId: bus.id } });
  stop = await db.stop.create({ data: { routeId: route.id, name: `Stop ${tag}`, sequence: 1, lat: 13.0827, lng: 80.242, distanceKm: 4, feeAmount: 1000 } });
  s1 = await mkStudent();
  s2 = await mkStudent();
  // parent login for s2 (near-stop notification target)
  const parentRole = await db.role.findUniqueOrThrow({ where: { key: "PARENT" } });
  const gu = await db.user.create({ data: { branchId, roleId: parentRole.id, name: "Parent " + tag, phone: phone(), preferredChannel: "IN_APP" } });
  guardianUserId = gu.id; userIds.push(gu.id);
  const g = await db.guardian.create({ data: { name: "Parent " + tag, phone: gu.phone!, userId: gu.id } });
  await db.studentGuardian.create({ data: { studentId: s2.id, guardianId: g.id, relation: "Father", isPrimary: true } });
  // driver with app login on the bus
  const driverRole = await db.role.findUniqueOrThrow({ where: { key: "DRIVER" } });
  const du = await db.user.create({ data: { branchId, roleId: driverRole.id, name: "Driver " + tag, phone: phone() } });
  driverUserId = du.id; userIds.push(du.id);
  const ds = await db.transportStaff.create({ data: { branchId, type: "DRIVER", name: "Driver " + tag, phone: du.phone!, licenseNo: "L1", userId: du.id } });
  await db.bus.update({ where: { id: bus.id }, data: { driverId: ds.id } });
});

afterAll(async () => {
  if (!branchId) return;
  const students = await db.student.findMany({ where: { branchId }, select: { id: true } });
  const sid = students.map((s) => s.id);
  await db.studentFee.deleteMany({ where: { studentId: { in: sid } } });
  await db.busTrip.deleteMany({ where: { bus: { branchId } } });
  await db.transportAllocation.deleteMany({ where: { studentId: { in: sid } } });
  await db.studentGuardian.deleteMany({ where: { studentId: { in: sid } } });
  await db.student.deleteMany({ where: { id: { in: sid } } });
  await db.guardian.deleteMany({ where: { userId: { in: userIds } } });
  await db.transportStaff.updateMany({ where: { branchId }, data: { userId: null } });
  await db.bus.updateMany({ where: { branchId }, data: { driverId: null, attendantId: null } });
  await db.transportStaff.deleteMany({ where: { branchId } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.route.deleteMany({ where: { branchId } });
  await db.bus.deleteMany({ where: { branchId } });
  await db.feeHead.deleteMany({ where: { branchId } });
  await db.setting.deleteMany({ where: { branchId } });
  await db.branch.delete({ where: { id: branchId } });
});

describe("capacity policy", () => {
  it("BLOCK refuses a seat on a full bus, even with override", async () => {
    await asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: s1.id, routeId: route.id, stopId: stop.id }));
    await expect(asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: s2.id, routeId: route.id, stopId: stop.id }))).rejects.toThrow(/full/);
    await expect(asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: s2.id, routeId: route.id, stopId: stop.id, override: true }))).rejects.toThrow(/full/);
    expect(await db.transportAllocation.count({ where: { busId: bus.id, status: "ACTIVE" } })).toBe(1);
  });

  it("WARN asks for confirmation, then allows an override", async () => {
    await saveSetting("policies", { capacityPolicy: "WARN" }, branchId);
    await expect(asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: s2.id, routeId: route.id, stopId: stop.id }))).rejects.toMatchObject({ code: "CAPACITY_WARN" });
    const r = await asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: s2.id, routeId: route.id, stopId: stop.id, override: true }));
    expect(r.warning).toMatch(/over capacity/);
    expect(r.allocation.capacityOverride).toBe(true);
    await saveSetting("policies", { capacityPolicy: "BLOCK" }, branchId);
  });

  it("two simultaneous requests cannot take the last seat", async () => {
    const b = await mkBus();
    const r = await db.route.create({ data: { branchId, code: "T2", name: "Race route", busId: b.id } });
    const st = await db.stop.create({ data: { routeId: r.id, name: "Race stop", sequence: 1, distanceKm: 1, feeAmount: 0 } });
    const [a, c] = [await mkStudent(), await mkStudent()];
    const res = await Promise.allSettled([a, c].map((x) => asUser(ctx.adminId, () => allocateStudent(branchId, ctx.adminId, { studentId: x.id, routeId: r.id, stopId: st.id }))));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.transportAllocation.count({ where: { busId: b.id, status: "ACTIVE" } })).toBe(1);
  });
});

describe("near-stop alert", () => {
  it("notifies guardians once per trip when the bus comes within range", async () => {
    const trip = await asUser(driverUserId, () => startTrip(driverUserId, "PICKUP"));
    expect(await checkNearStops(trip.id, 13.2, 80.4)).toEqual([]);
    const r1 = await asUser(driverUserId, () => recordLocation(driverUserId, { lat: 13.0829, lng: 80.2425 }));
    expect(r1.nearStops).toBe(1);
    const r2 = await asUser(driverUserId, () => recordLocation(driverUserId, { lat: 13.0827, lng: 80.2421 }));
    expect(r2.nearStops).toBe(0);
    expect(await db.notification.count({ where: { userId: guardianUserId, title: { contains: "is near" } } })).toBe(1);
    expect(await db.tripStopEvent.count({ where: { tripId: trip.id } })).toBe(1);
    await db.busTrip.update({ where: { id: trip.id }, data: { endedAt: new Date() } });
  });
});

describe("transport fees", () => {
  it("are created on assign and future unpaid terms are cancelled on end", async () => {
    const a = await db.transportAllocation.findFirstOrThrow({ where: { studentId: s1.id, status: "ACTIVE" } });
    const year = await db.academicYear.findUniqueOrThrow({ where: { id: a.academicYearId }, include: { terms: true } });
    const lines = await db.studentFee.findMany({ where: { allocationId: a.id }, include: { term: true } });
    const expected = year.terms.filter((t) => t.endDate >= a.startDate).length;
    expect(lines).toHaveLength(expected);
    expect(lines.every((l) => Number(l.amount) === 1000 && l.source === "TRANSPORT")).toBe(true);
    const end = today();
    await asUser(ctx.adminId, () => endStudentAllocation(branchId, a.id, end));
    const after = await db.studentFee.findMany({ where: { allocationId: a.id }, include: { term: true } });
    for (const l of after) expect(l.status === "CANCELLED").toBe(!!l.term && l.term.startDate > end);
    expect((await db.transportAllocation.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ENDED");
  });

  it("copyAllocationsToYear is idempotent", async () => {
    const yearName = uniq("Y").slice(0, 12);
    const cur = await db.academicYear.findUniqueOrThrow({ where: { id: ctx.year.id } });
    const next = await db.academicYear.create({ data: { name: yearName, startDate: addDays(cur.endDate, 1), endDate: addDays(cur.endDate, 365), terms: { create: [{ name: "Term 1", sequence: 1, startDate: addDays(cur.endDate, 1), endDate: addDays(cur.endDate, 120) }] } } });
    try {
      const before = await db.transportAllocation.count({ where: { studentId: s2.id, status: "ACTIVE" } });
      expect(before).toBe(1);
      // only touch our test student's allocation: copy from a private year
      const a = await db.transportAllocation.findFirstOrThrow({ where: { studentId: s2.id, status: "ACTIVE" } });
      const priv = await db.academicYear.create({ data: { name: uniq("P").slice(0, 12), startDate: cur.startDate, endDate: cur.endDate } });
      await db.transportAllocation.update({ where: { id: a.id }, data: { academicYearId: priv.id } });
      const r1 = await asUser(ctx.adminId, () => copyAllocationsToYear(priv.id, next.id));
      expect(r1.copied).toBe(1);
      const r2 = await asUser(ctx.adminId, () => copyAllocationsToYear(priv.id, next.id));
      expect(r2.copied).toBe(0);
      const nowActive = await db.transportAllocation.findMany({ where: { studentId: s2.id, status: "ACTIVE" } });
      expect(nowActive).toHaveLength(1);
      expect(nowActive[0].academicYearId).toBe(next.id);
      expect(await db.studentFee.count({ where: { allocationId: nowActive[0].id } })).toBe(1);
      await db.studentFee.deleteMany({ where: { studentId: s2.id } });
      await db.transportAllocation.deleteMany({ where: { studentId: s2.id } });
      await db.academicYear.delete({ where: { id: priv.id } });
    } finally {
      await db.studentFee.deleteMany({ where: { academicYearId: next.id } });
      await db.transportAllocation.deleteMany({ where: { academicYearId: next.id } });
      await db.academicYear.delete({ where: { id: next.id } });
    }
  });
});

describe("document expiry automation", () => {
  it("alerts, waits for the repeat interval, alerts again; renewed documents are ignored", async () => {
    const d = await db.transportDocument.create({ data: { busId: bus.id, type: "INSURANCE", number: tag, expiryDate: addDays(today(), 10) } });
    const old = await db.transportDocument.create({ data: { busId: bus.id, type: "PERMIT", number: tag, expiryDate: addDays(today(), 5), isCurrent: false } });
    await transportDocExpiry({ daysBefore: 30, repeatEveryDays: 7 });
    const first = (await db.transportDocument.findUniqueOrThrow({ where: { id: d.id } })).lastAlertAt;
    expect(first).not.toBeNull();
    expect((await db.transportDocument.findUniqueOrThrow({ where: { id: old.id } })).lastAlertAt).toBeNull();
    await transportDocExpiry({ daysBefore: 30, repeatEveryDays: 7 });
    expect((await db.transportDocument.findUniqueOrThrow({ where: { id: d.id } })).lastAlertAt?.getTime()).toBe(first!.getTime());
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000);
    await db.transportDocument.update({ where: { id: d.id }, data: { lastAlertAt: eightDaysAgo } });
    await transportDocExpiry({ daysBefore: 30, repeatEveryDays: 7 });
    expect((await db.transportDocument.findUniqueOrThrow({ where: { id: d.id } })).lastAlertAt!.getTime()).toBeGreaterThan(eightDaysAgo.getTime());
  });
});

describe("service due automation", () => {
  it("creates one reminder by km and one by date, never duplicated; a service closes it", async () => {
    const byKm = await mkBus({ odometerKm: 9800, lastServiceKm: 0, lastServiceDate: today() });
    const byDate = await mkBus({ odometerKm: 100, lastServiceKm: 0, lastServiceDate: addDays(today(), -178) });
    const ok = await mkBus({ odometerKm: 100, lastServiceKm: 0, lastServiceDate: today() });
    await transportServiceDue({ daysAhead: 7, kmAhead: 500 });
    await transportServiceDue({ daysAhead: 7, kmAhead: 500 });
    const rem = async (id: string) => db.maintenanceReminder.findMany({ where: { busId: id, status: "OPEN" } });
    expect((await rem(byKm.id)).map((r) => r.reason)).toEqual(["KM"]);
    expect((await rem(byDate.id)).map((r) => r.reason)).toEqual(["DATE"]);
    expect(await rem(ok.id)).toHaveLength(0);
    await asUser(ctx.adminId, () => addMaintenance(branchId, ctx.adminId, { busId: byKm.id, date: today(), type: "SERVICE", description: "Service", odometerKm: 9850, cost: 1000 }));
    expect(await rem(byKm.id)).toHaveLength(0);
    const b = await db.bus.findUniqueOrThrow({ where: { id: byKm.id } });
    expect(b.lastServiceKm).toBe(9850);
    expect(b.odometerKm).toBe(9850);
  });
});
