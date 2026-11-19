"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";
import { sandboxPay, cancelCheckout, razorpayVerify } from "./actions";

type Redirect = { redirect: string };

export function SandboxCheckout({ paymentId, returnTo, amountLabel }: { paymentId: string; returnTo: string; amountLabel: string }) {
  const t = useT();
  const router = useRouter();
  const [method, setMethod] = useState<"UPI" | "CARD" | "NETBANKING">("UPI");
  const go = { onSuccess: (d: Redirect) => router.replace(d.redirect), refresh: false };
  const pay = useAction(sandboxPay, go);
  const cancel = useAction(cancelCheckout, go);
  const methods = [{ v: "UPI", l: "UPI", h: t("pay.upiHint") }, { v: "CARD", l: t("pay.card"), h: t("pay.cardHint") }, { v: "NETBANKING", l: t("pay.netbanking"), h: t("pay.netbankingHint") }] as const;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {methods.map((m) => (
          <label key={m.v} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${method === m.v ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
            <input type="radio" name="method" checked={method === m.v} onChange={() => setMethod(m.v)} />
            <span><span className="block text-sm font-medium">{m.l}</span><span className="block text-xs text-slate-500">{m.h}</span></span>
          </label>
        ))}
      </div>
      <Button className="w-full" size="lg" loading={pay.pending} onClick={() => pay.run({ paymentId, method, outcome: "success", returnTo })}>{fill(t("pay.payAmount"), { amount: amountLabel })}</Button>
      <div className="flex gap-2">
        <Button className="flex-1" variant="secondary" loading={pay.pending} onClick={() => pay.run({ paymentId, method, outcome: "failure", returnTo })}>{t("pay.simulateFailure")}</Button>
        <Button className="flex-1" variant="ghost" loading={cancel.pending} onClick={() => cancel.run({ paymentId, returnTo })}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void } } }

export function RazorpayCheckout({ paymentId, returnTo, options }: { paymentId: string; returnTo: string; options: { key: string; order_id: string; amount: number; name: string; description: string; prefill: Record<string, string> } }) {
  const t = useT();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const verify = useAction(razorpayVerify, { onSuccess: (d: Redirect) => router.replace(d.redirect), refresh: false });
  const cancel = useAction(cancelCheckout, { onSuccess: (d: Redirect) => router.replace(d.redirect), refresh: false });
  const open = () => {
    if (!window.Razorpay) return;
    const rz = new window.Razorpay({
      ...options, currency: "INR", theme: { color: "#4f46e5" },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => verify.run({ paymentId, returnTo, ...r }),
    });
    rz.open();
  };
  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onLoad={() => setReady(true)} />
      <Button className="w-full" size="lg" disabled={!ready} loading={verify.pending} onClick={open}>{t("pay.razorpay")}</Button>
      <Button className="mt-2 w-full" variant="ghost" loading={cancel.pending} onClick={() => cancel.run({ paymentId, returnTo })}>{t("pay.back")}</Button>
    </>
  );
}
