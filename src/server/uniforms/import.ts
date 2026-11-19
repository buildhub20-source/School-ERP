import "server-only";
import type { UniformCategory, UniformGender } from "@prisma/client";
import { db } from "@/lib/db";
import { readSheet } from "@/lib/excel";
import { moveStock } from "./core";
import { CATEGORIES, CATEGORY_LABELS } from "./labels";

type Row = { item: string; category: UniformCategory; gender: UniformGender; size: string; sizeOrder?: number; price: number; stock: number; reorderLevel: number; sku?: string };

function parseCategory(s: string): UniformCategory | null {
  const k = s.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((CATEGORIES as readonly string[]).includes(k)) return k as UniformCategory;
  const byLabel = Object.entries(CATEGORY_LABELS).find(([, l]) => l.toLowerCase() === s.trim().toLowerCase() || l.toLowerCase() + "s" === s.trim().toLowerCase());
  if (byLabel) return byLabel[0] as UniformCategory;
  if (k === "PANTS" || k === "TROUSER" || k === "TROUSERS") return "PANT";
  if (k === "SKIRTS") return "SKIRT";
  return null;
}
function parseGender(s: string): UniformGender | null {
  const k = s.trim().toLowerCase();
  if (!k || ["unisex", "all", "u", "both"].includes(k)) return "UNISEX";
  if (["boy", "boys", "b", "m", "male"].includes(k)) return "BOY";
  if (["girl", "girls", "g", "f", "female"].includes(k)) return "GIRL";
  return null;
}
const num = (s: string | undefined) => (s === undefined || s === "" ? undefined : Number(s.replace(/,/g, "")));

/**
 * Bulk import uniform items, sizes and stock. Items are matched by name + gender, sizes by item + size.
 * New sizes get the stock as opening stock; for existing sizes the stock count replaces the current count (adjustment).
 */
export async function importUniforms(branchId: string, data: ArrayBuffer, dryRun: boolean, userId?: string) {
  const raw = await readSheet(data);
  const errors: { row: number; message: string }[] = [];
  const rows: { row: number; r: Row }[] = [];
  const seen = new Set<string>();
  raw.forEach((x, i) => {
    const rowNo = i + 2;
    const errs: string[] = [];
    const item = (x.item ?? "").trim();
    const size = (x.size ?? "").trim();
    const category = parseCategory(x.category ?? "");
    const gender = parseGender(x.gender ?? "");
    const price = num(x.price);
    const stock = num(x.stock) ?? 0;
    const reorderLevel = num(x.reorderlevel) ?? 0;
    const sizeOrder = num(x.sizeorder);
    if (!item) errs.push("Item is required");
    if (!size) errs.push("Size is required");
    if (size.length > 20) errs.push("Size is too long");
    if (!category) errs.push(`Category “${x.category ?? ""}” is not valid (use ${Object.values(CATEGORY_LABELS).join(", ")})`);
    if (!gender) errs.push(`Gender “${x.gender}” is not valid (Boy, Girl or Unisex)`);
    if (price === undefined || !Number.isFinite(price) || price < 0) errs.push("Price must be a number of 0 or more");
    if (!Number.isInteger(stock) || stock < 0) errs.push("Stock must be a whole number of 0 or more");
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) errs.push("Reorder level must be a whole number of 0 or more");
    if (sizeOrder !== undefined && !Number.isInteger(sizeOrder)) errs.push("Size order must be a whole number");
    const key = `${item.toLowerCase()}|${gender}|${size.toLowerCase()}`;
    if (seen.has(key)) errs.push("This item and size appears twice in the file");
    seen.add(key);
    if (errs.length) errors.push({ row: rowNo, message: errs.join("; ") });
    else rows.push({ row: rowNo, r: { item, category: category!, gender: gender!, size, sizeOrder, price: price!, stock, reorderLevel, sku: x.sku || undefined } });
  });

  // SKU clashes with other sizes
  const skus = rows.map((x) => x.r.sku).filter(Boolean) as string[];
  if (skus.length) {
    const existing = await db.uniformVariant.findMany({ where: { sku: { in: skus } }, include: { item: true } });
    for (const x of rows) {
      const clash = existing.find((e) => e.sku === x.r.sku && !(e.item.name.toLowerCase() === x.r.item.toLowerCase() && e.item.gender === x.r.gender && e.size.toLowerCase() === x.r.size.toLowerCase()));
      if (clash) errors.push({ row: x.row, message: `SKU ${x.r.sku} is already used by ${clash.item.name} size ${clash.size}` });
    }
  }
  const bad = new Set(errors.map((e) => e.row));
  const valid = rows.filter((x) => !bad.has(x.row));
  if (dryRun || errors.length) return { total: raw.length, ok: valid.length, errors: errors.sort((a, b) => a.row - b.row), dryRun: true };

  await db.$transaction(async (tx) => {
    const items = new Map<string, string>();
    for (const { r } of valid) {
      const k = `${r.item.toLowerCase()}|${r.gender}`;
      let itemId = items.get(k);
      if (!itemId) {
        const found = await tx.uniformItem.findFirst({ where: { branchId, name: { equals: r.item, mode: "insensitive" }, gender: r.gender } });
        itemId = found ? found.id : (await tx.uniformItem.create({ data: { branchId, name: r.item, category: r.category, gender: r.gender } })).id;
        if (found && found.category !== r.category) await tx.uniformItem.update({ where: { id: found.id }, data: { category: r.category } });
        items.set(k, itemId);
      }
      const v = await tx.uniformVariant.findFirst({ where: { itemId, size: { equals: r.size, mode: "insensitive" } } });
      if (v) {
        await tx.uniformVariant.update({ where: { id: v.id }, data: { price: r.price, reorderLevel: r.reorderLevel, ...(r.sizeOrder !== undefined ? { sizeOrder: r.sizeOrder } : {}), ...(r.sku ? { sku: r.sku } : {}), isActive: true } });
        if (r.stock !== v.stock) await moveStock(tx, { variantId: v.id, qty: r.stock - v.stock, type: "ADJUSTMENT", note: "Excel import (stock count)", userId });
      } else {
        const max = await tx.uniformVariant.aggregate({ where: { itemId }, _max: { sizeOrder: true } });
        const nv = await tx.uniformVariant.create({ data: { itemId, size: r.size, sizeOrder: r.sizeOrder ?? (max._max.sizeOrder ?? 0) + 10, price: r.price, reorderLevel: r.reorderLevel, sku: r.sku } });
        if (r.stock > 0) await moveStock(tx, { variantId: nv.id, qty: r.stock, type: "OPENING", note: "Excel import", userId });
      }
    }
  }, { timeout: 120000, maxWait: 10000 });
  return { total: raw.length, ok: valid.length, errors: [], dryRun: false };
}
