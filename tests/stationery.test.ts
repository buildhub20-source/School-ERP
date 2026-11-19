import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { asUser, testCtx, uniq } from "./helpers";
import { createItem, saveSupplier } from "@/server/stationery/service";
import { createRequest, approveRequest, issueRequest, rejectRequest } from "@/server/stationery/requests";
import { recordMovement, saveKit, issueKit, startAudit, saveCounts, completeAudit } from "@/server/stationery/operations";
import { stationeryPendingReminder } from "@/server/stationery/automations";
import { pendingStationeryApprovals, stationeryDashboard } from "@/server/stationery/dashboard";

let branchId = "";
let adminId = "";
let teacherId = "";
let storeId = "";
const CAT = uniq("CAT"); // unique category keeps audits and lookups isolated from demo data
const itemIds: string[] = [];
const supplierIds: string[] = [];
const kitIds: string[] = [];
const requestIds: string[] = [];
const auditIds: string[] = [];

const as = <T>(fn: () => Promise<T>) => asUser(adminId, fn);
async function item(opening: number, extra: Partial<Parameters<typeof createItem>[1]> = {}) {
  const it = await as(() => createItem(branchId, { name: uniq("Item "), category: CAT, unit: "pcs", unitCost: 10, reorderLevel: 0, reorderQty: 0, openingStock: opening, ...extra }));
  itemIds.push(it.id);
  return it;
}
const stock = async (id: string) => (await db.stationeryItem.findUniqueOrThrow({ where: { id } })).currentStock;
async function request(by: string, lines: { itemId: string; qty: number }[]) {
  const r = await asUser(by, () => createRequest(branchId, by, { purpose: "test", lines }));
  requestIds.push(r.id);
  return db.stationeryRequest.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
}

beforeAll(async () => {
  const ctx = await testCtx();
  branchId = ctx.branchId;
  adminId = ctx.adminId;
  teacherId = (await db.user.findUniqueOrThrow({ where: { email: "anitha@school.test" } })).id;
  storeId = (await db.user.findUniqueOrThrow({ where: { email: "store@school.test" } })).id;
});

afterAll(async () => {
  const pos = await db.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } });
  await db.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
  await db.stockAuditLine.deleteMany({ where: { itemId: { in: itemIds } } });
  await db.stockAudit.deleteMany({ where: { id: { in: auditIds } } });
  await db.stationeryRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
  await db.stationeryRequest.deleteMany({ where: { id: { in: requestIds } } });
  await db.kitIssue.deleteMany({ where: { kitId: { in: kitIds } } });
  await db.stationeryKit.deleteMany({ where: { id: { in: kitIds } } });
  await db.purchaseOrderLine.deleteMany({ where: { OR: [{ poId: { in: pos.map((p) => p.id) } }, { stationeryItemId: { in: itemIds } }] } });
  await db.purchaseOrder.deleteMany({ where: { id: { in: pos.map((p) => p.id) } } });
  await db.supplierPrice.deleteMany({ where: { stationeryItemId: { in: itemIds } } });
  await db.stationeryItem.deleteMany({ where: { id: { in: itemIds } } });
  await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
});

describe("stationery requests", () => {
  it("issuing an approved request deducts stock and records the movement", async () => {
    const a = await item(100);
    const r = await request(teacherId, [{ itemId: a.id, qty: 30 }]);
    await asUser(storeId, () => approveRequest(branchId, storeId, r.id, { lines: [] }));
    await asUser(storeId, () => issueRequest(branchId, storeId, r.id));
    expect(await stock(a.id)).toBe(70);
    const done = await db.stationeryRequest.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true, movements: true } });
    expect(done.status).toBe("ISSUED");
    expect(done.lines[0].qtyIssued).toBe(30);
    expect(done.movements).toHaveLength(1);
    expect(done.movements[0]).toMatchObject({ type: "ISSUE", qty: -30, balanceAfter: 70, recipientUserId: teacherId, createdById: storeId });
    // cannot issue twice
    await expect(asUser(storeId, () => issueRequest(branchId, storeId, r.id))).rejects.toThrow();
  });

  it("partial approval keeps per-line quantities and marks the request partly approved", async () => {
    const a = await item(50), b = await item(50);
    const r = await request(teacherId, [{ itemId: a.id, qty: 20 }, { itemId: b.id, qty: 10 }]);
    const la = r.lines.find((l) => l.itemId === a.id)!;
    const lb = r.lines.find((l) => l.itemId === b.id)!;
    await expect(asUser(storeId, () => approveRequest(branchId, storeId, r.id, { lines: [{ lineId: la.id, qty: 25 }] }))).rejects.toThrow(/more than/);
    const ok = await asUser(storeId, () => approveRequest(branchId, storeId, r.id, { lines: [{ lineId: la.id, qty: 5 }, { lineId: lb.id, qty: 0 }] }));
    expect(ok.status).toBe("PARTIALLY_APPROVED");
    await asUser(storeId, () => issueRequest(branchId, storeId, r.id));
    expect(await stock(a.id)).toBe(45);
    expect(await stock(b.id)).toBe(50);
  });

  it("nobody can approve or reject their own request", async () => {
    const a = await item(10);
    const r = await request(storeId, [{ itemId: a.id, qty: 1 }]);
    await expect(asUser(storeId, () => approveRequest(branchId, storeId, r.id, { lines: [] }))).rejects.toThrow(/own request/);
    await expect(asUser(storeId, () => rejectRequest(branchId, storeId, r.id, "x"))).rejects.toThrow(/own request/);
    expect((await pendingStationeryApprovals(branchId)).some((p) => p.id === r.id)).toBe(true);
  });

  it("refuses to issue more than is in stock and deducts nothing", async () => {
    const a = await item(5), b = await item(100);
    const r = await request(teacherId, [{ itemId: a.id, qty: 8 }, { itemId: b.id, qty: 10 }]);
    await asUser(storeId, () => approveRequest(branchId, storeId, r.id, { lines: [] }));
    await expect(asUser(storeId, () => issueRequest(branchId, storeId, r.id))).rejects.toThrow(/Not enough stock/);
    expect(await stock(a.id)).toBe(5);
    expect(await stock(b.id)).toBe(100);
    await expect(as(() => recordMovement(branchId, { kind: "DAMAGE", note: "x", lines: [{ itemId: a.id, qty: 6 }] }))).rejects.toThrow(/Not enough stock/);
    expect(await stock(a.id)).toBe(5);
  });

  it("pending reminder is idempotent", async () => {
    const a = await item(10);
    const r = await request(teacherId, [{ itemId: a.id, qty: 1 }]);
    await db.stationeryRequest.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - 5 * 86400000) } });
    await stationeryPendingReminder({ days: 2 });
    expect((await db.stationeryRequest.findUniqueOrThrow({ where: { id: r.id } })).reminderSentAt).not.toBeNull();
    expect(await stationeryPendingReminder({ days: 2 })).toMatch(/No stationery requests/);
  });
});

describe("low stock automation", () => {
  it("alerts once and adds items to ONE open auto-draft purchase order per supplier", async () => {
    const sup = await as(() => saveSupplier(branchId, undefined, { name: uniq("Supplier ") }));
    supplierIds.push(sup.id);
    const a = await item(50, { reorderLevel: 20, reorderQty: 100, preferredSupplierId: sup.id });
    const b = await item(50, { reorderLevel: 10, reorderQty: 40, preferredSupplierId: sup.id });
    await as(() => recordMovement(branchId, { kind: "LOSS", note: "t", lines: [{ itemId: a.id, qty: 31 }] })); // 19 ≤ 20
    await as(() => recordMovement(branchId, { kind: "LOSS", note: "t", lines: [{ itemId: b.id, qty: 45 }] })); // 5 ≤ 10
    await as(() => recordMovement(branchId, { kind: "LOSS", note: "t", lines: [{ itemId: a.id, qty: 1 }] })); // still low: no duplicate
    const pos = await db.purchaseOrder.findMany({ where: { supplierId: sup.id }, include: { lines: true } });
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ status: "DRAFT", isAutoDraft: true, type: "STATIONERY" });
    expect(pos[0].lines.map((l) => [l.stationeryItemId, l.qtyOrdered]).sort()).toEqual([[a.id, 100], [b.id, 40]].sort());
    expect((await db.stationeryItem.findUniqueOrThrow({ where: { id: a.id } })).lowStockAlertedAt).not.toBeNull();
    expect((await stationeryDashboard(branchId)).lowStock.some((x) => x.id === a.id)).toBe(true);
    // restock clears the flag
    await as(() => recordMovement(branchId, { kind: "ADJUST_IN", note: "t", lines: [{ itemId: a.id, qty: 50 }] }));
    expect((await db.stationeryItem.findUniqueOrThrow({ where: { id: a.id } })).lowStockAlertedAt).toBeNull();
  });
});

describe("kits and audits", () => {
  it("kit issue checks stock for every item before deducting anything", async () => {
    const cls = await db.schoolClass.findFirstOrThrow({ where: { branchId, students: { some: { status: "ACTIVE" } } } });
    const n = await db.student.count({ where: { classId: cls.id, status: "ACTIVE" } });
    const plenty = await item(n * 3 + 5);
    const scarce = await item(n - 1);
    const kit = await as(() => saveKit(branchId, undefined, { name: uniq("Kit "), classId: cls.id, lines: [{ itemId: plenty.id, qty: 3 }, { itemId: scarce.id, qty: 1 }] }));
    kitIds.push(kit.id);
    await expect(as(() => issueKit(branchId, { kitId: kit.id }))).rejects.toThrow(/Not enough stock/);
    expect(await stock(plenty.id)).toBe(n * 3 + 5);
    await as(() => recordMovement(branchId, { kind: "ADJUST_IN", note: "t", lines: [{ itemId: scarce.id, qty: 1 }] }));
    const issue = await as(() => issueKit(branchId, { kitId: kit.id }));
    expect(issue.studentCount).toBe(n);
    expect(await stock(plenty.id)).toBe(5);
    expect(await stock(scarce.id)).toBe(0);
    const mv = await db.stockMovement.findFirstOrThrow({ where: { kitId: kit.id, itemId: plenty.id } });
    expect(mv).toMatchObject({ qty: -n * 3, classId: cls.id, recipientType: "CLASS" });
  });

  it("completing an audit posts the counted difference as an AUDIT adjustment", async () => {
    const open = await db.stockAudit.findFirst({ where: { branchId, status: "IN_PROGRESS" } });
    if (open) return; // a real audit is running in the dev DB; don't interfere
    const a = await item(40), b = await item(15);
    const audit = await as(() => startAudit(branchId, { category: CAT }));
    auditIds.push(audit.id);
    const lines = await db.stockAuditLine.findMany({ where: { auditId: audit.id } });
    const la = lines.find((l) => l.itemId === a.id)!, lb = lines.find((l) => l.itemId === b.id)!;
    // a movement during the count is kept: delta = counted − system-at-start
    await as(() => recordMovement(branchId, { kind: "ISSUE", recipientType: "OTHER", lines: [{ itemId: a.id, qty: 4 }] }));
    await as(() => saveCounts(branchId, audit.id, [{ lineId: la.id, countedQty: 37 }, { lineId: lb.id, countedQty: 15 }]));
    const res = await as(() => completeAudit(branchId, audit.id));
    expect(res.adjusted).toBe(1);
    expect(await stock(a.id)).toBe(33); // 40 − 4 − 3
    expect(await stock(b.id)).toBe(15);
    const mv = await db.stockMovement.findFirstOrThrow({ where: { auditId: audit.id } });
    expect(mv).toMatchObject({ type: "AUDIT", qty: -3, itemId: a.id });
    await expect(as(() => completeAudit(branchId, audit.id))).rejects.toThrow(/closed/);
  });
});

describe("reports and dashboard contract", () => {
  it("every stationery report runs with and without filters", async () => {
    const { stationeryReports } = await import("@/server/stationery/reports");
    const user = { id: adminId } as never;
    for (const r of stationeryReports) {
      for (const g of [undefined, ...(r.groupBy ?? []).map((x) => x.value)]) {
        const res = await r.run({ groupBy: g, from: new Date("2026-01-01T00:00:00Z"), to: new Date("2027-12-31T23:59:59Z") }, { user, branchId });
        expect(Array.isArray(res.rows)).toBe(true);
        expect(res.columns.length).toBeGreaterThan(0);
      }
    }
    const d = await stationeryDashboard(branchId);
    expect(d.totalItems).toBeGreaterThan(0);
    expect(typeof d.stockValue).toBe("number");
  });
});
