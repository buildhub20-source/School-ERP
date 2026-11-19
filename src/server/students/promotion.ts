import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fullName, money, toNum } from "@/lib/format";
import { isAutomationEnabled } from "@/lib/automations/config";
import { notifyPermission } from "@/lib/messaging/notify";
import { endAllocation, copyAllocationsToYear } from "@/server/transport/core";
import { openPreorders } from "@/server/uniforms/automations";

export async function promotionPreview(branchId: string) {
  const current = await db.academicYear.findFirst({ where: { isCurrent: true } });
  const next = current ? await db.academicYear.findFirst({ where: { startDate: { gt: current.startDate }, closedAt: null }, orderBy: { startDate: "asc" }, include: { terms: true } }) : null;
  const classes = await db.schoolClass.findMany({ where: { branchId }, include: { sections: true }, orderBy: { grade: "asc" } });
  const students = await db.student.findMany({ where: { branchId, status: "ACTIVE" }, include: { section: true }, orderBy: [{ firstName: "asc" }] });
  const dues = await db.studentFee.groupBy({ by: ["studentId"], where: { student: { branchId, status: "ACTIVE" }, status: { in: ["PENDING", "PARTIAL"] } }, _sum: { balance: true } });
  const dueMap = new Map(dues.map((d) => [d.studentId, toNum(d._sum.balance)]));
  const nextStructures = next ? await db.feeStructure.count({ where: { academicYearId: next.id } }) : 0;
  const rows = classes.map((c, i) => {
    const target = classes.slice(i + 1).find((x) => x.grade > c.grade) ?? null;
    return {
      classId: c.id, className: c.name, target: target ? { id: target.id, name: target.name } : null,
      students: students.filter((s) => s.classId === c.id).map((s) => ({ id: s.id, name: fullName(s), admissionNo: s.admissionNo, section: s.section?.name ?? "", dues: dueMap.get(s.id) ?? 0 })),
    };
  });
  return { current, next, rows, nextStructures, withDues: students.filter((s) => (dueMap.get(s.id) ?? 0) > 0).length };
}

/**
 * Close the current academic year and roll forward (automation "students.promotion"):
 * promote students to the next class (or graduate the top class; detained students stay),
 * keep class history, carry forward transport allocations and fee structure, keep size profiles,
 * flag pending dues, open uniform pre-orders for the new year.
 */
export async function closeYearAndPromote(branchId: string, opts: { detainIds: string[]; copyFeeStructure: boolean; carryTransport: boolean; openPreorders: boolean }) {
  const preview = await promotionPreview(branchId);
  const { current, next } = preview;
  if (!current) throw new AppError("There is no current academic year.");
  if (!next) throw new AppError("Create the next academic year (with its terms) in Settings → Academic years first.");
  if (!next.terms.length) throw new AppError(`Add terms to ${next.name} first.`);
  const carryAuto = await isAutomationEnabled("students.promotion");
  const detain = new Set(opts.detainIds);
  const sectionsByClass = new Map((await db.section.findMany({ where: { schoolClass: { branchId } } })).reduce((m, s) => m.set(s.classId, [...(m.get(s.classId) ?? []), s]), new Map<string, { id: string; name: string }[]>()));
  let promoted = 0, graduated = 0, detained = 0;

  for (const row of preview.rows) {
    for (const st of row.students) {
      const student = await db.student.findUniqueOrThrow({ where: { id: st.id }, include: { section: true } });
      await db.$transaction(async (tx) => {
        let outcome: string;
        let classId = student.classId, sectionId = student.sectionId;
        if (detain.has(st.id)) { outcome = "DETAINED"; detained++; }
        else if (!row.target) { outcome = "GRADUATED"; graduated++; }
        else {
          outcome = "PROMOTED"; promoted++;
          classId = row.target.id;
          const secs = sectionsByClass.get(classId) ?? [];
          sectionId = secs.find((s) => s.name === student.section?.name)?.id ?? secs[0]?.id ?? null;
        }
        await tx.enrolment.upsert({
          where: { studentId_academicYearId: { studentId: st.id, academicYearId: current.id } },
          create: { studentId: st.id, academicYearId: current.id, classId: student.classId, sectionId: student.sectionId, outcome },
          update: { outcome },
        });
        if (outcome === "GRADUATED") {
          await tx.student.update({ where: { id: st.id }, data: { status: "GRADUATED", leftOn: current.endDate, leftReason: "Completed the final class" } });
          const alloc = await tx.transportAllocation.findFirst({ where: { studentId: st.id, status: "ACTIVE" } });
          if (alloc) await endAllocation(tx, alloc.id, current.endDate);
        } else {
          await tx.student.update({ where: { id: st.id }, data: { classId, sectionId } });
          await tx.enrolment.upsert({ where: { studentId_academicYearId: { studentId: st.id, academicYearId: next.id } }, create: { studentId: st.id, academicYearId: next.id, classId, sectionId }, update: { classId, sectionId } });
        }
      });
    }
  }

  let structuresCopied = 0;
  if (carryAuto && opts.copyFeeStructure && preview.nextStructures === 0) {
    const shiftMs = next.startDate.getTime() - current.startDate.getTime();
    const termMap = new Map<string, string>();
    const oldTerms = await db.term.findMany({ where: { academicYearId: current.id } });
    for (const t of oldTerms) {
      const n = next.terms.find((x) => x.sequence === t.sequence);
      if (n) termMap.set(t.id, n.id);
    }
    const structures = await db.feeStructure.findMany({ where: { academicYearId: current.id, schoolClass: { branchId } } });
    for (const s of structures) {
      if (s.termId && !termMap.has(s.termId)) continue;
      await db.feeStructure.create({ data: { academicYearId: next.id, classId: s.classId, termId: s.termId ? termMap.get(s.termId)! : null, feeHeadId: s.feeHeadId, amount: s.amount, dueDate: new Date(s.dueDate.getTime() + shiftMs), instalments: s.instalments } });
      structuresCopied++;
    }
  }

  await db.$transaction([
    db.academicYear.update({ where: { id: current.id }, data: { isCurrent: false, closedAt: new Date() } }),
    db.academicYear.update({ where: { id: next.id }, data: { isCurrent: true } }),
  ]);

  let allocations = 0;
  if (carryAuto && opts.carryTransport) allocations = (await copyAllocationsToYear(current.id, next.id)).copied;
  if (opts.openPreorders) await openPreorders(next.id);

  if (carryAuto && preview.withDues > 0) {
    const total = preview.rows.flatMap((r) => r.students).reduce((a, s) => a + s.dues, 0);
    await notifyPermission("fees.view", { title: `${preview.withDues} students carried pending dues into ${next.name}`, body: `Total outstanding from ${current.name} and earlier: ${money(total)}. These dues stay on each student's account.`, link: "/fees/defaulters", category: "FEES" }, branchId);
  }
  return { promoted, graduated, detained, structuresCopied, allocations, year: next.name };
}
