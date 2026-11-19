import type { UniformCategory, UniformGender } from "@prisma/client";
import type { SeedCtx } from "../seed";
import { db } from "@/lib/db";
import { moveStock } from "@/server/uniforms/core";
import {
  createItem, createOrder, createPurchase, createSupplier, exchangeItem, markDelivered, markReady, recordOrderPayment, returnItem, saveSet, setPreorderWindow, cancelOrder,
} from "@/server/uniforms/service";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

type ItemSpec = { name: string; category: UniformCategory; gender: UniformGender; sizes: string; base: number; step: number; reorder: number };
const ITEMS: ItemSpec[] = [
  { name: "Shirt (white)", category: "SHIRT", gender: "BOY", sizes: "28-40/2", base: 380, step: 20, reorder: 5 },
  { name: "Shirt (white)", category: "SHIRT", gender: "GIRL", sizes: "28-40/2", base: 380, step: 20, reorder: 5 },
  { name: "Pant (navy)", category: "PANT", gender: "BOY", sizes: "24-36/2", base: 450, step: 25, reorder: 4 },
  { name: "Shorts (navy)", category: "SHORTS", gender: "BOY", sizes: "20-28/2", base: 300, step: 15, reorder: 4 },
  { name: "Skirt (navy pleated)", category: "SKIRT", gender: "GIRL", sizes: "20-32/2", base: 420, step: 20, reorder: 4 },
  { name: "Black school shoes", category: "SHOES", gender: "UNISEX", sizes: "1-10", base: 640, step: 30, reorder: 3 },
  { name: "White canvas shoes (PT)", category: "SHOES", gender: "UNISEX", sizes: "1-10", base: 420, step: 20, reorder: 3 },
  { name: "Socks (navy, pair)", category: "SOCKS", gender: "UNISEX", sizes: "S, M, L", base: 60, step: 10, reorder: 20 },
  { name: "Belt (school logo)", category: "BELT", gender: "UNISEX", sizes: "S, M, L", base: 120, step: 10, reorder: 10 },
  { name: "Tie (striped)", category: "TIE", gender: "UNISEX", sizes: "Free", base: 110, step: 0, reorder: 15 },
  { name: "ID card with lanyard", category: "ID_CARD", gender: "UNISEX", sizes: "Free", base: 80, step: 0, reorder: 25 },
  { name: "Sweater (navy V-neck)", category: "SWEATER", gender: "UNISEX", sizes: "22-40/2", base: 620, step: 30, reorder: 3 },
  { name: "School badge", category: "BADGE", gender: "UNISEX", sizes: "Free", base: 40, step: 0, reorder: 30 },
];

/** Demo data for the uniforms module (idempotent: each part runs only when its data is missing). */
export async function seed_uniforms(ctx: SeedCtx) {
  const { branchId } = ctx;
  const storeId = ctx.users.store ?? ctx.adminId;

  // Items, sizes and opening stock (with deliberate gaps)
  if ((await db.uniformItem.count({ where: { branchId } })) === 0) {
    for (const [n, spec] of ITEMS.entries()) {
      const item = await createItem(branchId, { name: spec.name, category: spec.category, gender: spec.gender, sizes: spec.sizes, price: spec.base, reorderLevel: spec.reorder, openingStock: 0 }, storeId);
      const variants = await db.uniformVariant.findMany({ where: { itemId: item.id }, orderBy: { sizeOrder: "asc" } });
      await db.$transaction(async (tx) => {
        for (const [i, v] of variants.entries()) {
          await tx.uniformVariant.update({ where: { id: v.id }, data: { price: spec.base + spec.step * i, sku: `U${String(n + 1).padStart(2, "0")}-${v.size.replace(/\W/g, "")}` } });
          const single = variants.length === 1;
          const qty = single ? 120 : (i * 7 + n * 3) % 9 === 0 ? 0 : 6 + ((i * 11 + n * 5) % 22); // some sizes out of stock
          if (qty > 0) await moveStock(tx, { variantId: v.id, qty, type: "OPENING", note: "Opening stock", userId: storeId });
        }
      }, { timeout: 30000 });
    }
    console.log(`  ${ITEMS.length} uniform items`);
  }
  const items = await db.uniformItem.findMany({ where: { branchId }, include: { variants: { orderBy: { sizeOrder: "asc" } } } });
  const it = (name: string, g?: UniformGender) => items.find((x) => x.name === name && (!g || x.gender === g))!;

  // Uniform sets: primary boys wear shorts, everyone else the default set
  if ((await db.uniformSet.count({ where: { branchId } })) === 0) {
    const common = [{ itemId: it("Tie (striped)").id, qty: 1 }, { itemId: it("Belt (school logo)").id, qty: 1 }, { itemId: it("Socks (navy, pair)").id, qty: 2 }, { itemId: it("Black school shoes").id, qty: 1 }, { itemId: it("School badge").id, qty: 1 }];
    await saveSet(branchId, { name: "Boys — full set", gender: "BOY", items: [{ itemId: it("Shirt (white)", "BOY").id, qty: 2 }, { itemId: it("Pant (navy)").id, qty: 2 }, ...common] });
    await saveSet(branchId, { name: "Girls — full set", gender: "GIRL", items: [{ itemId: it("Shirt (white)", "GIRL").id, qty: 2 }, { itemId: it("Skirt (navy pleated)").id, qty: 2 }, ...common] });
    const primary = await db.schoolClass.findMany({ where: { branchId, grade: { lte: 5 } }, orderBy: { grade: "asc" } });
    for (const c of primary) {
      await saveSet(branchId, { name: `${c.name} boys`, classId: c.id, gender: "BOY", items: [{ itemId: it("Shirt (white)", "BOY").id, qty: 2 }, { itemId: it("Shorts (navy)").id, qty: 2 }, ...common.filter((x) => x.itemId !== it("Belt (school logo)").id)] });
    }
    console.log(`  ${2 + primary.length} uniform sets`);
  }

  // Suppliers and purchases
  let lakshmi = await db.supplier.findFirst({ where: { branchId, name: "Sri Lakshmi Garments" } });
  if (!lakshmi) lakshmi = await createSupplier(branchId, { name: "Sri Lakshmi Garments", contactPerson: "Ravi Shankar", phone: "9840011223", address: "Tiruppur" });
  let shoes = await db.supplier.findFirst({ where: { branchId, name: "Bata Dealer — Anna Nagar" } });
  if (!shoes) shoes = await createSupplier(branchId, { name: "Bata Dealer — Anna Nagar", contactPerson: "Imran", phone: "9840033445" });
  if ((await db.purchaseOrder.count({ where: { branchId, type: "UNIFORM" } })) === 0) {
    const sw = it("Sweater (navy V-neck)").variants;
    await createPurchase(branchId, { supplierId: lakshmi.id, status: "RECEIVED", invoiceNo: "SLG/2026/118", lines: it("Shirt (white)", "BOY").variants.slice(1, 5).map((v) => ({ variantId: v.id, qty: 15, unitPrice: Number(v.price) * 0.62 })) }, storeId);
    await createPurchase(branchId, { supplierId: lakshmi.id, status: "ORDERED", expectedDate: d("2026-11-20"), notes: "Winter sweaters", lines: sw.slice(2, 7).map((v) => ({ variantId: v.id, qty: 10, unitPrice: Number(v.price) * 0.6 })) }, storeId);
    await createPurchase(branchId, { supplierId: shoes.id, status: "DRAFT", lines: it("Black school shoes").variants.slice(3, 7).map((v) => ({ variantId: v.id, qty: 8, unitPrice: Number(v.price) * 0.7 })) }, storeId);
  }

  // Orders
  if ((await db.uniformOrder.count({ where: { branchId } })) > 0) return;
  const current = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const past = await db.academicYear.upsert({
    where: { name: "2025-26" },
    create: { name: "2025-26", startDate: d("2025-06-01"), endDate: d("2026-04-30"), isCurrent: false, closedAt: d("2026-05-31") },
    update: {},
  });
  const students = await db.student.findMany({ where: { branchId, status: "ACTIVE" }, include: { schoolClass: true }, orderBy: { admissionNo: "asc" } });
  if (!students.length) return;

  // Top up stock so the demo orders can be fulfilled (logged as an opening adjustment)
  const pick = (variants: { id: string }[], grade: number, offset = 0) => variants[Math.max(0, Math.min(variants.length - 1, Math.round(((grade + 1) / 13) * (variants.length - 1)) + offset))];
  type S = (typeof students)[number];
  const linesFor = (s: S, opts: { sweater?: boolean; shoes?: boolean; full?: boolean; offset?: number }) => {
    const g = s.schoolClass.grade, boy = s.gender === "MALE", o = opts.offset ?? 0;
    const out: { variantId: string; qty: number }[] = [];
    if (opts.full !== false) {
      out.push({ variantId: pick(it("Shirt (white)", boy ? "BOY" : "GIRL").variants, g, o).id, qty: 2 });
      out.push({ variantId: pick((boy ? (g <= 5 ? it("Shorts (navy)") : it("Pant (navy)")) : it("Skirt (navy pleated)")).variants, g, o).id, qty: 2 });
      out.push({ variantId: it("Tie (striped)").variants[0].id, qty: 1 }, { variantId: pick(it("Socks (navy, pair)").variants, g).id, qty: 2 });
    }
    if (opts.shoes) out.push({ variantId: pick(it("Black school shoes").variants, g, o).id, qty: 1 });
    if (opts.sweater) out.push({ variantId: pick(it("Sweater (navy V-neck)").variants, g, o).id, qty: 1 });
    return out;
  };
  const ensureStock = async (lines: { variantId: string; qty: number }[]) => {
    for (const l of lines) {
      const v = await db.uniformVariant.findUniqueOrThrow({ where: { id: l.variantId } });
      if (v.stock < l.qty) await db.$transaction((tx) => moveStock(tx, { variantId: v.id, qty: l.qty - v.stock + 2, type: "ADJUSTMENT", note: "Stock count", userId: storeId }));
    }
  };
  const pay = async (orderId: string, amount?: number, mode: "CASH" | "UPI" = "CASH") => {
    const o = await db.uniformOrder.findUniqueOrThrow({ where: { id: orderId } });
    await recordOrderPayment(branchId, { orderId, amount: amount ?? Number(o.total) - Number(o.paidAmount), mode, reference: mode === "UPI" ? `UPI${orderId.slice(-8).toUpperCase()}` : undefined }, storeId);
  };
  const place = (s: S, lines: { variantId: string; qty: number }[], extra: { isPreOrder?: boolean; via?: "COUNTER" | "PARENT" } = {}) =>
    createOrder(branchId, { studentId: s.id, lines, isPreOrder: extra.isPreOrder, placedVia: extra.via ?? "COUNTER" }, storeId);

  // Last academic year: delivered orders (with sweaters and shoes) for seasonal planning and size profiles
  const lastYear = students.filter((_, i) => i % 9 === 1).slice(0, 14);
  for (const [i, s] of lastYear.entries()) {
    const lines = linesFor(s, { sweater: i % 3 !== 2, shoes: i % 4 !== 3, offset: -1 });
    await ensureStock(lines);
    const o = await place(s, lines);
    await pay(o.id);
    await markReady(branchId, o.id, storeId);
    const when = new Date(Date.UTC(2025, 5 + (i % 6), 3 + i));
    await db.uniformOrder.update({ where: { id: o.id }, data: { academicYearId: past.id, createdAt: when, paidAt: when, readyAt: when } });
    await markDelivered(branchId, o.id);
    await db.uniformOrder.update({ where: { id: o.id }, data: { deliveredAt: new Date(when.getTime() + 3 * 86400000) } });
    await db.payment.updateMany({ where: { uniformOrderId: o.id }, data: { paidAt: when } });
    await db.uniformMovement.updateMany({ where: { orderId: o.id }, data: { createdAt: when } });
  }

  // This year: orders across every status
  const pool = students.filter((_, i) => i % 9 !== 1);
  const parent = await db.guardian.findUnique({ where: { phone: "9840000002" }, include: { students: true } });
  const parentKids = parent ? pool.filter((s) => parent.students.some((x) => x.studentId === s.id)) : [];
  const others = pool.filter((s) => !parentKids.includes(s));
  const take = (k: number) => others.splice(0, k);
  let made = lastYear.length;

  for (const s of take(3)) { await place(s, linesFor(s, {})); made++; }                                   // ORDERED (unpaid)
  for (const s of take(1)) { const o = await place(s, linesFor(s, { shoes: true })); await pay(o.id, 500); made++; } // ORDERED, part paid
  for (const s of take(3)) { const o = await place(s, linesFor(s, { shoes: true })); await pay(o.id, undefined, "UPI"); made++; } // PAID
  for (const s of take(3)) { const l = linesFor(s, {}); await ensureStock(l); const o = await place(s, l); await pay(o.id); await markReady(branchId, o.id, storeId); made++; } // READY
  for (const [i, s] of take(4).entries()) {                                                                // DELIVERED
    const l = linesFor(s, { sweater: i === 0 }); await ensureStock(l);
    const o = await place(s, l); await pay(o.id); await markReady(branchId, o.id, storeId); await markDelivered(branchId, o.id);
    const full = await db.uniformOrder.findUniqueOrThrow({ where: { id: o.id }, include: { lines: { include: { variant: { include: { item: { include: { variants: { orderBy: { sizeOrder: "asc" } } } } } } } } } });
    if (i === 1) { // wrong shirt size swapped for the next size up
      const line = full.lines.find((x) => x.variant.item.category === "SHIRT")!;
      const next = line.variant.item.variants.find((v) => v.sizeOrder > line.variant.sizeOrder);
      if (next) { await ensureStock([{ variantId: next.id, qty: 1 }]); await exchangeItem(branchId, { orderId: o.id, lineId: line.id, toVariantId: next.id, qty: 1, reason: "Too tight" }, storeId); await pay(o.id).catch(() => {}); }
    }
    if (i === 2) { const line = full.lines.find((x) => x.variant.item.category === "SOCKS")!; await returnItem(branchId, { orderId: o.id, lineId: line.id, qty: 1, reason: "Extra pair not needed" }, storeId); }
    made++;
  }
  for (const s of take(1)) { const o = await place(s, linesFor(s, {})); await cancelOrder(branchId, o.id, "Parent bought elsewhere", storeId); made++; } // CANCELLED

  // Parent demo account: one order ready to collect, one awaiting online payment
  if (parentKids[0]) {
    const s = parentKids[0];
    const l = linesFor(s, {}); await ensureStock(l);
    const o = await place(s, l, { via: "PARENT" }); await pay(o.id, undefined, "UPI"); await markReady(branchId, o.id, storeId);
    await place(s, linesFor(s, { full: false, shoes: true }), { via: "PARENT" });
    made += 2;
  }

  // Pre-orders: open the window for the current year and record demand by size
  await setPreorderWindow(current.id, true);
  for (const [i, s] of [...take(5), ...parentKids.slice(1, 2)].entries()) {
    const o = await place(s, linesFor(s, { sweater: i % 2 === 0, shoes: true, offset: 1 }), { isPreOrder: true, via: "PARENT" });
    if (i % 2 === 1) await pay(o.id, undefined, "UPI");
    made++;
  }
  console.log(`  ${made} uniform orders (${lastYear.length} from ${past.name})`);
}
