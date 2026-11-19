"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { canPay, completeRazorpayCheckout, confirmOnlinePayment, failOnlinePayment, safeReturnTo } from "@/server/fees/payments";
import { sandboxAllowed } from "@/server/fees/payments";

function withResult(returnTo: string, params: Record<string, string>) {
  const url = safeReturnTo(returnTo);
  return `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(params).toString()}`;
}

/** Sandbox checkout: simulate the gateway result. Goes through the same confirm path as Razorpay. */
export const sandboxPay = defineAction({
  schema: z.object({ paymentId: zs.id, method: z.enum(["UPI", "CARD", "NETBANKING"]), outcome: z.enum(["success", "failure"]), returnTo: zs.optStr(300) }),
}, async (i, { user }) => {
  const p = await canPay(user, i.paymentId);
  if (!p) throw new AppError("This payment is not yours.", "FORBIDDEN");
  if (p.gateway !== "sandbox") throw new AppError("This payment uses the live gateway.");
  if (!sandboxAllowed()) throw new AppError("The sandbox checkout is disabled on this server.");
  if (i.outcome === "failure") {
    await failOnlinePayment(p.id, `Sandbox: payment failed (${i.method})`);
    return { redirect: withResult(i.returnTo ?? "", { payment: "failed" }) };
  }
  const r = await confirmOnlinePayment(p.id, { gatewayPaymentId: `sandbox_${Date.now().toString(36)}`, mode: i.method, captured: false });
  return { redirect: withResult(i.returnTo ?? "", { payment: "success", receipt: r.payment.receiptNo ?? "" }), receiptNo: r.payment.receiptNo };
});

export const cancelCheckout = defineAction({ schema: z.object({ paymentId: zs.id, returnTo: zs.optStr(300) }) }, async (i, { user }) => {
  const p = await canPay(user, i.paymentId);
  if (!p) throw new AppError("This payment is not yours.", "FORBIDDEN");
  if (p.gateway === "sandbox") await failOnlinePayment(p.id, "Cancelled by the payer");
  return { redirect: withResult(i.returnTo ?? "", { payment: "cancelled" }) };
});

/** Razorpay checkout handler: verify signature, confirm. */
export const razorpayVerify = defineAction({
  schema: z.object({ paymentId: zs.id, razorpay_order_id: zs.str(80), razorpay_payment_id: zs.str(80), razorpay_signature: zs.str(200), returnTo: zs.optStr(300) }),
}, async (i, { user }) => {
  const p = await canPay(user, i.paymentId);
  if (!p) throw new AppError("This payment is not yours.", "FORBIDDEN");
  const r = await completeRazorpayCheckout(p.id, { orderId: i.razorpay_order_id, gatewayPaymentId: i.razorpay_payment_id, signature: i.razorpay_signature });
  return { redirect: withResult(i.returnTo ?? "", { payment: "success", receipt: r.payment.receiptNo ?? "" }) };
});
