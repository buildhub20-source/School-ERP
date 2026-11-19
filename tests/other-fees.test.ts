import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { createStudent } from "@/server/students/service";
import { generateTermDues, deleteFeeHead } from "@/server/fees/service";
import { saveOtherFee, deleteOtherFee } from "@/server/fees/other-fees";
import { testCtx, asUser, uniq } from "./helpers";

/** Other fees = extra fee types kept in the class-wise fee structure. Runs in a throw-away branch. */
let ctx: Awaited<ReturnType<typeof testCtx>>;
let branchId = "";
let class6 = "";
let class7 = "";
const phones: string[] = [];
const due = new Date("2026-12-15T00:00:00Z");
const base = { lateFeeApplies: false, isActive: true, termId: null, dueDate: due, instalments: 1 };

const phone = () => {
  const p = `6${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  phones.push(p);
  return p;
};
const newStudent = (classId: string) =>
  asUser(ctx.adminId, () => createStudent(branchId, { firstName: "Other", lastName: uniq("S"), gender: "FEMALE", classId, admissionDate: new Date("2026-05-01T00:00:00Z"), guardians: [{ relation: "Mother", name: "Parent", phone: phone() }] }));
const structure = (feeHeadId: string) => db.feeStructure.findMany({ where: { feeHeadId, academicYearId: ctx.year.id }, orderBy: { classId: "asc" } });

beforeAll(async () => {
  ctx = await testCtx();
  const code = uniq("TB");
  branchId = (await db.branch.create({ data: { code, name: `Test branch ${code}` } })).id;
  class6 = (await db.schoolClass.create({ data: { branchId, name: "Class 6", grade: 6 } })).id;
  class7 = (await db.schoolClass.create({ data: { branchId, name: "Class 7", grade: 7 } })).id;
});

afterAll(async () => {
  if (!branchId) return;
  const guardians = await db.guardian.findMany({ where: { phone: { in: phones } } });
  await db.studentFee.deleteMany({ where: { student: { branchId } } });
  await db.student.deleteMany({ where: { branchId } });
  await db.guardian.deleteMany({ where: { id: { in: guardians.map((g) => g.id) } } });
  await db.user.deleteMany({ where: { branchId } });
  await db.setting.deleteMany({ where: { branchId } });
  await db.feeStructure.deleteMany({ where: { schoolClass: { branchId } } });
  await db.feeHead.deleteMany({ where: { branchId } });
  await db.schoolClass.deleteMany({ where: { branchId } });
  const b = await db.branch.findUnique({ where: { id: branchId } });
  if (b) await db.counter.deleteMany({ where: { key: { contains: `-${b.code}-` } } });
  await db.branch.delete({ where: { id: branchId } });
});

describe("other fees", () => {
  it("adds a fee type to the structure without billing anyone", async () => {
    const s = await newStudent(class6);
    const r = await saveOtherFee(branchId, { ...base, name: "Miscellaneous Fee", lines: [{ classId: class6, amount: 500 }, { classId: class7, amount: 650 }] });
    const head = await db.feeHead.findUniqueOrThrow({ where: { id: r.id } });
    expect(head.type).toBe("OTHER");
    const lines = await structure(r.id);
    expect(lines.map((l) => [l.classId, toNum(l.amount)]).sort()).toEqual([[class6, 500], [class7, 650]].sort());
    expect(await db.studentFee.count({ where: { studentId: s.id, feeHeadId: r.id } })).toBe(0);

    // Students are billed only when dues are generated.
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const billed = await db.studentFee.findMany({ where: { studentId: s.id, feeHeadId: r.id } });
    expect(billed.map((b) => toNum(b.amount))).toEqual([500]);
  });

  it("rejects duplicates and empty or zero class lines", async () => {
    await expect(saveOtherFee(branchId, { ...base, name: "Miscellaneous Fee", lines: [{ classId: class6, amount: 1 }] })).rejects.toThrow(/already exists/);
    await expect(saveOtherFee(branchId, { ...base, name: "ID Card", lines: [] })).rejects.toThrow(/at least one class/);
    await expect(saveOtherFee(branchId, { ...base, name: "ID Card", lines: [{ classId: class6, amount: 0 }] })).rejects.toThrow(/more than zero/);
  });

  it("edits unbilled classes freely but locks billed ones, leaving nothing half-saved", async () => {
    const head = await db.feeHead.findFirstOrThrow({ where: { branchId, name: "Miscellaneous Fee" } });
    // Class 6 was billed above; changing its amount is refused and nothing changes.
    await expect(saveOtherFee(branchId, { ...base, id: head.id, name: "Misc Fee", lines: [{ classId: class6, amount: 900 }, { classId: class7, amount: 700 }] })).rejects.toThrow(/only the due date can change/);
    expect((await db.feeHead.findUniqueOrThrow({ where: { id: head.id } })).name).toBe("Miscellaneous Fee");
    // Removing a billed class is refused too.
    await expect(saveOtherFee(branchId, { ...base, id: head.id, name: "Miscellaneous Fee", lines: [{ classId: class7, amount: 650 }] })).rejects.toThrow(/can't be removed/);

    // Rename + new due date + changing the unbilled class is fine; billed lines follow the rename and due date.
    const newDue = new Date("2027-01-10T00:00:00Z");
    await saveOtherFee(branchId, { ...base, id: head.id, name: "Misc Fee", dueDate: newDue, lines: [{ classId: class6, amount: 500 }, { classId: class7, amount: 700 }] });
    const lines = await structure(head.id);
    expect(lines.find((l) => l.classId === class7)!.amount.toString()).toBe("700");
    const billed = await db.studentFee.findMany({ where: { feeHeadId: head.id } });
    expect(billed.every((b) => b.description.startsWith("Misc Fee") && b.dueDate.getTime() === newDue.getTime())).toBe(true);

    // An unbilled class can be dropped.
    const r = await saveOtherFee(branchId, { ...base, id: head.id, name: "Misc Fee", dueDate: newDue, lines: [{ classId: class6, amount: 500 }] });
    expect(r.removed).toBe(1);
  });

  it("deletes only while no student has been billed", async () => {
    const head = await db.feeHead.findFirstOrThrow({ where: { branchId, name: "Misc Fee" } });
    await expect(deleteOtherFee(branchId, head.id)).rejects.toThrow(/already been billed/);
    await expect(deleteFeeHead(branchId, head.id)).rejects.toThrow(/already used/);

    const r = await saveOtherFee(branchId, { ...base, name: "Annual Day Fee", lines: [{ classId: class7, amount: 300 }] });
    await deleteOtherFee(branchId, r.id);
    expect(await db.feeHead.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await db.feeStructure.count({ where: { feeHeadId: r.id } })).toBe(0);
  });
});
