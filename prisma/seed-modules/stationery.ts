import type { SeedCtx } from "../seed";
import { db } from "@/lib/db";
import { runWithContext } from "@/lib/context";
import { createItem, saveSupplier, addQuote, createPo, markPoOrdered, quickPurchase } from "@/server/stationery/service";
import { createRequest, approveRequest, rejectRequest, issueRequest } from "@/server/stationery/requests";
import { recordMovement, saveKit, saveBudget } from "@/server/stationery/operations";

type ItemSeed = { name: string; category: string; unit: string; cost: number; stock: number; reorder: number; reorderQty: number; sup: 0 | 1 | 2 };

const ITEMS: ItemSeed[] = [
  { name: "Long notebook 200 pages", category: "Notebook", unit: "pcs", cost: 48, stock: 620, reorder: 150, reorderQty: 500, sup: 0 },
  { name: "Long notebook 100 pages", category: "Notebook", unit: "pcs", cost: 30, stock: 540, reorder: 150, reorderQty: 500, sup: 0 },
  { name: "Ruled notebook 160 pages (small)", category: "Notebook", unit: "pcs", cost: 26, stock: 90, reorder: 120, reorderQty: 400, sup: 0 },
  { name: "Four-line notebook (LKG/UKG)", category: "Notebook", unit: "pcs", cost: 22, stock: 260, reorder: 80, reorderQty: 300, sup: 0 },
  { name: "Graph notebook", category: "Notebook", unit: "pcs", cost: 35, stock: 180, reorder: 60, reorderQty: 200, sup: 1 },
  { name: "Blue ball pen", category: "Pen", unit: "pcs", cost: 6, stock: 900, reorder: 300, reorderQty: 1000, sup: 1 },
  { name: "Black ball pen", category: "Pen", unit: "pcs", cost: 6, stock: 420, reorder: 200, reorderQty: 600, sup: 1 },
  { name: "Red ball pen", category: "Pen", unit: "pcs", cost: 6, stock: 140, reorder: 150, reorderQty: 400, sup: 1 },
  { name: "Whiteboard marker (assorted)", category: "Pen", unit: "pcs", cost: 32, stock: 45, reorder: 60, reorderQty: 200, sup: 2 },
  { name: "HB pencil", category: "Pencil", unit: "pcs", cost: 5, stock: 1100, reorder: 300, reorderQty: 1000, sup: 1 },
  { name: "Colour pencils (12 shades)", category: "Pencil", unit: "box", cost: 60, stock: 150, reorder: 50, reorderQty: 150, sup: 2 },
  { name: "Non-dust eraser", category: "Eraser", unit: "pcs", cost: 4, stock: 700, reorder: 200, reorderQty: 800, sup: 1 },
  { name: "Sharpener with container", category: "Sharpener", unit: "pcs", cost: 7, stock: 480, reorder: 150, reorderQty: 500, sup: 1 },
  { name: "Plastic ruler 30 cm", category: "Ruler", unit: "pcs", cost: 10, stock: 320, reorder: 100, reorderQty: 300, sup: 0 },
  { name: "Geometry box", category: "Ruler", unit: "set", cost: 85, stock: 30, reorder: 40, reorderQty: 120, sup: 2 },
  { name: "Clear file folder (A4)", category: "File", unit: "pcs", cost: 15, stock: 260, reorder: 80, reorderQty: 300, sup: 0 },
  { name: "Box file", category: "File", unit: "pcs", cost: 75, stock: 40, reorder: 20, reorderQty: 50, sup: 2 },
  { name: "A4 copier paper 75 gsm", category: "Paper", unit: "ream", cost: 260, stock: 85, reorder: 30, reorderQty: 100, sup: 0 },
  { name: "Chart paper (white)", category: "Paper", unit: "sheet", cost: 8, stock: 380, reorder: 100, reorderQty: 400, sup: 2 },
  { name: "Brown cover paper roll", category: "Paper", unit: "roll", cost: 40, stock: 12, reorder: 25, reorderQty: 80, sup: 0 },
  { name: "Glue stick 15 g", category: "Art & Craft", unit: "pcs", cost: 18, stock: 210, reorder: 80, reorderQty: 250, sup: 2 },
  { name: "Crayons (24 colours)", category: "Art & Craft", unit: "box", cost: 45, stock: 160, reorder: 60, reorderQty: 200, sup: 2 },
  { name: "Scissors (child safe)", category: "Art & Craft", unit: "pcs", cost: 28, stock: 95, reorder: 30, reorderQty: 100, sup: 2 },
  { name: "Stapler No. 10", category: "Office", unit: "pcs", cost: 65, stock: 25, reorder: 10, reorderQty: 30, sup: 0 },
  { name: "Stapler pins No. 10", category: "Office", unit: "box", cost: 12, stock: 140, reorder: 50, reorderQty: 200, sup: 0 },
  { name: "Chalk sticks (white)", category: "Other", unit: "box", cost: 30, stock: 70, reorder: 40, reorderQty: 120, sup: 1 },
];

const SUPPLIERS = [
  { name: "Sri Lakshmi Stationers", contactPerson: "R. Venkatesan", phone: "9841012345", email: "orders@srilakshmistationers.in", address: "45, Ranganathan Street, T Nagar, Chennai 600017", gstin: "33AABFS1234K1Z5", factor: 1.0 },
  { name: "Chennai Paper Mart", contactPerson: "Fathima Begum", phone: "9840098765", email: "sales@chennaipapermart.com", address: "12, Broadway, Parrys Corner, Chennai 600001", gstin: "33AACCC5678L1Z2", factor: 0.95 },
  { name: "Kids Craft Supplies", contactPerson: "Arun Prakash", phone: "9789054321", email: "arun@kidscraft.in", address: "8, 2nd Avenue, Anna Nagar, Chennai 600040", gstin: "33AAKFK9012M1Z8", factor: 1.06 },
];

/** Demo data for the stationery module. Idempotent: skipped when the branch already has stationery items. */
export async function seed_stationery(ctx: SeedCtx) {
  const { branchId, users } = ctx;
  if (await db.stationeryItem.count({ where: { branchId } })) return;

  const store = users.store ?? ctx.adminId;
  const asStore = <T>(fn: () => Promise<T>) => runWithContext({ userId: store, userName: "Seed", branchId }, fn);
  const asUser = <T>(id: string, fn: () => Promise<T>) => runWithContext({ userId: id, userName: "Seed", branchId }, fn);

  await asStore(async () => {
    const sups: Awaited<ReturnType<typeof saveSupplier>>[] = [];
    for (const s of SUPPLIERS) {
      const { factor: _f, ...data } = s;
      sups.push(await saveSupplier(branchId, undefined, data));
    }
    // Items with opening stock; reorder qty and usual supplier. Some start below the reorder level.
    const items: Awaited<ReturnType<typeof createItem>>[] = [];
    for (const [i, it] of ITEMS.entries()) {
      items.push(await createItem(branchId, { code: `STN-${String(i + 1).padStart(4, "0")}`, name: it.name, category: it.category, unit: it.unit, unitCost: it.cost, reorderLevel: it.reorder, reorderQty: it.reorderQty, preferredSupplierId: sups[it.sup].id, openingStock: it.stock }));
    }
    // Make the generated-code counter continue after the seeded codes.
    await db.counter.upsert({ where: { key: `STNITEM-${branchId}` }, create: { key: `STNITEM-${branchId}`, value: ITEMS.length }, update: { value: ITEMS.length } });

    // Quotes from every supplier (differing prices) for price comparison.
    const ago = (d: number) => new Date(Date.now() - d * 86400000);
    for (const [i, item] of items.entries()) {
      for (const [k, s] of SUPPLIERS.entries()) {
        if ((i + k) % 4 === 3) continue; // not every supplier quotes every item
        const price = Math.round(ITEMS[i].cost * s.factor * (1 + (((i * 7 + k * 3) % 9) - 4) / 100) * 100) / 100;
        await addQuote(branchId, { supplierId: sups[k].id, itemId: item.id, price, effectiveDate: ago(60 - k * 5) });
      }
    }

    // Received purchases (stock in + price history).
    const byName = (n: string) => items.find((x) => x.name === n)!;
    await quickPurchase(branchId, { supplierId: sups[0].id, invoiceNo: "SLS/2026/1182", notes: "Term 2 notebooks", lines: [
      { itemId: byName("Long notebook 200 pages").id, qty: 300, unitPrice: 47 }, { itemId: byName("Long notebook 100 pages").id, qty: 300, unitPrice: 29.5 }, { itemId: byName("A4 copier paper 75 gsm").id, qty: 40, unitPrice: 255 },
    ] });
    await quickPurchase(branchId, { supplierId: sups[1].id, invoiceNo: "CPM-88213", lines: [
      { itemId: byName("Blue ball pen").id, qty: 500, unitPrice: 5.6 }, { itemId: byName("HB pencil").id, qty: 600, unitPrice: 4.6 }, { itemId: byName("Non-dust eraser").id, qty: 300, unitPrice: 3.8 },
    ] });
    await quickPurchase(branchId, { supplierId: sups[2].id, invoiceNo: "KCS-0457", lines: [
      { itemId: byName("Crayons (24 colours)").id, qty: 100, unitPrice: 46 }, { itemId: byName("Glue stick 15 g").id, qty: 120, unitPrice: 18.5 },
    ] });
    // An order sent and awaiting delivery.
    const open = await createPo(branchId, { supplierId: sups[0].id, notes: "Required before Annual Day", expectedDate: new Date(Date.now() + 7 * 86400000), lines: [
      { itemId: byName("Clear file folder (A4)").id, qty: 200, unitPrice: 14.5 }, { itemId: byName("Plastic ruler 30 cm").id, qty: 150, unitPrice: 9.5 },
    ] });
    await markPoOrdered(branchId, open.id);

    // Class 5 kit.
    const class5 = await db.schoolClass.findFirst({ where: { branchId, name: "Class 5" } });
    if (class5) {
      await saveKit(branchId, undefined, { name: "Class 5 kit 2026-27", classId: class5.id, lines: [
        { itemId: byName("Long notebook 200 pages").id, qty: 6 }, { itemId: byName("Long notebook 100 pages").id, qty: 4 }, { itemId: byName("HB pencil").id, qty: 4 },
        { itemId: byName("Non-dust eraser").id, qty: 2 }, { itemId: byName("Sharpener with container").id, qty: 1 }, { itemId: byName("Plastic ruler 30 cm").id, qty: 1 },
        { itemId: byName("Colour pencils (12 shades)").id, qty: 1 },
      ] });
    }

    // Budgets for the current year.
    const classes = await db.schoolClass.findMany({ where: { branchId }, orderBy: { grade: "asc" } });
    for (const c of classes) await saveBudget(branchId, { academicYearId: ctx.yearId, classId: c.id, amount: 6000 + Math.max(0, c.grade) * 1000 });
    const depts = await db.department.findMany({ where: { branchId } });
    for (const d of depts) await saveBudget(branchId, { academicYearId: ctx.yearId, departmentId: d.id, amount: d.name === "Office" ? 30000 : 12000 });

    // A few direct issues, a return and a damage write-off.
    const student = await db.student.findFirst({ where: { branchId, status: "ACTIVE", schoolClass: { name: "Class 3" } } });
    if (student) await recordMovement(branchId, { kind: "ISSUE", recipientType: "STUDENT", studentId: student.id, note: "Replacement notebook", lines: [{ itemId: byName("Long notebook 100 pages").id, qty: 2 }] });
    const office = depts.find((d) => d.name === "Office");
    if (office) await recordMovement(branchId, { kind: "ISSUE", recipientType: "DEPARTMENT", departmentId: office.id, note: "Office monthly supplies", lines: [{ itemId: byName("A4 copier paper 75 gsm").id, qty: 20 }, { itemId: byName("Stapler pins No. 10").id, qty: 10 }] });
    await recordMovement(branchId, { kind: "DAMAGE", note: "Water leak in store room", lines: [{ itemId: byName("Chart paper (white)").id, qty: 25 }] });
  });

  // Teacher requests in different states.
  const items = await db.stationeryItem.findMany({ where: { branchId } });
  const id = (n: string) => items.find((x) => x.name === n)!.id;
  const cls = async (n: string) => (await db.schoolClass.findFirst({ where: { branchId, name: n } }))?.id;
  const dept = async (n: string) => (await db.department.findFirst({ where: { branchId, name: n } }))?.id;
  const t1 = users.teacher1, t2 = users.teacher2, t3 = users.teacher3, t4 = users.teacher4;

  // Issued (approved in full).
  const r1 = await asUser(t1, async () => createRequest(branchId, t1, { classId: await cls("Class 5"), purpose: "Class 5A notebooks for term 2", lines: [{ itemId: id("Long notebook 200 pages"), qty: 50 }, { itemId: id("Blue ball pen"), qty: 30 }] }));
  await asStore(() => approveRequest(branchId, store, r1.id, { lines: [] }));
  await asStore(() => issueRequest(branchId, store, r1.id));
  // Partly approved and issued.
  const r2 = await asUser(t2, async () => createRequest(branchId, t2, { departmentId: await dept("Mathematics"), purpose: "Geometry practical", lines: [{ itemId: id("Geometry box"), qty: 25 }, { itemId: id("Graph notebook"), qty: 40 }] }));
  const r2full = await db.stationeryRequest.findUniqueOrThrow({ where: { id: r2.id }, include: { lines: true } });
  await asStore(() => approveRequest(branchId, store, r2.id, { lines: r2full.lines.map((l) => ({ lineId: l.id, qty: l.itemId === id("Geometry box") ? 10 : l.qtyRequested })), remarks: "Only 10 geometry boxes for now; more on order" }));
  await asStore(() => issueRequest(branchId, store, r2.id));
  // Approved, waiting to be issued.
  const r3 = await asUser(t3, async () => createRequest(branchId, t3, { departmentId: await dept("Languages"), purpose: "Chart work for Tamil day", lines: [{ itemId: id("Chart paper (white)"), qty: 40 }, { itemId: id("Whiteboard marker (assorted)"), qty: 10 }] }));
  await asStore(() => approveRequest(branchId, store, r3.id, { lines: [] }));
  // Rejected.
  const r4 = await asUser(t4, async () => createRequest(branchId, t4, { departmentId: await dept("Computer Science"), purpose: "Lab files", lines: [{ itemId: id("Box file"), qty: 30 }] }));
  await asStore(() => rejectRequest(branchId, store, r4.id, "Box files are issued to the office only; please use clear folders."));
  // Pending (one older than two days, for the reminder automation).
  const r5 = await asUser(t1, async () => createRequest(branchId, t1, { classId: await cls("Class 5"), purpose: "Craft activity", lines: [{ itemId: id("Glue stick 15 g"), qty: 20 }, { itemId: id("Scissors (child safe)"), qty: 10 }, { itemId: id("Crayons (24 colours)"), qty: 20 }] }));
  await db.stationeryRequest.update({ where: { id: r5.id }, data: { createdAt: new Date(Date.now() - 3 * 86400000) } });
  await asUser(t2, async () => createRequest(branchId, t2, { classId: await cls("Class 8"), purpose: "Class 8B record notebooks", lines: [{ itemId: id("Long notebook 100 pages"), qty: 45 }, { itemId: id("Red ball pen"), qty: 45 }] }));

  console.log(`  stationery: ${ITEMS.length} items, ${SUPPLIERS.length} suppliers, requests, kit, budgets`);
}
