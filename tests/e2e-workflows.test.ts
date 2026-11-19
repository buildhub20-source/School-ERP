/**
 * End-to-end workflow tests: each test walks a complete business process through the real
 * services and database, the way the pages do, and checks every side effect.
 * Records created here are tagged "E2E" in notes/purpose.
 */
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { asUser, testCtx } from "./helpers";
import { createRequest, approveRequest, issueRequest } from "@/server/stationery/requests";
import { createOrder, recordOrderPayment, markReady, markDelivered } from "@/server/uniforms/service";
import { allocateStudent, endStudentAllocation } from "@/server/transport/service";
import { startTrip, endTrip, recordLocation, markBoarding } from "@/server/transport/trips";
import { stationeryDashboard } from "@/server/stationery/dashboard";
import { uniformsDashboard } from "@/server/uniforms/dashboard";
import { transportDashboard } from "@/server/transport/dashboard";
import { collectPayment } from "@/server/fees/service";
import { startOnlinePayment, confirmOnlinePayment } from "@/server/fees/payments";
import { feesDashboard } from "@/server/fees/dashboard";
import type { SessionUser } from "@/lib/auth/session";

async function sessionUser(email: string): Promise<SessionUser> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, roleKey: u.role.key, roleName: u.role.name, permissions: u.role.permissions, branchId: u.branchId, homeBranchId: u.branchId, language: u.language, mustChangePassword: false, twoFactorEnabled: false, sessionId: "test", idleMinutes: 30 };
}

const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });

describe("Stationery: teacher request → approve (partly) → issue → stock, budget, notification", () => {
  it("runs the whole flow", async () => {
    const { branchId } = await testCtx();
    const teacher = await user("anitha@school.test");
    const store = await user("store@school.test");
    const items = await db.stationeryItem.findMany({ where: { branchId, isActive: true, currentStock: { gte: 40 } }, take: 2, orderBy: { currentStock: "desc" } });
    expect(items.length).toBe(2);
    const cls = await db.schoolClass.findFirstOrThrow({ where: { branchId, name: "Class 5" } });
    const before = items.map((i) => i.currentStock);

    const req = await asUser(teacher.id, () => createRequest(branchId, teacher.id, { classId: cls.id, purpose: "E2E test", lines: [{ itemId: items[0].id, qty: 10 }, { itemId: items[1].id, qty: 6 }] }));
    expect(req.status).toBe("PENDING");

    // A teacher cannot approve their own request
    await expect(asUser(teacher.id, () => approveRequest(branchId, teacher.id, req.id, { lines: [] }))).rejects.toThrow();

    const lines = await db.stationeryRequestLine.findMany({ where: { requestId: req.id }, orderBy: { qtyRequested: "desc" } });
    await asUser(store.id, () => approveRequest(branchId, store.id, req.id, { lines: [{ lineId: lines[0].id, qty: 10 }, { lineId: lines[1].id, qty: 4 }] }));
    expect((await db.stationeryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PARTIALLY_APPROVED");

    await asUser(store.id, () => issueRequest(branchId, store.id, req.id));
    const after = await db.stationeryItem.findMany({ where: { id: { in: items.map((i) => i.id) } } });
    const byId = Object.fromEntries(after.map((i) => [i.id, i.currentStock]));
    expect(byId[items[0].id]).toBe(before[0] - 10);
    expect(byId[items[1].id]).toBe(before[1] - 4);

    const final = await db.stationeryRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(final.status).toBe("ISSUED");
    const moves = await db.stockMovement.findMany({ where: { requestId: req.id } });
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.type === "ISSUE" && m.classId === cls.id && m.createdById === store.id)).toBe(true);
    expect(await db.notification.count({ where: { userId: teacher.id, createdAt: { gte: req.createdAt } } })).toBeGreaterThan(0);
  });
});

describe("Uniforms: order → pay at counter (receipt) → ready (stock) → delivered (size profile)", () => {
  it("runs the whole flow", async () => {
    const { branchId } = await testCtx();
    const store = await user("store@school.test");
    const variant = await db.uniformVariant.findFirstOrThrow({ where: { isActive: true, stock: { gte: 3 }, item: { branchId, isActive: true } }, include: { item: true }, orderBy: { stock: "desc" } });
    const student = await db.student.findFirstOrThrow({ where: { branchId, status: "ACTIVE" }, orderBy: { admissionNo: "desc" } });

    const order = await asUser(store.id, () => createOrder(branchId, { studentId: student.id, lines: [{ variantId: variant.id, qty: 2 }], notes: "E2E test" }, store.id));
    const o1 = await db.uniformOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(o1.status).toBe("ORDERED");
    expect(toNum(o1.total)).toBeCloseTo(toNum(variant.price) * 2, 2);

    // Cannot be marked Ready before it is paid
    await expect(asUser(store.id, () => markReady(branchId, order.id, store.id))).rejects.toThrow();

    await asUser(store.id, () => recordOrderPayment(branchId, { orderId: order.id, amount: toNum(o1.total), mode: "CASH" }, store.id));
    const o2 = await db.uniformOrder.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
    expect(o2.status).toBe("PAID");
    expect(o2.payments[0].receiptNo).toBeTruthy();

    await asUser(store.id, () => markReady(branchId, order.id, store.id));
    expect((await db.uniformVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(variant.stock - 2);

    await asUser(store.id, () => markDelivered(branchId, order.id));
    expect((await db.uniformOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
    const profile = await db.uniformSizeProfile.findUnique({ where: { studentId_itemId: { studentId: student.id, itemId: variant.itemId } } });
    expect(profile?.size).toBe(variant.size);
  });
});

describe("Transport: allocate → fees added → driver trip with GPS, near-stop alert and boarding → end allocation", () => {
  it("runs the whole flow", async () => {
    const { branchId } = await testCtx();
    const tm = await user("transport@school.test");
    const staff = await db.transportStaff.findFirstOrThrow({ where: { branchId, type: "DRIVER", userId: { not: null }, drivesBus: { isNot: null } }, include: { drivesBus: { include: { routes: { include: { stops: { orderBy: { sequence: "asc" } } } } } } } });
    const bus = staff.drivesBus!;
    const route = bus.routes[0];
    const stop = route.stops.find((s) => s.lat && s.lng)!;
    const student = await db.student.findFirstOrThrow({ where: { branchId, status: "ACTIVE", allocations: { none: { status: "ACTIVE" } } } });
    await db.bus.update({ where: { id: bus.id }, data: { capacity: Math.max(bus.capacity, (await db.transportAllocation.count({ where: { busId: bus.id, status: "ACTIVE" } })) + 2) } });

    const alloc = await asUser(tm.id, () => allocateStudent(branchId, tm.id, { studentId: student.id, routeId: route.id, stopId: stop.id, busId: bus.id }));
    const allocationId = (alloc as { id?: string; allocation?: { id: string } }).id ?? (alloc as { allocation: { id: string } }).allocation.id;
    const fees = await db.studentFee.findMany({ where: { allocationId, status: { not: "CANCELLED" } } });
    expect(fees.length).toBeGreaterThan(0);
    expect(fees.every((f) => f.source === "TRANSPORT")).toBe(true);

    // Driver workflow
    const open = await db.busTrip.findFirst({ where: { busId: bus.id, endedAt: null } });
    if (open) await asUser(staff.userId!, () => endTrip(staff.userId!, open.id));
    const trip = await asUser(staff.userId!, () => startTrip(staff.userId!, "PICKUP"));
    const r = await asUser(staff.userId!, () => recordLocation(staff.userId!, { lat: stop.lat!, lng: stop.lng! }));
    expect(r.nearStops).toBeGreaterThan(0);
    const again = await asUser(staff.userId!, () => recordLocation(staff.userId!, { lat: stop.lat!, lng: stop.lng! }));
    expect(again.nearStops).toBe(0); // notified once per trip
    await asUser(staff.userId!, () => markBoarding(staff.userId!, { tripId: trip.id, studentId: student.id, event: "BOARDED", method: "SCAN" }));
    await expect(asUser(staff.userId!, () => markBoarding(staff.userId!, { tripId: trip.id, studentId: student.id, event: "BOARDED", method: "APP" }))).rejects.toThrow();
    expect(await db.boardingRecord.count({ where: { tripId: trip.id, studentId: student.id } })).toBe(1);
    await asUser(staff.userId!, () => endTrip(staff.userId!, trip.id));
    expect((await db.bus.findUniqueOrThrow({ where: { id: bus.id } })).lastLat).toBeCloseTo(stop.lat!, 5);

    // A driver cannot mark students of another bus
    const other = await db.transportAllocation.findFirst({ where: { status: "ACTIVE", busId: { not: bus.id } } });
    if (other) {
      const t2 = await asUser(staff.userId!, () => startTrip(staff.userId!, "DROP"));
      await expect(asUser(staff.userId!, () => markBoarding(staff.userId!, { tripId: t2.id, studentId: other.studentId, event: "BOARDED", method: "APP" }))).rejects.toThrow();
      await asUser(staff.userId!, () => endTrip(staff.userId!, t2.id));
    }

    await asUser(tm.id, () => endStudentAllocation(branchId, allocationId));
    expect((await db.transportAllocation.findUniqueOrThrow({ where: { id: allocationId } })).status).toBe("ENDED");
  });
});

describe("Fees: counter collection → receipt; parent online payment → receipt sent to parent", () => {
  it("collects at the counter", async () => {
    const { branchId } = await testCtx();
    const acc = await sessionUser("accounts@school.test");
    const line = await db.studentFee.findFirstOrThrow({ where: { status: "PENDING", balance: { gt: 500 }, student: { branchId, status: "ACTIVE" } }, orderBy: { dueDate: "asc" } });
    const res = await asUser(acc.id, () => collectPayment(acc, branchId, { studentId: line.studentId, mode: "UPI", amount: 500, reference: "E2E-UPI-" + Date.now(), allocations: [{ studentFeeId: line.id, amount: 500 }], notes: "E2E test" }));
    const paymentId = res.id;
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
    expect(p.status).toBe("SUCCESS");
    expect(p.receiptNo).toMatch(/\//);
    expect(p.allocations.reduce((a, x) => a + toNum(x.amount), 0)).toBe(500);
    const after = await db.studentFee.findUniqueOrThrow({ where: { id: line.id } });
    expect(toNum(after.balance)).toBeCloseTo(toNum(line.balance) - 500, 2);
    expect(after.status).toBe("PARTIAL");
    // Overpaying a line is refused
    await expect(asUser(acc.id, () => collectPayment(acc, branchId, { studentId: line.studentId, mode: "CASH", amount: toNum(after.balance) + 1, allocations: [{ studentFeeId: line.id, amount: toNum(after.balance) + 1 }] }))).rejects.toThrow();
  });

  it("parent pays online (sandbox gateway)", async () => {
    const { branchId } = await testCtx();
    const guardian = await db.guardian.findFirstOrThrow({ where: { userId: { not: null }, students: { some: { student: { status: "ACTIVE", fees: { some: { status: "PENDING", balance: { gt: 0 } } } } } } } });
    const link = await db.studentGuardian.findFirstOrThrow({ where: { guardianId: guardian.id, student: { fees: { some: { status: "PENDING", balance: { gt: 0 } } } } } });
    const line = await db.studentFee.findFirstOrThrow({ where: { studentId: link.studentId, status: "PENDING", balance: { gt: 0 } }, orderBy: { dueDate: "asc" } });
    const amount = toNum(line.balance);
    const start = await asUser(guardian.userId!, () => startOnlinePayment({ branchId, studentId: link.studentId, purpose: "FEE", amount, allocations: [{ studentFeeId: line.id, amount }], returnTo: "/parent/fees", initiatedById: guardian.userId! }));
    expect(start.checkoutUrl).toContain(start.paymentId);
    expect((await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status).toBe("PENDING");
    const t0 = new Date();
    await asUser(guardian.userId!, () => confirmOnlinePayment(start.paymentId, { gatewayPaymentId: "sbx_e2e", mode: "UPI", captured: true }));
    await confirmOnlinePayment(start.paymentId, { gatewayPaymentId: "sbx_e2e", mode: "UPI", captured: true }); // idempotent
    const p = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(p.status).toBe("SUCCESS");
    expect(p.receiptNo).toBeTruthy();
    expect(p.reconciled).toBe(true);
    const l2 = await db.studentFee.findUniqueOrThrow({ where: { id: line.id } });
    expect(l2.status).toBe("PAID");
    expect(toNum(l2.paidAmount)).toBeCloseTo(toNum(line.paidAmount) + amount, 2);
    expect(await db.notification.count({ where: { userId: guardian.userId!, createdAt: { gte: t0 } } })).toBeGreaterThan(0);
  });
});

describe("Dashboard figures match the database", () => {
  it("fee tiles", async () => {
    const { branchId } = await testCtx();
    const fe = await feesDashboard(branchId);
    const pending = await db.studentFee.aggregate({ where: { student: { branchId, status: "ACTIVE" }, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } }, _sum: { balance: true } });
    expect(fe.pendingDues).toBeCloseTo(toNum(pending._sum.balance), 2);
    const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
    const yearSum = await db.payment.aggregate({ where: { branchId, purpose: "FEE", status: "SUCCESS", paidAt: { gte: new Date(year.startDate.getTime() - 330 * 60000) } }, _sum: { amount: true } });
    expect(fe.collectedYear).toBeCloseTo(toNum(yearSum._sum.amount), 2);
    expect(fe.trend.reduce((a, t) => a + t.amount, 0)).toBeGreaterThan(0);
  });

  it("stationery, uniforms and transport tiles", async () => {
    const { branchId } = await testCtx();
    const st = await stationeryDashboard(branchId);
    expect(st.totalItems).toBe(await db.stationeryItem.count({ where: { branchId, isActive: true } }));
    // Recomputed independently from the raw rows (the JSON data engine has no SQL).
    const items = await db.stationeryItem.findMany({ where: { branchId, isActive: true }, select: { currentStock: true, reorderLevel: true, unitCost: true } });
    expect(st.lowStock.length).toBe(items.filter((i) => i.currentStock <= i.reorderLevel).length);
    expect(st.pendingRequests).toBe(await db.stationeryRequest.count({ where: { branchId, status: "PENDING" } }));
    expect(st.stockValue).toBeCloseTo(items.reduce((s, i) => s + i.currentStock * Number(i.unitCost), 0), 0);

    const un = await uniformsDashboard(branchId);
    expect(un.readyForPickup).toBe(await db.uniformOrder.count({ where: { branchId, status: "READY" } }));
    expect(un.openOrders).toBe(await db.uniformOrder.count({ where: { branchId, status: { in: ["ORDERED", "PAID", "READY"] } } }));

    const tr = await transportDashboard(branchId);
    expect(tr.buses).toBe(await db.bus.count({ where: { branchId, isActive: true } }));
    expect(tr.seatsFilled).toBe(await db.transportAllocation.count({ where: { status: "ACTIVE", bus: { branchId, isActive: true } } }));
    expect(tr.seats).toBe((await db.bus.aggregate({ where: { branchId, isActive: true }, _sum: { capacity: true } }))._sum.capacity);
  });
});
