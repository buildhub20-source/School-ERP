import "server-only";
import { db } from "@/lib/db";
import { readSheet } from "@/lib/excel";
import { AppError } from "@/lib/errors";
import { CATEGORIES } from "./core";
import { createItem } from "./service";

export type ImportResult = { total: number; ok: number; errors: { row: number; message: string }[]; dryRun: boolean };

const num = (s: string | undefined, label: string, allowDecimal = false) => {
  if (s === undefined || s === "") return 0;
  const n = Number(s.replace(/,/g, ""));
  if (!isFinite(n) || n < 0 || (!allowDecimal && !Number.isInteger(n))) throw new Error(`${label} must be a ${allowDecimal ? "number" : "whole number"}, 0 or more`);
  return n;
};

/** Bulk import of items + opening stock. Existing codes are rejected; unknown suppliers are created on import. */
export async function importStationery(branchId: string, data: ArrayBuffer, dryRun: boolean): Promise<ImportResult> {
  const rows = await readSheet(data);
  const errors: ImportResult["errors"] = [];
  const suppliers = await db.supplier.findMany({ where: { branchId } });
  const existing = new Set((await db.stationeryItem.findMany({ where: { branchId }, select: { code: true, name: true } })).flatMap((i) => [`c:${i.code.toUpperCase()}`, `n:${i.name.toLowerCase()}`]));
  const seen = new Set<string>();
  let ok = 0;
  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2;
    try {
      const name = (r.name ?? "").trim();
      if (!name) throw new Error("Name is required");
      const code = (r.code ?? "").trim().toUpperCase();
      if (code && (existing.has(`c:${code}`) || seen.has(`c:${code}`))) throw new Error(`Code ${code} already exists`);
      if (existing.has(`n:${name.toLowerCase()}`) || seen.has(`n:${name.toLowerCase()}`)) throw new Error(`An item named “${name}” already exists`);
      const cat = CATEGORIES.find((c) => c.toLowerCase() === (r.category ?? "").trim().toLowerCase()) ?? ((r.category ?? "").trim() || "Other");
      const input = {
        code: code || undefined, name, category: cat, unit: (r.unit ?? "").trim() || "pcs",
        openingStock: num(r.openingstock, "Opening Stock"), unitCost: num(r.unitcost, "Unit Cost", true),
        reorderLevel: num(r.reorderlevel, "Reorder Level"), reorderQty: num(r.reorderqty, "Reorder Qty"),
      };
      if (code) seen.add(`c:${code}`);
      seen.add(`n:${name.toLowerCase()}`);
      if (!dryRun) {
        let preferredSupplierId: string | undefined;
        const sname = (r.supplier ?? "").trim();
        if (sname) {
          let s = suppliers.find((x) => x.name.toLowerCase() === sname.toLowerCase());
          if (!s) {
            s = await db.supplier.create({ data: { branchId, name: sname, supplies: ["STATIONERY"] } });
            suppliers.push(s);
          }
          preferredSupplierId = s.id;
        }
        await createItem(branchId, { ...input, preferredSupplierId });
      }
      ok++;
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof AppError || e instanceof Error ? e.message : "Invalid row" });
    }
  }
  return { total: rows.length, ok, errors, dryRun };
}
