import Link from "next/link";
import { redirect } from "next/navigation";
import { parentChild } from "@/server/parent";
import { getT } from "@/lib/i18n/server";
import { Card, CardHeader, CardBody } from "@/components/ui";
import { fullName } from "@/lib/format";
import { orderBuilderData } from "@/server/uniforms/queries";
import { preorderYear } from "@/server/uniforms/core";
import { OrderBuilder } from "@/app/(staff)/uniforms/_components/order-builder";
import { parentOrderAction } from "../actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("parent.orderUniform") };
}

export default async function ParentNewOrder({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await searchParams;
  if (!s.studentId) redirect("/parent/uniforms");
  const { child } = await parentChild(s.studentId);
  const { t } = await getT();
  const pre = await preorderYear();
  const isPreOrder = s.pre === "1" && !!pre;
  const data = await orderBuilderData(child.branchId, child, isPreOrder);
  return (
    <div className="space-y-4">
      <Link href="/parent/uniforms" className="text-sm text-brand-700 hover:underline">← {t("nav.uniformOrders")}</Link>
      <Card>
        <CardHeader title={isPreOrder ? `${t("parent.preOrder")}: ${data.year.name}` : t("parent.orderUniform")} description={`${fullName(child)} · ${child.schoolClass.name}${child.section ? ` - ${child.section.name}` : ""}`} />
        <CardBody>
          {s.pre === "1" && !pre && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("parent.preordersClosed")}</p>}
          <p className="mb-3 text-sm text-slate-600">{t("parent.sizesPrefilled")}</p>
          <OrderBuilder key={isPreOrder ? "pre" : "now"} data={data} studentId={child.id} isPreOrder={isPreOrder} showStock={false} action={parentOrderAction} redirectTo="/parent/uniforms" submitLabel={t("parent.placeOrder")} />
        </CardBody>
      </Card>
    </div>
  );
}
