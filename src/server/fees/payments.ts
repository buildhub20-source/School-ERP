import "server-only";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import type { PaymentMode } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { round2, toNum, fullName } from "@/lib/format";
import { integrationStatus } from "@/lib/messaging/providers";
import { isAutomationEnabled } from "@/lib/automations/config";
import { onUniformPaymentSuccess } from "@/server/uniforms/payments";
import { autoAllocate, confirmPendingPayment, recordPayment } from "./core";
import { sendOnlineReceipt } from "./receipts";

/**
 * ONLINE PAYMENTS (owned by the fees module).
 * Starts a gateway payment (Razorpay when keys are set, otherwise the built-in sandbox checkout).
 * Used by the parent portal for fees and by the uniforms module for uniform orders.
 */
export type StartOnlinePayment = {
  branchId: string;
  studentId: string;
  purpose: "FEE" | "UNIFORM";
  amount: number;
  uniformOrderId?: string;
  /** For FEE: specific fee lines to pay (omit = oldest dues first). */
  allocations?: { studentFeeId: string; amount: number }[];
  /** Where to send the parent after paying (relative URL). */
  returnTo: string;
  initiatedById: string;
};

const env = (k: string) => process.env[k]?.trim() || "";
export const SANDBOX_EXPIRY_MINUTES = 30;

let rzp: Razorpay | null = null;
export function razorpay() {
  if (!integrationStatus().payments) throw new AppError("The payment gateway is not configured.");
  rzp ??= new Razorpay({ key_id: env("RAZORPAY_KEY_ID"), key_secret: env("RAZORPAY_KEY_SECRET") });
  return rzp;
}
export const razorpayKeyId = () => env("RAZORPAY_KEY_ID");

/** Only same-site relative paths are accepted as return URLs (no open redirects). */
export function safeReturnTo(path: string | null | undefined, fallback = "/parent/fees") {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}

export function checkoutPath(paymentId: string, gateway: string, returnTo: string) {
  const base = gateway === "razorpay" ? `/pay/${paymentId}` : `/pay/sandbox/${paymentId}`;
  return `${base}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** The sandbox checkout moves no money, so it is never allowed in production unless PAYMENTS_SANDBOX=true (staging/demo). */
export function sandboxAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.PAYMENTS_SANDBOX === "true";
}

export async function startOnlinePayment(input: StartOnlinePayment): Promise<{ paymentId: string; checkoutUrl: string }> {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new AppError("Amount must be more than zero.");
  const student = await db.student.findFirst({ where: { id: input.studentId, branchId: input.branchId } });
  if (!student) throw new AppError("Student not found.");
  if (input.purpose === "UNIFORM" && !input.uniformOrderId) throw new AppError("The uniform order is missing.");
  const live = integrationStatus().payments;
  if (!live && !sandboxAllowed()) throw new AppError("Online payment is not available yet. Please pay at the school office.");
  const gateway = live ? "razorpay" : "sandbox";

  const payment = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${student.id} FOR UPDATE`;
    let allocations = input.allocations?.filter((a) => a.amount > 0);
    if (input.purpose === "FEE" && !allocations?.length) {
      const auto = await autoAllocate(tx, student.id, amount);
      if (auto.unallocated > 0.009) throw new AppError("The amount is more than the dues on this account.");
      allocations = auto.allocations;
    }
    return recordPayment(tx, {
      branchId: input.branchId, studentId: student.id, amount, mode: "UPI", purpose: input.purpose, uniformOrderId: input.uniformOrderId,
      allocations: input.purpose === "FEE" ? allocations : undefined, source: "ONLINE", status: "PENDING", gateway, reconciled: false,
    });
  });

  if (live) {
    try {
      const order = await razorpay().orders.create({
        amount: Math.round(amount * 100), currency: "INR", receipt: payment.id,
        notes: { paymentId: payment.id, studentId: student.id, admissionNo: student.admissionNo, purpose: input.purpose },
      });
      await db.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: order.id } });
    } catch (e) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED", notes: `Could not create the gateway order: ${e instanceof Error ? e.message : String(e)}` } });
      throw new AppError("The payment gateway is not reachable right now. Please try again in a few minutes.");
    }
  }
  return { paymentId: payment.id, checkoutUrl: checkoutPath(payment.id, gateway, input.returnTo) };
}

/** Who may open the checkout of a pending payment: a guardian of the student or staff who collect fees / uniform orders. */
export async function canPay(user: { id: string; permissions: string[]; branchId: string }, paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { student: { include: { schoolClass: true } } } });
  if (!p) return null;
  if (user.permissions.includes("parent.portal")) {
    const link = await db.studentGuardian.findFirst({ where: { studentId: p.studentId, guardian: { userId: user.id } } });
    return link ? p : null;
  }
  // Staff: fee checkouts need fees.collect; uniform checkouts also allow uniforms.orders (store staff see no fee details).
  const staffOk = user.permissions.includes("fees.collect") || (p.purpose === "UNIFORM" && user.permissions.includes("uniforms.orders"));
  if (p.branchId === user.branchId && staffOk) return p;
  return null;
}

const MODE_FROM_METHOD: Record<string, PaymentMode> = { upi: "UPI", card: "CARD", netbanking: "NETBANKING", wallet: "UPI", emi: "CARD", bank_transfer: "BANK_TRANSFER" };
export const modeFromMethod = (m?: string | null): PaymentMode => MODE_FROM_METHOD[(m ?? "").toLowerCase()] ?? "UPI";

/**
 * The single confirm path for gateway / sandbox payments. Idempotent: the payment row is locked and a payment that is
 * already SUCCESS is returned unchanged. Money captured by the gateway is always recorded, even if the dues were paid
 * meanwhile (that becomes a refundable credit). Returns whether this call did the confirmation.
 */
export async function confirmOnlinePayment(paymentId: string, data: { gatewayPaymentId?: string; mode: PaymentMode; captured: boolean }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
    if (p.source !== "ONLINE") throw new AppError("This is not an online payment.");
    if (p.status === "SUCCESS") return { payment: p, confirmed: false };
    if (p.status === "FAILED" && data.captured && p.gateway === "razorpay") {
      // Captured at the gateway after we had expired it: revive so the money is accounted for.
      await tx.payment.update({ where: { id: p.id }, data: { status: "PENDING" } });
    } else if (p.status !== "PENDING") {
      throw new AppError(p.status === "FAILED" ? "This payment has expired or failed. Nothing was charged; please start a new payment." : `This payment is ${p.status.toLowerCase()}.`);
    }
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${p.studentId} FOR UPDATE`;
    if (p.purpose === "FEE" && !data.captured) {
      // Sandbox: refuse if the selected dues were paid meanwhile (no money has moved yet).
      for (const a of p.allocations) {
        const f = await tx.studentFee.findUniqueOrThrow({ where: { id: a.studentFeeId } });
        if (toNum(a.amount) - toNum(f.balance) > 0.009 || f.status === "CANCELLED") {
          await tx.payment.update({ where: { id: p.id }, data: { status: "FAILED", notes: [p.notes, "Dues changed before payment completed"].filter(Boolean).join("\n") } });
          return { payment: p, confirmed: false, stale: true };
        }
      }
    }
    const updated = await confirmPendingPayment(tx, p.id, { gatewayPaymentId: data.gatewayPaymentId, mode: data.mode });
    if (p.purpose === "UNIFORM") await onUniformPaymentSuccess(tx, p.id);
    return { payment: updated, confirmed: true };
  }, { timeout: 20000 });
  if ("stale" in result && result.stale) throw new AppError("These dues were updated before the payment completed. Nothing was charged; please start the payment again.");
  if (result.confirmed && (await isAutomationEnabled("fees.onlineReceipt"))) {
    await sendOnlineReceipt(result.payment.id).catch((e) => console.error("[fees] online receipt failed", e));
  }
  return result;
}

export async function failOnlinePayment(paymentId: string, reason: string) {
  const upd = await db.payment.updateMany({ where: { id: paymentId, status: "PENDING", source: "ONLINE" }, data: { status: "FAILED", notes: reason } });
  return upd.count === 1;
}

/** Razorpay checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto.createHmac("sha256", env("RAZORPAY_KEY_SECRET")).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = env("RAZORPAY_WEBHOOK_SECRET");
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Razorpay checkout returned: verify the signature and confirm. */
export async function completeRazorpayCheckout(paymentId: string, r: { orderId: string; gatewayPaymentId: string; signature: string }) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.gateway !== "razorpay" || p.gatewayOrderId !== r.orderId) throw new AppError("Payment not found.");
  if (!verifyCheckoutSignature(r.orderId, r.gatewayPaymentId, r.signature)) throw new AppError("The payment could not be verified. If money was debited it will be confirmed automatically.");
  let mode: PaymentMode = "UPI";
  try { mode = modeFromMethod((await razorpay().payments.fetch(r.gatewayPaymentId)).method); } catch { /* keep default */ }
  return confirmOnlinePayment(p.id, { gatewayPaymentId: r.gatewayPaymentId, mode, captured: true });
}

type WebhookEvent = { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; method?: string; error_description?: string; amount?: number; currency?: string } } } };

/** Razorpay webhook (payment.captured / order.paid / payment.failed). Idempotent. */
export async function handleWebhook(event: WebhookEvent) {
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id) return "ignored";
  const p = await db.payment.findUnique({ where: { gatewayOrderId: entity.order_id } });
  if (!p) return "unknown order";
  if (event.event === "payment.captured" || event.event === "order.paid") {
    // The order fixes the amount at Razorpay; this is a second check (amounts are in paise) before money is recorded.
    if (entity.amount != null && (entity.amount !== Math.round(toNum(p.amount) * 100) || (entity.currency ?? "INR") !== "INR")) {
      console.error(`[payments] webhook amount mismatch for ${p.id}: got ${entity.amount} ${entity.currency}, expected ${toNum(p.amount)} INR`);
      await db.payment.updateMany({ where: { id: p.id }, data: { notes: [p.notes, `Webhook amount mismatch (${entity.amount} ${entity.currency ?? ""}) - check in Razorpay`].filter(Boolean).join("\n") } });
      return "amount mismatch";
    }
    const r = await confirmOnlinePayment(p.id, { gatewayPaymentId: entity.id, mode: modeFromMethod(entity.method), captured: true });
    return r.confirmed ? "confirmed" : "already confirmed";
  }
  if (event.event === "payment.failed") {
    // A failed attempt does not end the order (the parent can retry in the same checkout); expiry is handled by reconciliation.
    await db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { notes: `Attempt failed: ${entity.error_description ?? "unknown"}` } });
    return "noted";
  }
  return "ignored";
}

/**
 * Automatic reconciliation of online payments:
 * - stale PENDING Razorpay payments: fetch the order's payments; captured → confirm, otherwise expire after 30 min.
 * - stale PENDING sandbox payments: expire after 30 min.
 * - successful gateway payments are marked reconciled.
 */
export async function reconcileOnlinePayments(branchId?: string) {
  const cutoff = new Date(Date.now() - SANDBOX_EXPIRY_MINUTES * 60000);
  const stale = await db.payment.findMany({ where: { source: "ONLINE", status: "PENDING", createdAt: { lt: cutoff }, ...(branchId ? { branchId } : {}) } });
  let confirmed = 0, expired = 0, waiting = 0;
  for (const p of stale) {
    if (p.gateway === "razorpay" && p.gatewayOrderId && integrationStatus().payments) {
      try {
        const res = await razorpay().orders.fetchPayments(p.gatewayOrderId);
        const items = (res.items ?? []) as { id: string; status: string; method?: string }[];
        const captured = items.find((i) => i.status === "captured");
        if (captured) {
          const r = await confirmOnlinePayment(p.id, { gatewayPaymentId: captured.id, mode: modeFromMethod(captured.method), captured: true });
          if (r.confirmed) confirmed++;
          continue;
        }
        if (items.some((i) => i.status === "authorized" || i.status === "created")) { waiting++; continue; }
      } catch (e) {
        console.error("[fees] reconcile fetch failed", e);
        waiting++;
        continue;
      }
    }
    if (await failOnlinePayment(p.id, `Expired after ${SANDBOX_EXPIRY_MINUTES} minutes without payment`)) expired++;
  }
  const marked = await db.payment.updateMany({ where: { source: "ONLINE", status: "SUCCESS", reconciled: false, gatewayPaymentId: { not: null }, ...(branchId ? { branchId } : {}) }, data: { reconciled: true, reconciledAt: new Date() } });
  return { confirmed, expired, waiting, marked: marked.count, summary: `Online reconciliation: ${confirmed} confirmed, ${expired} expired, ${waiting} awaiting gateway, ${marked.count} marked reconciled` };
}

export const describePayment = (p: { amount: unknown; purpose: string; student: { firstName: string; lastName?: string | null } }) =>
  `${p.purpose === "UNIFORM" ? "Uniform order" : "School fees"} for ${fullName(p.student)} — ₹${toNum(p.amount as number).toLocaleString("en-IN")}`;
