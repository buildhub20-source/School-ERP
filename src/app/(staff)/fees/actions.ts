"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import {
  addManualLine, bounceCheque, cancelReceipt, closeDay, collectPayment, copyStructure, decideAdjustment, decideConcession, decideRefund,
  deleteStructure, generateTermDues, markReconciled, requestAdjustment, requestConcession, requestRefund, saveFeeHead, saveStructure, sendDueReminders, splitLine,
} from "@/server/fees/service";
import { sendReceipt } from "@/server/fees/receipts";
import { reconcileOnlinePayments } from "@/server/fees/payments";
import { importFees } from "@/server/fees/import";
import { feeLateFees } from "@/server/fees/automations";
import { deleteFeeHead } from "@/server/fees/service";
import { deleteOtherFee, saveOtherFee } from "@/server/fees/other-fees";

const R = "/fees";
const mode = z.enum(["CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "BANK_TRANSFER"]);
const channels = z.array(z.enum(["SMS", "WHATSAPP", "EMAIL"]));

export const saveFeeHeadAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({ id: zs.optStr(40), name: zs.str(80), type: z.enum(["TUITION", "TRANSPORT", "OTHER"]), lateFeeApplies: zs.bool(), isActive: zs.bool() }),
}, async (i, { branchId }) => { await saveFeeHead(branchId, i); return true; });

export const saveStructureAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({ id: zs.optStr(40), academicYearId: zs.id, classId: zs.id, termId: zs.optStr(40), feeHeadId: zs.id, amount: zs.money(), dueDate: zs.date(), instalments: zs.int(1) }),
}, async (i, { branchId }) => { await saveStructure(branchId, { ...i, termId: i.termId && i.termId !== "ANNUAL" ? i.termId : null }); return true; });

export const deleteStructureAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => { await deleteStructure(branchId, id); return true; });

export const copyStructureAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({ academicYearId: zs.id, fromClassId: zs.id, toClassIds: z.array(z.string()).min(1, "Choose at least one class") }),
}, async (i, { branchId }) => copyStructure(branchId, i));

export const generateDuesAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({ academicYearId: zs.id, termId: zs.str(40) }) },
  async ({ academicYearId, termId }, { branchId }) => {
    const r = await generateTermDues(branchId, { academicYearId, termId: termId === "ANNUAL" ? null : termId });
    return { ...r, message: `${r.termName}: ${r.created} student-fee entries created` };
  });

export const applyLateFeesAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({}) }, async () => feeLateFees({}));

export const addLineAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({ studentId: zs.id, feeHeadId: zs.id, description: zs.str(200), amount: zs.money(), dueDate: zs.date(), termId: zs.optStr(40) }),
}, async (i, { branchId }) => { await addManualLine(branchId, i); return true; });

export const splitLineAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({ studentFeeId: zs.id, parts: zs.json(z.array(z.object({ amount: z.coerce.number().positive(), dueDate: z.coerce.date() })).min(2, "Add at least 2 instalments")) }),
}, async (i, { branchId }) => splitLine(branchId, { studentFeeId: i.studentFeeId, parts: i.parts.map((p) => ({ amount: Math.round(p.amount * 100) / 100, dueDate: p.dueDate })) }));

export const collectAction = defineAction({
  perm: "fees.collect", revalidate: R,
  schema: z.object({
    studentId: zs.id, mode, amount: zs.money(), allocations: zs.json(z.array(z.object({ studentFeeId: z.string(), amount: z.coerce.number().min(0) }))).optional(),
    reference: zs.optStr(80), chequeBank: zs.optStr(80), chequeDate: zs.optDate(), paidOn: zs.optDate(), notes: zs.optStr(500), sendVia: zs.json(channels).optional(),
  }),
}, async (i, { user, branchId }) => {
  const p = await collectPayment(user, branchId, { ...i, allocations: i.allocations?.map((a) => ({ studentFeeId: a.studentFeeId, amount: Math.round(a.amount * 100) / 100 })) });
  return { id: p.id, receiptNo: p.receiptNo };
});

export const resendReceiptAction = defineAction({ perm: "fees.collect", schema: z.object({ id: zs.id, channels: zs.json(channels.min(1, "Choose a channel")) }) },
  async ({ id, channels }) => ({ sent: await sendReceipt(id, channels) }));

export const cancelReceiptAction = defineAction({ perm: "fees.collect", revalidate: R, schema: z.object({ id: zs.id, reason: zs.str(300) }) },
  async ({ id, reason }, { branchId }) => { await cancelReceipt(branchId, id, reason); return true; });

export const bounceChequeAction = defineAction({ perm: "fees.collect", revalidate: R, schema: z.object({ id: zs.id, reason: zs.str(300) }) },
  async ({ id, reason }, { branchId }) => { await bounceCheque(branchId, id, reason); return true; });

export const reconcileAction = defineAction({ perm: "fees.collect", revalidate: R, schema: z.object({ id: zs.id }) },
  async ({ id }, { branchId }) => { await markReconciled(branchId, id); return true; });

export const reconcileOnlineAction = defineAction({ perm: "fees.collect", revalidate: R, schema: z.object({}) },
  async (_i, { branchId }) => (await reconcileOnlinePayments(branchId)).summary);

export const requestConcessionAction = defineAction({
  perm: "fees.concession.request", revalidate: R,
  schema: z.object({ studentId: zs.id, type: z.enum(["SIBLING", "STAFF_CHILD", "MERIT", "OTHER"]), mode: z.enum(["PERCENT", "FIXED"]), value: zs.money(), feeHeadId: zs.optStr(40), reason: zs.str(300) }),
}, async (i, { user, branchId }) => { await requestConcession(user, branchId, i); return true; });

export const decideConcessionAction = defineAction({ perm: "fees.concession.approve", revalidate: R, schema: z.object({ id: zs.id, approve: zs.bool(), reason: zs.optStr(300) }) },
  async ({ id, approve, reason }, { user, branchId }) => { await decideConcession(user, branchId, { id, approve, note: reason }); return true; });

export const requestAdjustmentAction = defineAction({
  perm: "fees.refund.request", revalidate: R,
  schema: z.object({ studentFeeId: zs.id, direction: z.enum(["REDUCE", "ADD"]), amount: zs.money(), reason: zs.str(300) }),
}, async (i, { user, branchId }) => { await requestAdjustment(user, branchId, { studentFeeId: i.studentFeeId, amount: i.direction === "REDUCE" ? -i.amount : i.amount, reason: i.reason }); return true; });

export const decideAdjustmentAction = defineAction({ perm: "fees.refund.approve", revalidate: R, schema: z.object({ id: zs.id, approve: zs.bool(), reason: zs.optStr(300) }) },
  async ({ id, approve, reason }, { user, branchId }) => { await decideAdjustment(user, branchId, { id, approve, note: reason }); return true; });

export const requestRefundAction = defineAction({
  perm: "fees.refund.request", revalidate: R,
  schema: z.object({ paymentId: zs.id, amount: zs.money(), reason: zs.str(300), waiveFee: zs.bool(), mode }),
}, async (i, { user, branchId }) => { await requestRefund(user, branchId, i); return true; });

export const decideRefundAction = defineAction({
  perm: "fees.refund.approve", revalidate: R,
  schema: z.object({ id: zs.id, approve: zs.bool(), reason: zs.optStr(300), payoutRef: zs.optStr(80) }),
}, async ({ id, approve, reason, payoutRef }, { user, branchId }) => { await decideRefund(user, branchId, { id, approve, note: reason, payoutRef }); return true; });

export const closeDayAction = defineAction({
  perm: "fees.cashbook", revalidate: R,
  schema: z.object({ date: zs.date(), cashCounted: zs.money(), bankCredited: zs.money(), cashDeposited: zs.money(), notes: zs.optStr(1000) }),
}, async (i, { user, branchId }) => { await closeDay(user, branchId, i); return true; });

export const remindAction = defineAction({ perm: "fees.collect", schema: z.object({ studentIds: zs.json(z.array(z.string()).min(1, "Select at least one student")) }) },
  async ({ studentIds }, { branchId }) => ({ sent: await sendDueReminders(branchId, studentIds) }));

export const importFeesAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({ file: z.instanceof(File), dryRun: zs.bool() }) },
  async ({ file, dryRun }, { branchId }) => importFees(branchId, await file.arrayBuffer(), dryRun));

export const deleteFeeHeadAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({ id: zs.id }) },
  async ({ id }, { branchId }) => { await deleteFeeHead(branchId, id); return true; });


/* ───────── add / edit / delete a whole fee (head + class amounts) in the fee structure ───────── */

export const saveOtherFeeAction = defineAction({
  perm: "fees.setup", revalidate: R,
  schema: z.object({
    id: zs.optStr(40), name: zs.str(80), lateFeeApplies: zs.bool(), isActive: zs.bool(), termId: zs.optStr(40), dueDate: zs.date(), instalments: zs.int(1),
    lines: zs.json(z.array(z.object({ classId: z.string().min(1), amount: z.coerce.number() }))),
  }),
}, async (i, { branchId }) => {
  const r = await saveOtherFee(branchId, { ...i, termId: i.termId && i.termId !== "ANNUAL" ? i.termId : null });
  return { id: r.id, message: i.id ? `Saved — ${r.classes} class${r.classes === 1 ? "" : "es"}${r.removed ? `, ${r.removed} removed` : ""}` : `Added to the fee structure for ${r.classes} class${r.classes === 1 ? "" : "es"}` };
});

export const deleteOtherFeeAction = defineAction({ perm: "fees.setup", revalidate: R, schema: z.object({ id: zs.id }) },
  async ({ id }, { branchId }) => { const r = await deleteOtherFee(branchId, id); return { message: `${r.name} deleted` }; });
