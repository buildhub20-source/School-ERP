import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { addDays, today, toNum } from "@/lib/format";
import { allocateBed, changeRoom, createOutpass, markReturned, saveHostel, saveRollCall, saveRoom, vacate, hostelOverdueReturns } from "@/server/hostel/service";
import { asUser, testCtx, uniq } from "./helpers";

let ctx: Awaited<ReturnType<typeof testCtx>>;
let hostelId: string, roomA: string, roomB: string;
let boys: { id: string }[];
let girl: { id: string };

beforeAll(async () => {
  ctx = await testCtx();
  const h = await asUser(ctx.adminId, () => saveHostel(ctx.branchId, { name: uniq("Test hostel "), type: "BOYS", feePerTerm: 10000 }));
  hostelId = h.id;
  roomA = (await asUser(ctx.adminId, () => saveRoom(ctx.branchId, { hostelId, roomNo: "T1", capacity: 1 }))).id;
  roomB = (await asUser(ctx.adminId, () => saveRoom(ctx.branchId, { hostelId, roomNo: "T2", capacity: 2, feePerTerm: 12000 }))).id;
  boys = await db.student.findMany({ where: { branchId: ctx.branchId, status: "ACTIVE", gender: "MALE", hostelAllocations: { none: { status: "ACTIVE" } } }, take: 2 });
  girl = await db.student.findFirstOrThrow({ where: { branchId: ctx.branchId, status: "ACTIVE", gender: "FEMALE", hostelAllocations: { none: { status: "ACTIVE" } } } });
});

afterAll(async () => {
  const allocs = await db.hostelAllocation.findMany({ where: { room: { hostelId } } });
  await db.studentFee.deleteMany({ where: { hostelAllocationId: { in: allocs.map((a) => a.id) } } });
  await db.hostelOutpass.deleteMany({ where: { studentId: { in: boys.map((b) => b.id) } } });
  await db.hostelRollCall.deleteMany({ where: { hostelId } });
  await db.hostelAllocation.deleteMany({ where: { room: { hostelId } } });
  await db.hostel.delete({ where: { id: hostelId } });
});

describe("hostel allocation", () => {
  it("checks gender and capacity and bills each remaining term", async () => {
    await expect(allocateBed(ctx.branchId, { studentId: girl.id, roomId: roomA })).rejects.toThrow(/boys hostel/);
    const r = await asUser(ctx.adminId, () => allocateBed(ctx.branchId, { studentId: boys[0].id, roomId: roomA }));
    const fees = await db.studentFee.findMany({ where: { hostelAllocationId: r.allocation.id } });
    expect(fees.length).toBe(r.fees);
    expect(fees.every((f) => f.source === "HOSTEL" && toNum(f.amount) === 10000)).toBe(true);
    await expect(allocateBed(ctx.branchId, { studentId: boys[1].id, roomId: roomA })).rejects.toThrow(/full/);
    await expect(allocateBed(ctx.branchId, { studentId: boys[0].id, roomId: roomB })).rejects.toThrow(/already stays/);
  });

  it("moves rooms and cancels unpaid future term fees on leaving", async () => {
    const a = await db.hostelAllocation.findFirstOrThrow({ where: { studentId: boys[0].id, status: "ACTIVE" } });
    await asUser(ctx.adminId, () => changeRoom(ctx.branchId, a.id, roomB, "1"));
    expect((await db.hostelAllocation.findUniqueOrThrow({ where: { id: a.id } })).roomId).toBe(roomB);
    const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true }, include: { terms: { orderBy: { sequence: "asc" } } } });
    const r = await asUser(ctx.adminId, () => vacate(ctx.branchId, a.id, today()));
    const future = year.terms.filter((t) => t.startDate > today()).length;
    expect(r.cancelledFees).toBe(future);
    expect((await db.hostelAllocation.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ENDED");
  });
});

describe("outpasses and roll call", () => {
  it("only residents get an outpass; late returns alert once", async () => {
    await expect(createOutpass(ctx.branchId, "Test", { studentId: boys[1].id, expectedReturn: addDays(new Date(), 1), reason: "Home" })).rejects.toThrow(/residents/);
    await asUser(ctx.adminId, () => allocateBed(ctx.branchId, { studentId: boys[1].id, roomId: roomA }));
    const p = await asUser(ctx.adminId, () => createOutpass(ctx.branchId, "Test", { studentId: boys[1].id, outAt: addDays(new Date(), -2), expectedReturn: addDays(new Date(), -1), reason: "Home visit" }));
    await expect(createOutpass(ctx.branchId, "Test", { studentId: boys[1].id, expectedReturn: addDays(new Date(), 1), reason: "Again" })).rejects.toThrow(/already out/);
    await hostelOverdueReturns();
    expect((await db.hostelOutpass.findUniqueOrThrow({ where: { id: p.id } })).lateAlertedAt).not.toBeNull();
    await asUser(ctx.adminId, () => markReturned(ctx.branchId, p.id));
    await expect(markReturned(ctx.branchId, p.id)).rejects.toThrow(/Already/);
  });

  it("saves a roll call for residents only, and re-saving updates it", async () => {
    const date = today();
    const r1 = await asUser(ctx.adminId, () => saveRollCall(ctx.branchId, "Test", { hostelId, date, session: "NIGHT", entries: [{ studentId: boys[1].id, status: "ABSENT" }, { studentId: girl.id, status: "PRESENT" }] }));
    expect(r1).toEqual({ marked: 1, absent: 1 });
    await asUser(ctx.adminId, () => saveRollCall(ctx.branchId, "Test", { hostelId, date, session: "NIGHT", entries: [{ studentId: boys[1].id, status: "PRESENT" }] }));
    const rows = await db.hostelRollCall.findMany({ where: { hostelId, date } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PRESENT");
  });
});
