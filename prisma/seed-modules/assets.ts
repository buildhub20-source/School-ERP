import type { SeedCtx } from "../seed";
import { db } from "../../src/lib/db";
import { addDays, today } from "../../src/lib/format";
import { disposeAsset, logRepair, saveAsset, verifyAsset } from "../../src/server/assets/service";

/** Demo asset register (idempotent: runs only when the branch has no assets). */
const ASSETS: [name: string, category: string, location: string, assignedTo: string, cost: number, life: number, salvage: number, qty: number, boughtDaysAgo: number, warrantyDays: number | null, brand?: string][] = [
  ["Desktop computer (i5, 8 GB)", "Computers & IT", "Computer Lab 1", "Joseph Antony", 42000, 5, 4000, 6, 700, 395, "Dell"],
  ["Laptop for staff room", "Computers & IT", "Staff room", "Office", 55000, 4, 5000, 2, 300, 20, "Lenovo"],
  ["Laser printer", "Office equipment", "Office", "Rekha Srinivasan", 18500, 5, 1500, 1, 900, null, "HP"],
  ["Projector (3500 lumens)", "Projectors & AV", "Class 8 A", "Class teacher", 38000, 6, 3000, 3, 500, 230, "Epson"],
  ["Interactive smart board", "Projectors & AV", "Class 10 A", "Class teacher", 125000, 7, 10000, 1, 120, 610, "BenQ"],
  ["Student desk & bench (double)", "Furniture", "Class 5 A", "Class teacher", 4800, 10, 300, 20, 1400, null],
  ["Steel almirah", "Furniture", "Office", "Office", 14500, 15, 1000, 3, 2000, null, "Godrej"],
  ["Compound microscope", "Lab equipment", "Science Lab", "Anitha Raman", 9500, 10, 500, 8, 800, null],
  ["Fire extinguisher (ABC, 6 kg)", "Electrical & appliances", "Corridor", "Office", 3200, 5, 0, 6, 200, 165],
  ["RO water purifier", "Kitchen & canteen", "Canteen", "Canteen", 26000, 6, 2000, 2, 650, 80, "Kent"],
  ["Keyboard (61 keys)", "Musical instruments", "Music room", "Music teacher", 11500, 8, 800, 1, 1000, null, "Yamaha"],
  ["Cricket kit", "Sports equipment", "Sports room", "PE teacher", 8500, 3, 0, 2, 400, null],
];

export async function seed_assets(ctx: SeedCtx) {
  if ((await db.asset.count({ where: { branchId: ctx.branchId } })) > 0) return;
  const by = "Murali Krishnan";
  const made: { id: string; category: string }[] = [];
  for (const [name, category, location, assignedTo, cost, life, salvage, qty, ago, warrantyDays, brand] of ASSETS) {
    const list = await saveAsset(ctx.branchId, by, {
      name, category, location, assignedTo, brand, purchaseDate: addDays(today(), -ago), cost, usefulLifeYears: life, salvageValue: salvage,
      warrantyUntil: warrantyDays ? addDays(today(), warrantyDays) : undefined, condition: ago < 365 ? "NEW" : "GOOD", supplierName: brand ? `${brand} authorised dealer` : undefined,
    }, qty);
    made.push(...list.map((a) => ({ id: a.id, category })));
  }
  // Most assets were verified last term; a few not yet.
  for (const a of made.slice(0, Math.floor(made.length * 0.7))) await verifyAsset(ctx.branchId, by, { id: a.id });
  const pc = made.find((a) => a.category === "Computers & IT");
  if (pc) await logRepair(ctx.branchId, by, pc.id, { notes: "Hard disk failure — sent to dealer", cost: 3200, status: "UNDER_REPAIR", condition: "FAIR" });
  const desk = made.filter((a) => a.category === "Furniture")[0];
  if (desk) await disposeAsset(ctx.branchId, by, desk.id, { date: addDays(today(), -30), value: 300, reason: "Broken beyond repair, sold as scrap" });
}
