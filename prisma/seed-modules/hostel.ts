import type { SeedCtx } from "../seed";
import { db } from "../../src/lib/db";
import { addDays, today } from "../../src/lib/format";
import { addRooms, allocateBed, createOutpass, markReturned, saveHostel, saveRollCall } from "../../src/server/hostel/service";

/** Demo hostels (idempotent: runs only when the branch has no hostels). */
export async function seed_hostel(ctx: SeedCtx) {
  if ((await db.hostel.count({ where: { branchId: ctx.branchId } })) > 0) return;
  const boys = await saveHostel(ctx.branchId, { name: "Kaveri Boys Hostel", type: "BOYS", wardenName: "Arul Prakasam", phone: "9000000007", feePerTerm: 15000 });
  const girls = await saveHostel(ctx.branchId, { name: "Vaigai Girls Hostel", type: "GIRLS", wardenName: "Mary Selvi", phone: "9000000008", feePerTerm: 15000 });
  await addRooms(ctx.branchId, { hostelId: boys.id, from: 101, to: 106, floor: "1", capacity: 4, roomType: "4-bed non-AC" });
  await addRooms(ctx.branchId, { hostelId: girls.id, from: 201, to: 205, floor: "2", capacity: 4, roomType: "4-bed non-AC" });
  const ac = await db.hostelRoom.findFirstOrThrow({ where: { hostelId: boys.id, roomNo: "106" } });
  await db.hostelRoom.update({ where: { id: ac.id }, data: { roomType: "2-bed AC", capacity: 2, feePerTerm: 22000 } });

  const pick = (gender: "MALE" | "FEMALE") => db.student.findMany({ where: { branchId: ctx.branchId, status: "ACTIVE", gender, schoolClass: { grade: { gte: 6 } } }, take: 9, orderBy: { admissionNo: "desc" } });
  const [b, g] = await Promise.all([pick("MALE"), pick("FEMALE")]);
  const boysRooms = await db.hostelRoom.findMany({ where: { hostelId: boys.id }, orderBy: { roomNo: "asc" } });
  const girlsRooms = await db.hostelRoom.findMany({ where: { hostelId: girls.id }, orderBy: { roomNo: "asc" } });
  const start = addDays(today(), -120);
  for (const [i, s] of b.entries()) await allocateBed(ctx.branchId, { studentId: s.id, roomId: boysRooms[Math.floor(i / 4)].id, bedNo: String((i % 4) + 1), startDate: start });
  for (const [i, s] of g.entries()) await allocateBed(ctx.branchId, { studentId: s.id, roomId: girlsRooms[Math.floor(i / 4)].id, bedNo: String((i % 4) + 1), startDate: start });

  // Outpasses: one returned, one out now, one late back.
  const by = "Arul Prakasam";
  if (b[0]) { const p = await createOutpass(ctx.branchId, by, { studentId: b[0].id, outAt: addDays(new Date(), -6), expectedReturn: addDays(new Date(), -4), reason: "Home visit for the weekend", escortName: "Father" }); await markReturned(ctx.branchId, p.id); }
  if (b[1]) await createOutpass(ctx.branchId, by, { studentId: b[1].id, expectedReturn: addDays(new Date(), 1), reason: "Family function", escortName: "Mother" });
  if (g[0]) await createOutpass(ctx.branchId, "Mary Selvi", { studentId: g[0].id, outAt: addDays(new Date(), -3), expectedReturn: addDays(new Date(), -1), reason: "Medical appointment", escortName: "Father" });

  // Last night's roll call in the boys' hostel: one absent.
  const residents = await db.hostelAllocation.findMany({ where: { status: "ACTIVE", room: { hostelId: boys.id } }, select: { studentId: true } });
  await saveRollCall(ctx.branchId, by, { hostelId: boys.id, date: addDays(today(), -1), session: "NIGHT", entries: residents.map((r, i) => ({ studentId: r.studentId, status: r.studentId === b[1]?.id ? "ON_LEAVE" : i === 3 ? "ABSENT" : "PRESENT" })) });
}
