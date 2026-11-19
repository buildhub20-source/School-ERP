import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { asUser, testCtx, uniq } from "./helpers";
import { createItem, createOrder, recordOrderPayment, markReady, markDelivered, exchangeItem, returnItem, cancelOrder } from "@/server/uniforms/service";
import { onUniformPaymentSuccess } from "@/server/uniforms/payments";
import { stepSize, suggestSizes } from "@/server/uniforms/core";
import { recordPayment } from "@/server/fees/core";

let ctx: Awaited<ReturnType<typeof testCtx>>;
let studentId = "";
let itemId = "";
let v: { id: string; size: string; stock: number }[] = [];
const run = <T,>(fn: () => Promise<T>) => asUser(ctx.adminId, fn);
const stock = async (id: string) => (await db.uniformVariant.findUniqueOrThrow({ where: { id } })).stock;
const setStock = (id: string, n: number) => db.uniformVariant.update({ where: { id }, data: { stock: n } });

beforeAll(async () => {
  ctx = await testCtx();
  const cls = await db.schoolClass.findFirstOrThrow({ where: { branchId: ctx.branchId } });
  const s = await db.student.create({ data: { branchId: ctx.branchId, admissionNo: uniq("UT"), firstName: "Uniform", lastName: "Tester", gender: "MALE", classId: cls.id } });
  studentId = s.id;
  const item = await run(() => createItem(ctx.branchId, { name: uniq("Test shirt "), category: "SHIRT", gender: "UNISEX", sizes: "28-34/2", price: 400, reorderLevel: 0, openingStock: 5 }));
  itemId = item.id;
  v = await db.uniformVariant.findMany({ where: { itemId }, orderBy: { sizeOrder: "asc" } });
  // sizes 28, 30, 32, 34 — make 30 more expensive
  await db.uniformVariant.update({ where: { id: v[1].id }, data: { price: 450 } });
});

afterAll(async () => {
  const orders = await db.uniformOrder.findMany({ where: { studentId }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await db.payment.deleteMany({ where: { uniformOrderId: { in: ids } } });
  await db.uniformExchange.deleteMany({ where: { orderId: { in: ids } } });
  await db.uniformOrder.deleteMany({ where: { id: { in: ids } } });
  await db.uniformMovement.deleteMany({ where: { variant: { itemId } } });
  await db.uniformSizeProfile.deleteMany({ where: { studentId } });
  await db.uniformItem.delete({ where: { id: itemId } });
  await db.student.delete({ where: { id: studentId } });
});

async function paidOrder(lines: { variantId: string; qty: number }[]) {
  const o = await run(() => createOrder(ctx.branchId, { studentId, lines }, ctx.adminId));
  await run(() => recordOrderPayment(ctx.branchId, { orderId: o.id, amount: Number(o.total), mode: "CASH" }, ctx.adminId));
  return o;
}

describe("uniform orders", () => {
  it("payment marks the order PAID only when fully paid", async () => {
    const o = await run(() => createOrder(ctx.branchId, { studentId, lines: [{ variantId: v[0].id, qty: 2 }] }, ctx.adminId));
    expect(Number(o.total)).toBe(800);
    await run(() => recordOrderPayment(ctx.branchId, { orderId: o.id, amount: 300, mode: "CASH" }, ctx.adminId));
    let r = await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.status).toBe("ORDERED");
    expect(Number(r.paidAmount)).toBe(300);
    await expect(run(() => recordOrderPayment(ctx.branchId, { orderId: o.id, amount: 600, mode: "CASH" }, ctx.adminId))).rejects.toThrow(/more than the balance/);
    // Contract used by the fees module (e.g. an online payment confirmed)
    const p = await run(() => db.$transaction((tx) => recordPayment(tx, { branchId: ctx.branchId, studentId, amount: 500, mode: "UPI", purpose: "UNIFORM", uniformOrderId: o.id, source: "ONLINE" })));
    await onUniformPaymentSuccess(db, p.id);
    r = await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.status).toBe("PAID");
    expect(Number(r.paidAmount)).toBe(800);
    expect(r.paidAt).not.toBeNull();
    await run(() => cancelOrder(ctx.branchId, o.id, "test", ctx.adminId));
  });

  it("cannot mark Ready without stock (and nothing is deducted)", async () => {
    await setStock(v[3].id, 1);
    await setStock(v[2].id, 5);
    const o = await paidOrder([{ variantId: v[2].id, qty: 1 }, { variantId: v[3].id, qty: 2 }]);
    await expect(run(() => markReady(ctx.branchId, o.id, ctx.adminId))).rejects.toThrow(/Not enough stock/);
    expect((await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PAID");
    expect(await stock(v[2].id)).toBe(5);
    expect(await stock(v[3].id)).toBe(1);
    await run(() => cancelOrder(ctx.branchId, o.id, "test", ctx.adminId));
  });

  it("deducts stock once when marked Ready; cancelling a Ready order puts it back", async () => {
    await setStock(v[0].id, 5);
    const o = await paidOrder([{ variantId: v[0].id, qty: 2 }]);
    await run(() => markReady(ctx.branchId, o.id, ctx.adminId));
    expect(await stock(v[0].id)).toBe(3);
    await expect(run(() => markReady(ctx.branchId, o.id, ctx.adminId))).rejects.toThrow();
    expect(await stock(v[0].id)).toBe(3);
    expect(await db.uniformMovement.count({ where: { orderId: o.id, type: "ORDER_OUT" } })).toBe(1);
    await run(() => cancelOrder(ctx.branchId, o.id, "test", ctx.adminId));
    expect(await stock(v[0].id)).toBe(5);
  });

  it("cannot mark Ready before payment", async () => {
    const o = await run(() => createOrder(ctx.branchId, { studentId, lines: [{ variantId: v[0].id, qty: 1 }] }, ctx.adminId));
    await expect(run(() => markReady(ctx.branchId, o.id, ctx.adminId))).rejects.toThrow(/payment/);
    await run(() => cancelOrder(ctx.branchId, o.id, "test", ctx.adminId));
  });

  it("exchange and return keep stock and totals correct; delivery saves the size profile", async () => {
    await setStock(v[0].id, 5);
    await setStock(v[1].id, 5);
    const o = await paidOrder([{ variantId: v[0].id, qty: 2 }]);
    await run(() => markReady(ctx.branchId, o.id, ctx.adminId));
    await run(() => markDelivered(ctx.branchId, o.id));
    let prof = await db.uniformSizeProfile.findUniqueOrThrow({ where: { studentId_itemId: { studentId, itemId } } });
    expect(prof.size).toBe("28");

    const line = await db.uniformOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
    const ex = await run(() => exchangeItem(ctx.branchId, { orderId: o.id, lineId: line.id, toVariantId: v[1].id, qty: 2, reason: "small" }, ctx.adminId));
    expect(ex.priceDiff).toBe(100);
    expect(await stock(v[0].id)).toBe(5);
    expect(await stock(v[1].id)).toBe(3);
    let r = await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true } });
    expect(Number(r.total)).toBe(900);
    expect(r.status).toBe("DELIVERED");
    prof = await db.uniformSizeProfile.findUniqueOrThrow({ where: { studentId_itemId: { studentId, itemId } } });
    expect(prof.size).toBe("30");

    await expect(run(() => exchangeItem(ctx.branchId, { orderId: o.id, lineId: r.lines[0].id, toVariantId: v[3].id, qty: 3 }, ctx.adminId))).rejects.toThrow(/Only 2/);
    const ret = await run(() => returnItem(ctx.branchId, { orderId: o.id, lineId: r.lines[0].id, qty: 1, reason: "extra" }, ctx.adminId));
    expect(await stock(v[1].id)).toBe(4);
    r = await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: true } });
    expect(Number(r.total)).toBe(450);
    expect(ret.refundDue).toBe(350); // paid 800, now owes 450
  });
});

describe("size suggestions", () => {
  const variants = [{ sizeOrder: 10, isActive: true, s: "28" }, { sizeOrder: 20, isActive: true, s: "30" }, { sizeOrder: 30, isActive: false, s: "32" }, { sizeOrder: 40, isActive: true, s: "34" }];
  it("steps up active sizes and clamps at the largest", () => {
    expect(stepSize(variants, 10, 1)?.s).toBe("30");
    expect(stepSize(variants, 20, 1)?.s).toBe("34"); // skips the inactive size
    expect(stepSize(variants, 40, 2)?.s).toBe("34");
    expect(stepSize(variants, 10, 0)?.s).toBe("28");
  });
  it("moves up only when the last order was in a previous academic year", async () => {
    await db.uniformSizeProfile.upsert({
      where: { studentId_itemId: { studentId, itemId } },
      create: { studentId, itemId, size: "28", sizeOrder: v[0].id ? 10 : 0, orderedAt: new Date("2025-07-01") },
      update: { size: "28", sizeOrder: 10, orderedAt: new Date("2025-07-01") },
    });
    const yearStart = new Date("2026-06-01");
    const next = (await suggestSizes(studentId, yearStart, db, 1)).get(itemId);
    expect(next?.size).toBe("30");
    expect(next?.movedUp).toBe(true);
    const same = (await suggestSizes(studentId, new Date("2025-06-01"), db, 1)).get(itemId);
    expect(same?.size).toBe("28");
    const two = (await suggestSizes(studentId, yearStart, db, 2)).get(itemId);
    expect(two?.size).toBe("32");
  });
});
