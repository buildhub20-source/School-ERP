import "server-only";
import type { DbOrTx } from "@/lib/db";
import { syncOrderPayments } from "./core";

/**
 * Called by the fees module (inside its transaction) when a payment with purpose UNIFORM succeeds
 * (counter or online). Must update the order's paidAmount and move it to PAID when fully paid.
 */
export async function onUniformPaymentSuccess(client: DbOrTx, paymentId: string): Promise<void> {
  const p = await client.payment.findUnique({ where: { id: paymentId }, select: { purpose: true, uniformOrderId: true } });
  if (!p || p.purpose !== "UNIFORM" || !p.uniformOrderId) return;
  await syncOrderPayments(client, p.uniformOrderId);
}
