import { notFound } from "next/navigation";
import { money } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { loadCheckout, CheckoutFrame } from "../../shared";
import { SandboxCheckout } from "../../checkout-client";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("pay.sandboxTitle") };
}

export default async function SandboxPage({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { paymentId } = await params;
  const { p, returnTo, school } = await loadCheckout(paymentId, await searchParams);
  if (p.gateway !== "sandbox") notFound();
  const { t } = await getT();
  return (
    <CheckoutFrame t={t} school={school} title={t("pay.secureCheckout")} badge={t("pay.sandboxBadge")} p={p} returnTo={returnTo}>
      <SandboxCheckout paymentId={p.id} returnTo={returnTo} amountLabel={money(p.amount)} />
    </CheckoutFrame>
  );
}
