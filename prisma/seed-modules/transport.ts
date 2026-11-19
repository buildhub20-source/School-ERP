import type { SeedCtx } from "../seed";
import { db } from "../../src/lib/db";
import { addDays, today } from "../../src/lib/format";
import { allocateStudent, enableStaffLogin } from "../../src/server/transport/service";

/** Demo data for the transport module (idempotent: each block only runs when its data is missing). */

type StopSeed = [name: string, lat: number, lng: number, km: number];
const FEE_FOR_KM = (km: number) => (km <= 5 ? 3000 : km <= 10 ? 4000 : km <= 15 ? 5000 : 6500);

const BUSES = [
  { busNo: "Bus 1", registrationNo: "TN 02 AB 4521", capacity: 40, make: "Tata", model: "Starbus 40", year: 2021, odometerKm: 48200, lastServiceDaysAgo: 40, lastServiceKm: 46100, seats: 16 },
  { busNo: "Bus 2", registrationNo: "TN 02 CD 7788", capacity: 32, make: "Ashok Leyland", model: "Sunshine", year: 2020, odometerKm: 61850, lastServiceDaysAgo: 75, lastServiceKm: 57400, seats: 13 },
  { busNo: "Bus 3", registrationNo: "TN 05 EF 1203", capacity: 20, make: "Force", model: "Traveller 20", year: 2022, odometerKm: 30550, lastServiceDaysAgo: 60, lastServiceKm: 26900, seats: 19 },
  { busNo: "Bus 4", registrationNo: "TN 09 GH 3344", capacity: 24, make: "Eicher", model: "Skyline 24", year: 2019, odometerKm: 88400, lastServiceDaysAgo: 176, lastServiceKm: 80100, seats: 10 },
  { busNo: "Bus 5", registrationNo: "TN 11 JK 9087", capacity: 50, make: "Tata", model: "Starbus 50", year: 2023, odometerKm: 21900, lastServiceDaysAgo: 25, lastServiceKm: 20500, seats: 12 },
];

const ROUTES: { code: string; name: string; bus: string; start: string; stops: StopSeed[] }[] = [
  { code: "R1", name: "Anna Nagar – Kilpauk", bus: "Bus 1", start: "07:00", stops: [
    ["Kilpauk Garden Road", 13.0827, 80.2420, 4.8], ["Aminjikarai Market", 13.0732, 80.2236, 3.6], ["Shanthi Colony", 13.0839, 80.2167, 2.4],
    ["Arumbakkam", 13.0716, 80.2076, 2.9], ["Thirumangalam", 13.0850, 80.2010, 1.6], ["Anna Nagar Tower Park", 13.0878, 80.2085, 0.8],
  ] },
  { code: "R2", name: "T Nagar – Vadapalani", bus: "Bus 2", start: "06:55", stops: [
    ["Pondy Bazaar", 13.0418, 80.2407, 9.6], ["Panagal Park", 13.0405, 80.2336, 9.0], ["Ashok Nagar 11th Ave", 13.0373, 80.2123, 8.1],
    ["K K Nagar", 13.0410, 80.1990, 7.7], ["Vadapalani Signal", 13.0500, 80.2121, 6.2], ["Kodambakkam Bridge", 13.0512, 80.2250, 5.5],
  ] },
  { code: "R3", name: "Velachery – Adyar", bus: "Bus 3", start: "06:35", stops: [
    ["Velachery Bus Terminus", 12.9790, 80.2209, 15.2], ["Taramani", 12.9863, 80.2433, 15.8], ["Adyar Signal", 13.0063, 80.2574, 13.9], ["Kotturpuram", 13.0186, 80.2405, 11.8],
    ["Saidapet", 13.0213, 80.2231, 10.4], ["Guindy", 13.0067, 80.2206, 11.6], ["Ekkatuthangal", 13.0200, 80.2056, 9.9],
  ] },
  { code: "R4", name: "Tambaram – Alandur", bus: "Bus 4", start: "06:20", stops: [
    ["Tambaram", 12.9249, 80.1000, 24.5], ["Chromepet", 12.9516, 80.1462, 20.3], ["Pallavaram", 12.9675, 80.1491, 18.2], ["Meenambakkam", 12.9886, 80.1765, 15.1], ["Alandur", 13.0035, 80.2011, 12.6],
  ] },
  { code: "R5", name: "Porur – Mogappair", bus: "Bus 5", start: "06:50", stops: [
    ["Porur Junction", 13.0358, 80.1567, 10.8], ["Valasaravakkam", 13.0405, 80.1723, 8.9], ["Virugambakkam", 13.0530, 80.1890, 6.6],
    ["Maduravoyal", 13.0634, 80.1709, 6.1], ["Koyambedu", 13.0694, 80.1948, 3.4], ["Mogappair East", 13.0837, 80.1747, 3.9],
  ] },
];

const STAFF = [
  { type: "DRIVER" as const, name: "Murugesan K", phone: "9000000101", licenseNo: "TN0220110004521", bus: "Bus 1", login: true },
  { type: "DRIVER" as const, name: "Rajendran S", phone: "9000000102", licenseNo: "TN0520090012233", bus: "Bus 2", login: true },
  { type: "DRIVER" as const, name: "Anbu Selvan", phone: "9444010103", licenseNo: "TN0920150007781", bus: "Bus 3" },
  { type: "DRIVER" as const, name: "Kathiravan P", phone: "9444010104", licenseNo: "TN1120120003390", bus: "Bus 4" },
  { type: "DRIVER" as const, name: "Sekar M", phone: "9444010105", licenseNo: "TN0220180009912", bus: "Bus 5" },
  { type: "ATTENDANT" as const, name: "Valli R", phone: "9444020201", bus: "Bus 1" },
  { type: "ATTENDANT" as const, name: "Shanthi M", phone: "9444020202", bus: "Bus 2" },
  { type: "ATTENDANT" as const, name: "Kamala D", phone: "9444020203", bus: "Bus 3" },
  { type: "ATTENDANT" as const, name: "Parvathi S", phone: "9444020204", bus: "Bus 5" },
];

const addMin = (hhmm: string, m: number) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + m;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export async function seed_transport(ctx: SeedCtx) {
  const { branchId } = ctx;
  const t = today();

  // Buses
  const buses: Record<string, string> = {};
  for (const b of BUSES) {
    const bus = await db.bus.upsert({
      where: { registrationNo: b.registrationNo },
      create: { branchId, busNo: b.busNo, registrationNo: b.registrationNo, capacity: b.capacity, make: b.make, model: b.model, year: b.year, odometerKm: b.odometerKm, serviceIntervalKm: 10000, serviceIntervalDays: 180, lastServiceDate: addDays(t, -b.lastServiceDaysAgo), lastServiceKm: b.lastServiceKm },
      update: {},
    });
    buses[b.busNo] = bus.id;
  }

  // Staff + crew assignment + app logins
  for (const s of STAFF) {
    let st = await db.transportStaff.findFirst({ where: { branchId, phone: s.phone } });
    if (!st) st = await db.transportStaff.create({ data: { branchId, type: s.type, name: s.name, phone: s.phone, licenseNo: s.licenseNo ?? null, address: "Chennai" } });
    const bus = await db.bus.findUniqueOrThrow({ where: { id: buses[s.bus] } });
    if (s.type === "DRIVER" && !bus.driverId && !(await db.bus.findFirst({ where: { driverId: st.id } }))) await db.bus.update({ where: { id: bus.id }, data: { driverId: st.id } });
    if (s.type === "ATTENDANT" && !bus.attendantId && !(await db.bus.findFirst({ where: { attendantId: st.id } }))) await db.bus.update({ where: { id: bus.id }, data: { attendantId: st.id } });
    if (s.login && !st.userId && !(await db.user.findUnique({ where: { phone: s.phone } }))) await enableStaffLogin(branchId, st.id);
  }

  // Routes and stops
  const routeIds: Record<string, string> = {};
  for (const r of ROUTES) {
    const route = await db.route.upsert({ where: { branchId_code: { branchId, code: r.code } }, create: { branchId, code: r.code, name: r.name, busId: buses[r.bus], description: `Morning pickup from ${r.start}` }, update: {} });
    routeIds[r.code] = route.id;
    if ((await db.stop.count({ where: { routeId: route.id } })) === 0) {
      for (const [i, [name, lat, lng, km]] of r.stops.entries()) {
        await db.stop.create({ data: { routeId: route.id, name, sequence: i + 1, lat, lng, distanceKm: km, feeAmount: FEE_FOR_KM(km), pickupTime: addMin(r.start, i * 7), dropTime: addMin("15:45", (r.stops.length - 1 - i) * 7 + 10) } });
      }
    }
  }

  // Distance slabs (used when the fee mode is DISTANCE)
  if ((await db.transportFeeSlab.count({ where: { branchId } })) === 0) {
    await db.transportFeeSlab.createMany({ data: [
      { branchId, fromKm: 0, toKm: 5, amount: 3000 }, { branchId, fromKm: 5.01, toKm: 10, amount: 4000 },
      { branchId, fromKm: 10.01, toKm: 15, amount: 5000 }, { branchId, fromKm: 15.01, toKm: 40, amount: 6500 },
    ] });
  }

  // ~70 allocations through the service (fees are added automatically)
  if ((await db.transportAllocation.count({ where: { academicYearId: ctx.yearId } })) === 0) {
    const year = await db.academicYear.findUniqueOrThrow({ where: { id: ctx.yearId } });
    const demoParent = await db.guardian.findUnique({ where: { phone: "9840000002" }, include: { students: true } });
    const students = await db.student.findMany({ where: { branchId, status: "ACTIVE", schoolClass: { grade: { gte: 1 } } }, orderBy: { admissionNo: "asc" }, select: { id: true } });
    const firstIds = demoParent?.students.map((s) => s.studentId) ?? [];
    const pool = [...firstIds, ...students.map((s) => s.id).filter((id) => !firstIds.includes(id))];
    let k = 0, made = 0;
    for (const r of ROUTES) {
      const want = BUSES.find((b) => b.busNo === r.bus)!.seats;
      const stops = await db.stop.findMany({ where: { routeId: routeIds[r.code] }, orderBy: { sequence: "asc" } });
      for (let i = 0; i < want && k < pool.length; i++, k++) {
        await allocateStudent(branchId, ctx.adminId, { studentId: pool[k], routeId: routeIds[r.code], stopId: stops[(i * 3) % stops.length].id, startDate: year.startDate });
        made++;
      }
    }
    console.log(`  ${made} transport allocations`);
  }

  // Documents: mostly valid, one expiring within 30 days, one expired
  for (const [i, b] of BUSES.entries()) {
    const busId = buses[b.busNo];
    if (await db.transportDocument.count({ where: { busId } })) continue;
    const docs = [
      { type: "INSURANCE" as const, number: `UIIC/MV/${2026}/${48100 + i}`, expiry: b.busNo === "Bus 2" ? 18 : 220 + i * 20 },
      { type: "FITNESS" as const, number: `FC-${b.registrationNo.replace(/\s/g, "")}`, expiry: 300 + i * 15 },
      { type: "PERMIT" as const, number: `CNI/EIB/${3300 + i}/2024`, expiry: 520 + i * 10 },
      { type: "POLLUTION" as const, number: `PUC${780040 + i}`, expiry: b.busNo === "Bus 4" ? -5 : 95 + i * 12 },
    ];
    for (const d of docs) {
      const expiryDate = addDays(t, d.expiry);
      await db.transportDocument.create({ data: { busId, type: d.type, number: d.number, issueDate: addDays(expiryDate, d.type === "POLLUTION" ? -180 : -365), expiryDate } });
    }
  }
  for (const [i, s] of STAFF.filter((x) => x.type === "DRIVER").entries()) {
    const st = await db.transportStaff.findFirst({ where: { branchId, phone: s.phone } });
    if (!st || (await db.transportDocument.count({ where: { staffId: st.id } }))) continue;
    await db.transportDocument.create({ data: { staffId: st.id, type: "DRIVER_LICENCE", number: s.licenseNo, issueDate: addDays(t, -1500), expiryDate: addDays(t, 400 + i * 180) } });
  }

  // Maintenance + fuel
  for (const [i, b] of BUSES.entries()) {
    const busId = buses[b.busNo];
    if (await db.maintenanceRecord.count({ where: { busId } })) continue;
    const lastSvc = addDays(t, -b.lastServiceDaysAgo);
    await db.maintenanceRecord.createMany({ data: [
      { busId, date: addDays(lastSvc, -180), type: "SERVICE", description: "Periodic service — engine oil, filters, brake check", odometerKm: b.lastServiceKm - 9800, cost: 14500 + i * 900, vendor: "Sri Murugan Motors, Ambattur", createdById: ctx.adminId },
      { busId, date: lastSvc, type: "SERVICE", description: "Periodic service — oil change, air filter, wheel alignment", odometerKm: b.lastServiceKm, cost: 15800 + i * 750, vendor: "Sri Murugan Motors, Ambattur", createdById: ctx.adminId },
      { busId, date: addDays(t, -12 - i * 9), type: i % 2 ? "TYRES" : "REPAIR", description: i % 2 ? "Two rear tyres replaced" : "Door pneumatic cylinder repaired", cost: i % 2 ? 26000 : 4200 + i * 300, vendor: i % 2 ? "MRF Tyre Point, Koyambedu" : "Lakshmi Auto Works", createdById: ctx.adminId },
    ] });
    for (let w = 0; w < 6; w++) {
      const litres = 55 + ((i * 7 + w * 5) % 20);
      await db.fuelLog.create({ data: { busId, date: addDays(t, -3 - w * 6), litres, cost: Math.round(litres * 92.4), odometerKm: b.odometerKm - w * 380, createdById: ctx.adminId } });
    }
  }

  // A completed pickup trip yesterday on Bus 1, with GPS trail and boarding records
  const bus1 = await db.bus.findUniqueOrThrow({ where: { id: buses["Bus 1"] }, include: { driver: true } });
  if ((await db.busTrip.count({ where: { busId: bus1.id } })) === 0) {
    const yest = addDays(t, -1); // UTC midnight = 05:30 IST
    const startAt = new Date(yest.getTime() + 90 * 60000); // 07:00 IST
    const trip = await db.busTrip.create({ data: { busId: bus1.id, type: "PICKUP", startedAt: startAt, endedAt: new Date(startAt.getTime() + 55 * 60000), startedById: bus1.driver?.userId ?? null } });
    const stops = await db.stop.findMany({ where: { routeId: routeIds.R1 }, orderBy: { sequence: "asc" } });
    const allocs = await db.transportAllocation.findMany({ where: { busId: bus1.id, status: "ACTIVE" }, include: { stop: true } });
    for (const [i, s] of stops.entries()) {
      const at = new Date(startAt.getTime() + i * 7 * 60000);
      await db.busLocation.create({ data: { busId: bus1.id, lat: s.lat!, lng: s.lng!, speed: 22, recordedAt: at } });
      await db.tripStopEvent.create({ data: { tripId: trip.id, stopId: s.id, notifiedAt: new Date(at.getTime() - 2 * 60000) } });
      for (const a of allocs.filter((x) => x.stopId === s.id)) {
        await db.boardingRecord.create({ data: { tripId: trip.id, studentId: a.studentId, event: "BOARDED", method: i % 2 ? "SCAN" : "APP", markedById: bus1.driver?.userId ?? null, at: new Date(at.getTime() + 60000) } });
      }
    }
    const arrive = new Date(startAt.getTime() + 50 * 60000);
    for (const a of allocs) await db.boardingRecord.create({ data: { tripId: trip.id, studentId: a.studentId, event: "ALIGHTED", method: "APP", markedById: bus1.driver?.userId ?? null, at: arrive } });
    await db.busLocation.create({ data: { busId: bus1.id, lat: 13.0850, lng: 80.2101, speed: 0, recordedAt: arrive } });
    await db.bus.update({ where: { id: bus1.id }, data: { lastLat: 13.0850, lastLng: 80.2101, lastLocationAt: arrive } });
  }
}
