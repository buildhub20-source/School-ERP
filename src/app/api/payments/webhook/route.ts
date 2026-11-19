import { runWithContext } from "@/lib/context";
import { handleWebhook, verifyWebhookSignature } from "@/server/fees/payments";

/** Razorpay webhook. Verifies x-razorpay-signature (RAZORPAY_WEBHOOK_SECRET); idempotent. No login (middleware allows it). */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!process.env.RAZORPAY_WEBHOOK_SECRET?.trim()) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  if (!verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"))) return Response.json({ error: "Invalid signature" }, { status: 401 });
  let event;
  try { event = JSON.parse(raw); } catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }
  try {
    const result = await runWithContext({ userName: "Razorpay webhook" }, () => handleWebhook(event));
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error("[payments] webhook failed", e);
    // 500 makes Razorpay retry later; confirmation is idempotent.
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
