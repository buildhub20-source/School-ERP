import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/format";
import { depreciation, disposeAsset, logRepair, moveAsset, saveAsset, setAssetStatus, verifyAsset, assetWarrantyAlerts } from "@/server/assets/service";
import { asUser, testCtx, uniq } from "./helpers";

let ctx: Awaited<ReturnType<typeof testCtx>>;
const ids: string[] = [];
beforeAll(async () => { ctx = await testCtx(); });
afterAll(async () => { await db.asset.deleteMany({ where: { id: { in: ids } } }); });

describe("asset depreciation", () => {
  it("is straight line from the purchase date and stops at the salvage value", () => {
    const base = { cost: 50000, salvageValue: 5000, usefulLifeYears: 5 } as never;
    const bought = new Date("2024-01-01T00:00:00Z");
    const d1 = depreciation({ ...(base as object), purchaseDate: bought } as never, new Date("2025-01-01T00:00:00Z"));
    expect(d1.annual).toBe(9000);
    expect(d1.bookValue).toBeCloseTo(41000, -2);
    const d10 = depreciation({ ...(base as object), purchaseDate: bought } as never, new Date("2034-01-01T00:00:00Z"));
    expect(d10.bookValue).toBe(5000);
    expect(d10.fullyDepreciated).toBe(true);
    expect(depreciation({ ...(base as object), purchaseDate: null } as never).bookValue).toBe(50000);
  });
});

describe("asset register", () => {
  it("adds identical assets with consecutive codes and records their history", async () => {
    const made = await asUser(ctx.adminId, () => saveAsset(ctx.branchId, "Test", { name: uniq("Chair "), category: "Furniture", location: "Room 1", cost: 1000, usefulLifeYears: 10, salvageValue: 0, condition: "NEW" }, 3));
    ids.push(...made.map((a) => a.id));
    const nums = made.map((a) => Number(a.code.slice(4)));
    expect(nums[1] - nums[0]).toBe(1);
    expect(nums[2] - nums[1]).toBe(1);
    const a = made[0];
    await asUser(ctx.adminId, () => moveAsset(ctx.branchId, "Test", a.id, { location: "Room 2", assignedTo: "Office" }));
    await asUser(ctx.adminId, () => logRepair(ctx.branchId, "Test", a.id, { notes: "Leg fixed", cost: 150, status: "UNDER_REPAIR" }));
    await asUser(ctx.adminId, () => setAssetStatus(ctx.branchId, "Test", a.id, "LOST", "Not found in room 2"));
    // Seen again during verification: back in use, at its new place
    const v = await asUser(ctx.adminId, () => verifyAsset(ctx.branchId, "Test", { code: a.code.toLowerCase() }, { location: "Room 3" }));
    expect(v.status).toBe("IN_USE");
    expect(v.location).toBe("Room 3");
    expect(v.lastVerifiedAt).not.toBeNull();
    const events = await db.assetEvent.findMany({ where: { assetId: a.id }, orderBy: { date: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["CREATED", "MOVED", "REPAIR", "STATUS", "VERIFIED"]);
  });

  it("disposal needs a reason and locks the asset", async () => {
    const id = ids[1];
    await expect(disposeAsset(ctx.branchId, "Test", id, { date: today(), value: 100, reason: " " })).rejects.toThrow(/reason/);
    await asUser(ctx.adminId, () => disposeAsset(ctx.branchId, "Test", id, { date: today(), value: 100, reason: "Scrapped" }));
    await expect(moveAsset(ctx.branchId, "Test", id, { location: "X" })).rejects.toThrow(/disposed/);
    await expect(verifyAsset(ctx.branchId, "Test", { id })).rejects.toThrow(/disposed/);
  });

  it("alerts once when a warranty is about to end", async () => {
    const [a] = await asUser(ctx.adminId, () => saveAsset(ctx.branchId, "Test", { name: uniq("Printer "), category: "Office equipment", cost: 9000, usefulLifeYears: 5, salvageValue: 0, condition: "NEW", warrantyUntil: addDays(today(), 10) }));
    ids.push(a.id);
    await assetWarrantyAlerts({ daysBefore: 30 });
    expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).warrantyAlertAt).not.toBeNull();
    expect(await assetWarrantyAlerts({ daysBefore: 30 })).not.toMatch(/^[1-9]/);
  });
});
