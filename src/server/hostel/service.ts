import "server-only";
import type { HostelType } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { currentAcademicYear } from "@/lib/settings";
import { isAutomationEnabled } from "@/lib/automations/config";
import { fmtDateTime, fullName, today, toNum } from "@/lib/format";
import { createFeeLine, recalcFee } from "@/server/fees/core";
import { notifyGuardians, notifyPermission } from "@/lib/messaging/notify";

export const TYPE_LABEL: Record<HostelType, string> = { BOYS: "Boys", GIRLS: "Girls", MIXED: "Boys & girls" };

/* ───────────── hostels & rooms ───────────── */

export async function saveHostel(branchId: string, input: { id?: string; name: string; type: HostelType; wardenName?: string; phone?: string; feePerTerm: number; notes?: string; isActive?: boolean }) {
  const data = { name: input.name, type: input.type, wardenName: input.wardenName ?? null, phone: input.phone ?? null, feePerTerm: input.feePerTerm, notes: input.notes ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  if (input.id) {
    const h = await db.hostel.findFirst({ where: { id: input.id, branchId } });
    if (!h) throw new AppError("Hostel not found.");
    return db.hostel.update({ where: { id: h.id }, data });
  }
  return db.hostel.create({ data: { ...data, branchId } });
}

export async function saveRoom(branchId: string, input: { id?: string; hostelId: string; roomNo: string; floor?: string; capacity: number; roomType?: string; feePerTerm?: number; isActive?: boolean }) {
  const hostel = await db.hostel.findFirst({ where: { id: input.hostelId, branchId } });
  if (!hostel) throw new AppError("Hostel not found.");
  const data = { roomNo: input.roomNo, floor: input.floor ?? null, capacity: input.capacity, roomType: input.roomType ?? null, feePerTerm: input.feePerTerm ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  if (input.id) {
    const room = await db.hostelRoom.findFirst({ where: { id: input.id, hostelId: hostel.id }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } });
    if (!room) throw new AppError("Room not found.");
    if (input.capacity < room._count.allocations) throw new AppError(`${room._count.allocations} students live in this room; the capacity cannot be lower.`);
    return db.hostelRoom.update({ where: { id: room.id }, data });
  }
  return db.hostelRoom.create({ data: { ...data, hostelId: hostel.id } });
}

/** Add rooms 101…110 in one go (same floor, capacity and type). */
export async function addRooms(branchId: string, input: { hostelId: string; from: number; to: number; prefix?: string; floor?: string; capacity: number; roomType?: string }) {
  if (input.to < input.from || input.to - input.from > 99) throw new AppError("Add between 1 and 100 rooms at a time.");
  const hostel = await db.hostel.findFirst({ where: { id: input.hostelId, branchId } });
  if (!hostel) throw new AppError("Hostel not found.");
  const existing = new Set((await db.hostelRoom.findMany({ where: { hostelId: hostel.id }, select: { roomNo: true } })).map((r) => r.roomNo));
  let n = 0;
  for (let i = input.from; i <= input.to; i++) {
    const roomNo = `${input.prefix ?? ""}${i}`;
    if (existing.has(roomNo)) continue;
    await db.hostelRoom.create({ data: { hostelId: hostel.id, roomNo, floor: input.floor ?? null, capacity: input.capacity, roomType: input.roomType ?? null } });
    n++;
  }
  return n;
}

/* ───────────── allocation & fees ───────────── */

async function hostelFeeHead(client: DbOrTx, branchId: string) {
  return client.feeHead.upsert({ where: { branchId_name: { branchId, name: "Hostel fee" } }, create: { branchId, name: "Hostel fee", type: "OTHER" }, update: {} });
}

/** Hostel fee for each term of the year that the stay touches (room fee overrides the hostel fee). Idempotent. */
export async function createHostelFees(client: DbOrTx, allocationId: string) {
  if (!(await isAutomationEnabled("hostel.feeOnAllocate"))) return 0;
  const a = await client.hostelAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { room: { include: { hostel: true } } } });
  const year = await client.academicYear.findUniqueOrThrow({ where: { id: a.academicYearId }, include: { terms: { orderBy: { sequence: "asc" } } } });
  const fee = toNum(a.room.feePerTerm ?? a.room.hostel.feePerTerm);
  if (fee <= 0) return 0;
  const head = await hostelFeeHead(client, a.branchId);
  const existing = await client.studentFee.findMany({ where: { hostelAllocationId: a.id, status: { not: "CANCELLED" } }, select: { termId: true } });
  const have = new Set(existing.map((e) => e.termId));
  let n = 0;
  for (const t of year.terms) {
    if (t.endDate < a.startDate || have.has(t.id)) continue;
    const due = t.startDate > a.startDate ? t.startDate : a.startDate;
    const line = await createFeeLine(client, { studentId: a.studentId, academicYearId: a.academicYearId, termId: t.id, feeHeadId: head.id, description: `Hostel — ${a.room.hostel.name} room ${a.room.roomNo} — ${t.name}`, amount: fee, dueDate: due, source: "HOSTEL" });
    await client.studentFee.update({ where: { id: line.id }, data: { hostelAllocationId: a.id } });
    n++;
  }
  return n;
}

async function occupied(client: DbOrTx, roomId: string) {
  return client.hostelAllocation.count({ where: { roomId, status: "ACTIVE" } });
}

export async function allocateBed(branchId: string, input: { studentId: string; roomId: string; bedNo?: string; startDate?: Date; notes?: string }) {
  const year = await currentAcademicYear();
  if (!year) throw new AppError("Set the current academic year first (Settings → Years & classes).");
  return db.$transaction(async (tx) => {
    const room = await tx.hostelRoom.findFirst({ where: { id: input.roomId, isActive: true, hostel: { branchId, isActive: true } }, include: { hostel: true } });
    if (!room) throw new AppError("Room not found.");
    await tx.$queryRaw`SELECT id FROM "HostelRoom" WHERE id = ${room.id} FOR UPDATE`;
    const student = await tx.student.findFirst({ where: { id: input.studentId, branchId } });
    if (!student) throw new AppError("Student not found.");
    if (student.status !== "ACTIVE") throw new AppError(`${fullName(student)} is not an active student.`);
    if ((room.hostel.type === "BOYS" && student.gender === "FEMALE") || (room.hostel.type === "GIRLS" && student.gender === "MALE")) throw new AppError(`${room.hostel.name} is a ${TYPE_LABEL[room.hostel.type].toLowerCase()} hostel.`);
    const current = await tx.hostelAllocation.findFirst({ where: { studentId: student.id, status: "ACTIVE" }, include: { room: { include: { hostel: true } } } });
    if (current) throw new AppError(`${fullName(student)} already stays in ${current.room.hostel.name} room ${current.room.roomNo}. Use “Change room”.`);
    if ((await occupied(tx, room.id)) >= room.capacity) throw new AppError(`Room ${room.roomNo} is full (${room.capacity} beds).`);
    const a = await tx.hostelAllocation.create({ data: { branchId, studentId: student.id, roomId: room.id, bedNo: input.bedNo ?? null, academicYearId: year.id, startDate: input.startDate ?? today(), notes: input.notes ?? null } });
    const fees = await createHostelFees(tx, a.id);
    return { allocation: a, fees, who: fullName(student), room: `${room.hostel.name} room ${room.roomNo}` };
  });
}

export async function changeRoom(branchId: string, allocationId: string, roomId: string, bedNo?: string) {
  return db.$transaction(async (tx) => {
    const a = await tx.hostelAllocation.findFirst({ where: { id: allocationId, branchId, status: "ACTIVE" }, include: { student: true } });
    if (!a) throw new AppError("This student is not staying in the hostel.");
    if (a.roomId === roomId) throw new AppError("That is the current room.");
    const room = await tx.hostelRoom.findFirst({ where: { id: roomId, isActive: true, hostel: { branchId, isActive: true } }, include: { hostel: true } });
    if (!room) throw new AppError("Room not found.");
    await tx.$queryRaw`SELECT id FROM "HostelRoom" WHERE id = ${room.id} FOR UPDATE`;
    if ((room.hostel.type === "BOYS" && a.student.gender === "FEMALE") || (room.hostel.type === "GIRLS" && a.student.gender === "MALE")) throw new AppError(`${room.hostel.name} is a ${TYPE_LABEL[room.hostel.type].toLowerCase()} hostel.`);
    if ((await occupied(tx, room.id)) >= room.capacity) throw new AppError(`Room ${room.roomNo} is full.`);
    return tx.hostelAllocation.update({ where: { id: a.id }, data: { roomId: room.id, bedNo: bedNo ?? null } });
  });
}

/** Leave the hostel: frees the bed and cancels unpaid hostel fees for terms that start after the leaving date. */
export async function vacate(branchId: string, allocationId: string, endDate: Date) {
  return db.$transaction(async (tx) => {
    const a = await tx.hostelAllocation.findFirst({ where: { id: allocationId, branchId, status: "ACTIVE" } });
    if (!a) throw new AppError("This student is not staying in the hostel.");
    if (endDate < a.startDate) throw new AppError("The leaving date is before the joining date.");
    await tx.hostelAllocation.update({ where: { id: a.id }, data: { status: "ENDED", endDate } });
    const future = await tx.studentFee.findMany({ where: { hostelAllocationId: a.id, status: "PENDING", paidAmount: 0, term: { startDate: { gt: endDate } } } });
    for (const f of future) {
      await tx.studentFee.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
      await recalcFee(tx, f.id);
    }
    return { cancelledFees: future.length };
  });
}

/* ───────────── outpasses & roll call ───────────── */

export async function createOutpass(branchId: string, approvedByName: string, input: { studentId: string; outAt?: Date; expectedReturn: Date; reason: string; escortName?: string; escortPhone?: string }) {
  const resident = await db.hostelAllocation.findFirst({ where: { branchId, studentId: input.studentId, status: "ACTIVE" }, include: { student: true } });
  if (!resident) throw new AppError("Only hostel residents get an outpass.");
  if (await db.hostelOutpass.findFirst({ where: { studentId: input.studentId, returnedAt: null } })) throw new AppError(`${fullName(resident.student)} is already out on a pass.`);
  const outAt = input.outAt ?? new Date();
  if (input.expectedReturn <= outAt) throw new AppError("The return time must be after the time of leaving.");
  const pass = await db.hostelOutpass.create({ data: { branchId, studentId: input.studentId, outAt, expectedReturn: input.expectedReturn, reason: input.reason, escortName: input.escortName ?? null, escortPhone: input.escortPhone ?? null, approvedByName } });
  if (await isAutomationEnabled("hostel.outpassNotify")) {
    const name = fullName(resident.student);
    await notifyGuardians(input.studentId, {
      title: "Left the hostel",
      body: `${name} left the hostel at ${fmtDateTime(outAt)}${input.escortName ? ` with ${input.escortName}` : ""}. Expected back by ${fmtDateTime(input.expectedReturn)}. Reason: ${input.reason}`,
      ta: { title: "விடுதியிலிருந்து வெளியேறினார்", body: `${name} ${fmtDateTime(outAt)} அன்று விடுதியிலிருந்து வெளியேறினார்${input.escortName ? ` (${input.escortName} உடன்)` : ""}. ${fmtDateTime(input.expectedReturn)} க்குள் திரும்ப வேண்டும்.` },
      category: "HOSTEL", channels: ["SMS"], template: "GENERAL",
    }).catch(() => {});
  }
  return pass;
}

export async function markReturned(branchId: string, outpassId: string) {
  const pass = await db.hostelOutpass.findFirst({ where: { id: outpassId, branchId }, include: { student: true } });
  if (!pass) throw new AppError("Outpass not found.");
  if (pass.returnedAt) throw new AppError("Already marked as returned.");
  const updated = await db.hostelOutpass.update({ where: { id: pass.id }, data: { returnedAt: new Date() } });
  if (await isAutomationEnabled("hostel.outpassNotify")) {
    await notifyGuardians(pass.studentId, {
      title: "Back at the hostel", body: `${fullName(pass.student)} is back at the hostel (${fmtDateTime(updated.returnedAt)}).`,
      ta: { title: "விடுதிக்குத் திரும்பினார்", body: `${fullName(pass.student)} விடுதிக்குத் திரும்பினார் (${fmtDateTime(updated.returnedAt)}).` },
      category: "HOSTEL", channels: ["SMS"], template: "GENERAL",
    }).catch(() => {});
  }
  return updated;
}

export type RollStatus = "PRESENT" | "ABSENT" | "ON_LEAVE";

/** Save a roll call for one hostel and session. Residents out on a pass are ON_LEAVE. Absentees are reported to the hostel managers. */
export async function saveRollCall(branchId: string, markedBy: string, input: { hostelId: string; date: Date; session: "NIGHT" | "MORNING"; entries: { studentId: string; status: RollStatus }[] }) {
  const hostel = await db.hostel.findFirst({ where: { id: input.hostelId, branchId } });
  if (!hostel) throw new AppError("Hostel not found.");
  const residents = new Set((await db.hostelAllocation.findMany({ where: { status: "ACTIVE", room: { hostelId: hostel.id } }, select: { studentId: true } })).map((r) => r.studentId));
  const entries = input.entries.filter((e) => residents.has(e.studentId));
  if (!entries.length) throw new AppError("No residents to mark.");
  await db.$transaction(entries.map((e) => db.hostelRollCall.upsert({
    where: { hostelId_date_session_studentId: { hostelId: hostel.id, date: input.date, session: input.session, studentId: e.studentId } },
    create: { branchId, hostelId: hostel.id, date: input.date, session: input.session, studentId: e.studentId, status: e.status, markedBy },
    update: { status: e.status, markedBy },
  })));
  const absent = entries.filter((e) => e.status === "ABSENT");
  if (absent.length && (await isAutomationEnabled("hostel.absentAlert"))) {
    const names = await db.student.findMany({ where: { id: { in: absent.map((a) => a.studentId) } }, select: { firstName: true, lastName: true } });
    await notifyPermission("hostel.manage", {
      title: `${absent.length} absent at ${input.session === "NIGHT" ? "night" : "morning"} roll call — ${hostel.name}`,
      body: names.map(fullName).join(", "), link: `/hostel/roll-call?hostelId=${hostel.id}`, category: "HOSTEL", inAppOnly: true,
    }, branchId);
  }
  return { marked: entries.length, absent: absent.length };
}

/* ───────────── dashboard & automation ───────────── */

export async function hostelDashboard(branchId: string) {
  const now = new Date();
  const [rooms, residents, out, overdue] = await Promise.all([
    db.hostelRoom.aggregate({ where: { isActive: true, hostel: { branchId, isActive: true } }, _sum: { capacity: true }, _count: true }),
    db.hostelAllocation.count({ where: { branchId, status: "ACTIVE" } }),
    db.hostelOutpass.count({ where: { branchId, returnedAt: null } }),
    db.hostelOutpass.findMany({ where: { branchId, returnedAt: null, expectedReturn: { lt: now } }, include: { student: true }, orderBy: { expectedReturn: "asc" } }),
  ]);
  const beds = rooms._sum.capacity ?? 0;
  return { rooms: rooms._count, beds, residents, free: Math.max(0, beds - residents), out, overdue };
}

/** Every hour: tell the hostel managers about residents who are late back from an outpass (once per pass). */
export async function hostelOverdueReturns(): Promise<string> {
  const late = await db.hostelOutpass.findMany({ where: { returnedAt: null, lateAlertedAt: null, expectedReturn: { lt: new Date() } }, include: { student: true } });
  for (const p of late) {
    await notifyPermission("hostel.manage", { title: "Resident late back from outpass", body: `${fullName(p.student)} was due back at ${fmtDateTime(p.expectedReturn)}.`, link: "/hostel/outpasses", category: "HOSTEL", inAppOnly: true }, p.branchId);
    await db.hostelOutpass.update({ where: { id: p.id }, data: { lateAlertedAt: new Date() } });
  }
  return `${late.length} late return alert(s)`;
}
