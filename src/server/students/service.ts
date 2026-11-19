import "server-only";
import type { Gender, Prisma } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { nextNumber } from "@/lib/counters";
import { currentAcademicYear } from "@/lib/settings";
import { fullName, money } from "@/lib/format";
import { generateDuesForNewStudent, studentDues } from "@/server/fees/core";
import { endAllocation } from "@/server/transport/core";
import { notifyPermission } from "@/lib/messaging/notify";
import { isAutomationEnabled } from "@/lib/automations/config";

export type GuardianInput = { relation: string; name: string; phone: string; email?: string; occupation?: string; isPrimary?: boolean };

export type StudentInput = {
  admissionNo?: string;
  firstName: string;
  lastName?: string;
  gender: Gender;
  dob?: Date;
  bloodGroup?: string;
  classId: string;
  sectionId?: string;
  rollNo?: string;
  admissionDate?: Date;
  address?: string;
  medicalNotes?: string;
  emergencyPhone?: string;
  isStaffChild?: boolean;
  staffUserId?: string;
  photoUrl?: string;
  guardians: GuardianInput[];
};

export async function nextAdmissionNo(client: DbOrTx = db) {
  const year = await currentAcademicYear();
  const yy = year?.name.slice(0, 4) ?? String(new Date().getFullYear());
  const n = await nextNumber(`ADM-${yy}`, client);
  return `ADM${yy}${String(n).padStart(4, "0")}`;
}

/** Find or create the guardian and their parent login (role PARENT, OTP sign-in by mobile). One login covers all their children. */
async function upsertGuardian(tx: DbOrTx, branchId: string, g: GuardianInput) {
  const parentRole = await tx.role.findUniqueOrThrow({ where: { key: "PARENT" } });
  let guardian = await tx.guardian.findUnique({ where: { phone: g.phone } });
  if (guardian) {
    guardian = await tx.guardian.update({ where: { id: guardian.id }, data: { name: g.name, email: g.email ?? guardian.email, occupation: g.occupation ?? guardian.occupation } });
  } else {
    guardian = await tx.guardian.create({ data: { name: g.name, phone: g.phone, email: g.email, occupation: g.occupation } });
  }
  if (!guardian.userId) {
    const existingUser = await tx.user.findUnique({ where: { phone: g.phone }, include: { role: true } });
    if (existingUser && existingUser.role.key !== "PARENT") {
      // A staff member who is also a parent keeps their staff login; parent portal access via their guardian link is not mixed.
      return guardian;
    }
    const user = existingUser ?? (await tx.user.create({ data: { branchId, roleId: parentRole.id, name: g.name, phone: g.phone, email: g.email && !(await tx.user.findUnique({ where: { email: g.email } })) ? g.email : undefined, preferredChannel: "SMS" } }));
    guardian = await tx.guardian.update({ where: { id: guardian.id }, data: { userId: user.id } });
  }
  return guardian;
}

function validate(input: StudentInput) {
  if (!input.guardians.length) throw new AppError("Add at least one parent or guardian with a mobile number.");
  const phones = input.guardians.map((g) => g.phone);
  if (new Set(phones).size !== phones.length) throw new AppError("Two guardians have the same mobile number.");
}

export async function createStudent(branchId: string, input: StudentInput) {
  validate(input);
  const cls = await db.schoolClass.findFirst({ where: { id: input.classId, branchId } });
  if (!cls) throw new AppError("Choose a valid class.");
  if (input.sectionId && !(await db.section.findFirst({ where: { id: input.sectionId, classId: input.classId } }))) throw new AppError("The section does not belong to that class.");
  const student = await db.$transaction(async (tx) => {
    const admissionNo = input.admissionNo?.trim() || (await nextAdmissionNo(tx));
    const s = await tx.student.create({
      data: {
        branchId, admissionNo, firstName: input.firstName, lastName: input.lastName, gender: input.gender, dob: input.dob, bloodGroup: input.bloodGroup,
        classId: input.classId, sectionId: input.sectionId, rollNo: input.rollNo, admissionDate: input.admissionDate ?? new Date(), address: input.address,
        medicalNotes: input.medicalNotes, emergencyPhone: input.emergencyPhone, isStaffChild: !!input.isStaffChild, staffUserId: input.isStaffChild ? input.staffUserId : null, photoUrl: input.photoUrl,
      },
    });
    for (const [i, g] of input.guardians.entries()) {
      const guardian = await upsertGuardian(tx, branchId, g);
      await tx.studentGuardian.create({ data: { studentId: s.id, guardianId: guardian.id, relation: g.relation, isPrimary: g.isPrimary ?? i === 0 } });
    }
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
    if (year) await tx.enrolment.create({ data: { studentId: s.id, academicYearId: year.id, classId: s.classId, sectionId: s.sectionId } });
    return s;
  }, { timeout: 20000 });
  await generateDuesForNewStudent(student.id);
  return student;
}

export async function updateStudent(branchId: string, id: string, input: StudentInput) {
  validate(input);
  const existing = await db.student.findFirst({ where: { id, branchId } });
  if (!existing) throw new AppError("Student not found.");
  if (input.sectionId && !(await db.section.findFirst({ where: { id: input.sectionId, classId: input.classId } }))) throw new AppError("The section does not belong to that class.");
  return db.$transaction(async (tx) => {
    const s = await tx.student.update({
      where: { id },
      data: {
        admissionNo: input.admissionNo?.trim() || existing.admissionNo, firstName: input.firstName, lastName: input.lastName ?? null, gender: input.gender, dob: input.dob ?? null,
        bloodGroup: input.bloodGroup ?? null, classId: input.classId, sectionId: input.sectionId ?? null, rollNo: input.rollNo ?? null, admissionDate: input.admissionDate ?? existing.admissionDate,
        address: input.address ?? null, medicalNotes: input.medicalNotes ?? null, emergencyPhone: input.emergencyPhone ?? null, isStaffChild: !!input.isStaffChild,
        staffUserId: input.isStaffChild ? input.staffUserId ?? null : null, ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
      },
    });
    const keep: string[] = [];
    for (const [i, g] of input.guardians.entries()) {
      const guardian = await upsertGuardian(tx, branchId, g);
      keep.push(guardian.id);
      await tx.studentGuardian.upsert({
        where: { studentId_guardianId: { studentId: id, guardianId: guardian.id } },
        create: { studentId: id, guardianId: guardian.id, relation: g.relation, isPrimary: g.isPrimary ?? i === 0 },
        update: { relation: g.relation, isPrimary: g.isPrimary ?? i === 0 },
      });
    }
    await tx.studentGuardian.deleteMany({ where: { studentId: id, guardianId: { notIn: keep } } });
    if (existing.classId !== input.classId || existing.sectionId !== (input.sectionId ?? null)) {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
      if (year) await tx.enrolment.upsert({ where: { studentId_academicYearId: { studentId: id, academicYearId: year.id } }, create: { studentId: id, academicYearId: year.id, classId: s.classId, sectionId: s.sectionId }, update: { classId: s.classId, sectionId: s.sectionId } });
    }
    return s;
  }, { timeout: 20000 });
}

/** Siblings = other students sharing a guardian. */
export async function siblingsOf(studentId: string) {
  const links = await db.studentGuardian.findMany({ where: { studentId }, select: { guardianId: true } });
  return db.student.findMany({
    where: { id: { not: studentId }, guardians: { some: { guardianId: { in: links.map((l) => l.guardianId) } } } },
    include: { schoolClass: true, section: true },
  });
}

export type LeaveCheck = { pendingDues: number; pendingCount: number; openOrders: { id: string; orderNo: string; status: string }[]; allocation: { id: string; busNo: string; stop: string } | null };

/** Checks before a student leaves: pending dues, open uniform orders, bus seat. */
export async function leaveChecks(studentId: string): Promise<LeaveCheck> {
  const [dues, orders, alloc] = await Promise.all([
    studentDues(db, studentId),
    db.uniformOrder.findMany({ where: { studentId, status: { in: ["ORDERED", "PAID", "READY"] } }, select: { id: true, orderNo: true, status: true } }),
    db.transportAllocation.findFirst({ where: { studentId, status: "ACTIVE" }, include: { bus: true, stop: true } }),
  ]);
  return { pendingDues: dues.amount, pendingCount: dues.count, openOrders: orders, allocation: alloc ? { id: alloc.id, busNo: alloc.bus.busNo, stop: alloc.stop.name } : null };
}

/** Automation "students.leave": mark as left, free the bus seat, cancel unpaid future dues, flag pending dues and open orders. */
export async function markStudentLeft(branchId: string, studentId: string, leftOn: Date, reason: string) {
  const s = await db.student.findFirst({ where: { id: studentId, branchId } });
  if (!s) throw new AppError("Student not found.");
  if (s.status !== "ACTIVE") throw new AppError("This student is not active.");
  const checks = await leaveChecks(studentId);
  const auto = await isAutomationEnabled("students.leave");
  await db.$transaction(async (tx) => {
    await tx.student.update({ where: { id: studentId }, data: { status: "LEFT", leftOn, leftReason: reason } });
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
    if (year) await tx.enrolment.updateMany({ where: { studentId, academicYearId: year.id }, data: { outcome: "LEFT" } });
    if (auto && checks.allocation) await endAllocation(tx, checks.allocation.id, leftOn);
    if (auto) {
      // Unpaid dues for terms starting after the leaving date are no longer charged.
      const future = await tx.studentFee.findMany({ where: { studentId, status: "PENDING", paidAmount: 0, dueDate: { gt: leftOn }, source: { not: "TRANSPORT" } } });
      for (const f of future) await tx.studentFee.update({ where: { id: f.id }, data: { status: "CANCELLED", balance: 0 } });
    }
  });
  if (auto && (checks.pendingDues > 0 || checks.openOrders.length)) {
    const parts = [
      checks.pendingDues > 0 ? `pending dues ${money(checks.pendingDues)}` : null,
      checks.openOrders.length ? `${checks.openOrders.length} open uniform order(s)` : null,
    ].filter(Boolean).join(" and ");
    await notifyPermission("fees.view", { title: `${fullName(s)} has left with ${parts}`, body: `Admission no ${s.admissionNo}. Please settle before issuing the transfer certificate.`, link: `/students/${s.id}`, category: "STUDENT" }, branchId);
    if (checks.openOrders.length) await notifyPermission("uniforms.orders", { title: `Open uniform orders for ${fullName(s)} (left school)`, body: checks.openOrders.map((o) => o.orderNo).join(", "), link: `/students/${s.id}`, category: "STUDENT" }, branchId);
  }
  return checks;
}

export async function rejoinStudent(branchId: string, studentId: string) {
  const s = await db.student.findFirst({ where: { id: studentId, branchId } });
  if (!s || s.status === "ACTIVE") throw new AppError("This student is already active.");
  return db.student.update({ where: { id: studentId }, data: { status: "ACTIVE", leftOn: null, leftReason: null } });
}

export function studentWhere(branchId: string, f: { q?: string; classId?: string; sectionId?: string; status?: string; gender?: string }): Prisma.StudentWhereInput {
  const parts = f.q?.split(/\s+/).filter(Boolean) ?? [];
  return {
    branchId,
    ...(f.classId ? { classId: f.classId } : {}),
    ...(f.sectionId ? { sectionId: f.sectionId } : {}),
    ...(f.gender ? { gender: f.gender as Gender } : {}),
    status: (f.status as "ACTIVE" | "LEFT" | "GRADUATED") ?? "ACTIVE",
    ...(parts.length ? {
      OR: [
        { admissionNo: { contains: f.q, mode: "insensitive" } },
        { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) },
        { guardians: { some: { guardian: { phone: { contains: f.q } } } } },
      ],
    } : {}),
  };
}
