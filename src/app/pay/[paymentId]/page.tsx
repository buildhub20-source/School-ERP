import { notFound } from "next/navigation";
import { fullName } from "@/lib/format";
import { toNum } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { razorpayKeyId } from "@/server/fees/payments";
import { loadCheckout, CheckoutFrame } from "../shared";
import { RazorpayCheckout } from "../checkout-client";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pay.checkoutTitle") };
}

export default async function RazorpayPage({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { paymentId } = await params;
  const { user, p, returnTo, school } = await loadCheckout(paymentId, await searchParams);
  if (p.gateway !== "razorpay" || !p.gatewayOrderId) notFound();
  const { t } = await getT();
  return (
    <CheckoutFrame t={t} school={school} title={t("pay.secureCheckout")} p={p} returnTo={returnTo}>
      <RazorpayCheckout paymentId={p.id} returnTo={returnTo} options={{
        key: razorpayKeyId(), order_id: p.gatewayOrderId, amount: Math.round(toNum(p.amount) * 100), name: school.name,
        description: `${p.purpose === "UNIFORM" ? t("pay.uniformOrder") : t("pay.fees")} — ${fullName(p.student)} (${p.student.admissionNo})`,
        prefill: { name: user.name, ...(user.email ? { email: user.email } : {}), ...(user.phone ? { contact: user.phone } : {}) },
      }} />
    </CheckoutFrame>
  );
}
