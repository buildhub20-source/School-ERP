"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { round2, toNum } from "@/lib/format";
import { assertParentOf } from "@/server/parent";
import { createOrder } from "@/server/uniforms/service";
import { startOnlinePayment } from "@/server/fees/payments";

const lines = z.array(z.object({ variantId: zs.id, qty: z.coerce.number().int().min(1).max(10) })).min(1, "Add at least one item");

export const parentOrderAction = defineAction({
  perm: "parent.portal", revalidate: "/parent/uniforms",
  schema: z.object({ studentId: zs.id, lines: zs.json(lines), isPreOrder: zs.bool(), notes: zs.optStr(500) }),
}, async (i, { user }) => {
  await assertParentOf(i.studentId);
  const student = await db.student.findUniqueOrThrow({ where: { id: i.studentId } });
  const o = await createOrder(student.branchId, { ...i, placedVia: "PARENT" }, user.id);
  return { id: o.id, orderNo: o.orderNo };
});

export const parentPayAction = defineAction({ perm: "parent.portal", schema: z.object({ orderId: zs.id }) }, async ({ orderId }, { user }) => {
  const o = await db.uniformOrder.findUnique({ where: { id: orderId } });
  if (!o) throw new AppError("Order not found.");
  await assertParentOf(o.studentId);
  if (o.status === "CANCELLED") throw new AppError("This order is cancelled.");
  const balance = round2(toNum(o.total) - toNum(o.paidAmount));
  if (balance <= 0) throw new AppError("This order is already paid.");
  try {
    const r = await startOnlinePayment({ branchId: o.branchId, studentId: o.studentId, purpose: "UNIFORM", amount: balance, uniformOrderId: o.id, returnTo: "/parent/uniforms", initiatedById: user.id });
    return { checkoutUrl: r.checkoutUrl };
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error("[uniforms] online payment failed", e);
    throw new AppError("Online payment could not be started. Please try again later or pay at the school store.");
  }
});
