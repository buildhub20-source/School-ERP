"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { round2, toNum } from "@/lib/format";
import { assertParentOf } from "@/server/parent";
import { startOnlinePayment } from "@/server/fees/payments";

/** Parent pays selected open fee lines (full balances) online. */
export const payFees = defineAction({ perm: "parent.portal", schema: z.object({ studentId: zs.id, feeIds: zs.json(z.array(z.string()).min(1, "Choose at least one fee")) }) }, async ({ studentId, feeIds }) => {
  const user = await assertParentOf(studentId);
  const student = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  const lines = await db.studentFee.findMany({ where: { id: { in: feeIds }, studentId, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } } });
  if (lines.length !== feeIds.length) throw new AppError("Some of the selected fees are already paid. Refresh the page and try again.");
  const allocations = lines.map((l) => ({ studentFeeId: l.id, amount: toNum(l.balance) }));
  const amount = round2(allocations.reduce((s, a) => s + a.amount, 0));
  return startOnlinePayment({ branchId: student.branchId, studentId, purpose: "FEE", amount, allocations, returnTo: "/parent/fees", initiatedById: user.id });
});
