import "server-only";
import { db, type DbOrTx } from "@/lib/db";
import { toNum } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { AppError } from "@/lib/errors";
import { createFeeLine, recalcFee } from "@/server/fees/core";
import { isAutomationEnabled } from "@/lib/automations/config";

/**
 * TRANSPORT CORE — fee and seat logic shared with the student and fee modules.
 * Fee per stop: Stop.feeAmount (STOP mode) or the distance slab for Stop.distanceKm (DISTANCE mode).
 * Basis TERM = that amount is charged every term; ANNUAL = charged once for the year.
 */

export async function transportFeeHead(client: DbOrTx, branchId: string) {
  const head = await client.feeHead.findFirst({ where: { branchId, type: "TRANSPORT", isActive: true } });
  if (head) return head;
  return client.feeHead.create({ data: { branchId, name: "Transport Fee", type: "TRANSPORT", lateFeeApplies: true } });
}

export async function stopFee(client: DbOrTx, stopId: string): Promise<number> {
  const stop = await client.stop.findUniqueOrThrow({ where: { id: stopId }, include: { route: true } });
  const policies = await getSetting("policies", stop.route.branchId);
  if (policies.transportFeeMode === "STOP") return toNum(stop.feeAmount);
  const km = toNum(stop.distanceKm);
  const slab = await client.transportFeeSlab.findFirst({ where: { branchId: stop.route.branchId, fromKm: { lte: km }, toKm: { gte: km } }, orderBy: { fromKm: "asc" } });
  return slab ? toNum(slab.amount) : toNum(stop.feeAmount);
}

/** Seats taken on a bus by active allocations. */
export async function seatsTaken(client: DbOrTx, busId: string) {
  return client.transportAllocation.count({ where: { busId, status: "ACTIVE" } });
}

/** Enforce the capacity policy. Returns a warning string when policy is WARN and the bus is full. */
export async function checkCapacity(client: DbOrTx, busId: string, override = false): Promise<string | null> {
  const bus = await client.bus.findUniqueOrThrow({ where: { id: busId } });
  const taken = await seatsTaken(client, busId);
  if (taken < bus.capacity) return null;
  const policies = await getSetting("policies", bus.branchId);
  if (policies.capacityPolicy === "BLOCK" && !override) throw new AppError(`${bus.busNo} is full (${taken}/${bus.capacity} seats). Choose another bus or increase its capacity.`);
  return `${bus.busNo} is over capacity (${taken + 1}/${bus.capacity}).`;
}

/** Automation "transport.feeOnAssign": add transport fee lines for the allocation's remaining terms. */
export async function createTransportFees(client: DbOrTx, allocationId: string) {
  if (!(await isAutomationEnabled("transport.feeOnAssign"))) return 0;
  const a = await client.transportAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { student: true, stop: true, academicYear: { include: { terms: { orderBy: { sequence: "asc" } } } } } });
  const head = await transportFeeHead(client, a.student.branchId);
  const fee = await stopFee(client, a.stopId);
  if (fee <= 0) return 0;
  const policies = await getSetting("policies", a.student.branchId);
  const existing = await client.studentFee.findMany({ where: { allocationId: a.id, status: { not: "CANCELLED" } }, select: { termId: true } });
  const have = new Set(existing.map((e) => e.termId ?? "ANNUAL"));
  let n = 0;
  if (policies.transportFeeBasis === "ANNUAL") {
    if (!have.has("ANNUAL")) {
      await createFeeLine(client, { studentId: a.studentId, academicYearId: a.academicYearId, feeHeadId: head.id, description: `Transport — ${a.stop.name} (Annual)`, amount: fee, dueDate: a.startDate, source: "TRANSPORT", allocationId: a.id });
      n++;
    }
    return n;
  }
  for (const t of a.academicYear.terms) {
    if (t.endDate < a.startDate || have.has(t.id)) continue;
    const due = t.startDate > a.startDate ? t.startDate : a.startDate;
    await createFeeLine(client, { studentId: a.studentId, academicYearId: a.academicYearId, termId: t.id, feeHeadId: head.id, description: `Transport — ${a.stop.name} — ${t.name}`, amount: fee, dueDate: due, source: "TRANSPORT", allocationId: a.id });
    n++;
  }
  return n;
}

/** End an allocation (frees the seat) and cancel unpaid transport fees for terms that start after the end date. */
export async function endAllocation(client: DbOrTx, allocationId: string, endDate: Date) {
  const a = await client.transportAllocation.update({ where: { id: allocationId }, data: { status: "ENDED", endDate } });
  const future = await client.studentFee.findMany({ where: { allocationId, status: "PENDING", paidAmount: 0, OR: [{ term: { startDate: { gt: endDate } } }, { termId: null, dueDate: { gt: endDate } }] } });
  for (const f of future) {
    await client.studentFee.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
    await recalcFee(client, f.id);
  }
  return { allocation: a, cancelledFees: future.length };
}

/**
 * Year close: re-create each ACTIVE allocation of `fromYearId` in `toYearId` (same bus, route and stop, starting on the new
 * year's start date), end the old one at the old year's end date and create the new year's transport fees.
 * Only students who are still ACTIVE are carried; others are just ended. Idempotent: students who already have an
 * allocation in the new year are skipped. Seats are carried as-is (no capacity check — nobody new is added).
 */
export async function copyAllocationsToYear(fromYearId: string, toYearId: string) {
  if (fromYearId === toYearId) throw new AppError("Choose a different academic year to copy transport allocations to.");
  const [from, to] = await Promise.all([db.academicYear.findUniqueOrThrow({ where: { id: fromYearId } }), db.academicYear.findUniqueOrThrow({ where: { id: toYearId } })]);
  const active = await db.transportAllocation.findMany({ where: { academicYearId: from.id, status: "ACTIVE" }, include: { student: true, bus: true, route: true } });
  let copied = 0, ended = 0, skipped = 0, feeLines = 0;
  for (const a of active) {
    const r = await db.$transaction(async (tx) => {
      const cur = await tx.transportAllocation.findUnique({ where: { id: a.id } });
      if (!cur || cur.status !== "ACTIVE") return { kind: "skip" as const, fees: 0 };
      const endDate = from.endDate < a.startDate ? a.startDate : from.endDate;
      await endAllocation(tx, a.id, endDate);
      const carry = a.student.status === "ACTIVE" && a.bus.isActive && a.route.isActive;
      if (!carry) return { kind: "end" as const, fees: 0 };
      const exists = await tx.transportAllocation.findFirst({ where: { studentId: a.studentId, academicYearId: to.id } });
      if (exists) return { kind: "skip" as const, fees: 0 };
      const n = await tx.transportAllocation.create({
        data: { studentId: a.studentId, academicYearId: to.id, busId: a.busId, routeId: a.routeId, stopId: a.stopId, startDate: to.startDate, capacityOverride: a.capacityOverride, createdById: a.createdById },
      });
      return { kind: "copy" as const, fees: await createTransportFees(tx, n.id) };
    }, { timeout: 30000, maxWait: 10000 });
    if (r.kind === "copy") copied++; else if (r.kind === "end") ended++; else skipped++;
    feeLines += r.fees;
  }
  return { copied, ended, skipped, feeLines };
}
