import Link from "next/link";
import { requireParent } from "@/server/parent";
import { getT } from "@/lib/i18n/server";
import { fill, statusLabel } from "@/lib/i18n/dict";
import { db } from "@/lib/db";
import { Card, CardHeader, CardBody, StatusBadge, Badge, EmptyState, LinkButton } from "@/components/ui";
import { fmtDate, fullName, money, round2, toNum } from "@/lib/format";
import { suggestSizes, preorderYear, currentYear } from "@/server/uniforms/core";
import { OrderTimeline } from "@/app/(staff)/uniforms/_components/timeline";
import { PayOnlineButton } from "./pay-button";
import { Plus, CalendarClock } from "lucide-react";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.uniformOrders") };
}

export default async function ParentUniforms() {
  const { children } = await requireParent();
  const { t } = await getT();
  const [pre, cur] = await Promise.all([preorderYear(), currentYear().catch(() => null)]);
  const orders = await db.uniformOrder.findMany({
    where: { studentId: { in: children.map((c) => c.id) } },
    include: { academicYear: true, lines: { include: { variant: { include: { item: true } } } }, payments: { where: { status: "PENDING", source: "ONLINE" }, select: { id: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  const suggestions = await Promise.all(children.map(async (c) => ({ id: c.id, list: [...(await suggestSizes(c.id, (pre ?? cur)?.startDate ?? new Date())).values()] })));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t("nav.uniformOrders")}</h1>
        {pre && <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700"><CalendarClock className="size-4" />{fill(t("parent.preordersOpen"), { year: pre.name })}</p>}
      </div>
      {!children.length && <EmptyState title={t("parent.noChildrenLinked")} description={t("parent.noChildrenLinkedDesc")} />}
      {children.map((c) => {
        const mine = orders.filter((o) => o.studentId === c.id);
        const sug = suggestions.find((x) => x.id === c.id)?.list ?? [];
        return (
          <Card key={c.id}>
            <CardHeader title={fullName(c)} description={`${c.schoolClass.name}${c.section ? ` - ${c.section.name}` : ""}`}
              actions={<>
                <LinkButton href={`/parent/uniforms/new?studentId=${c.id}`} size="sm" variant="secondary"><Plus className="size-4" />{t("parent.orderUniform")}</LinkButton>
                {pre && <LinkButton href={`/parent/uniforms/new?studentId=${c.id}&pre=1`} size="sm" variant="primary">{t("parent.preOrder")}</LinkButton>}
              </>} />
            <CardBody className="space-y-4">
              {sug.length > 0 && (
                <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
                  <p className="font-medium text-brand-800">{t("parent.suggestedSize")}</p>
                  <p className="mt-0.5 text-brand-900">{sug.map((x) => `${x.itemName}: ${x.size}`).join(" · ")}</p>
                </div>
              )}
              {!mine.length && <p className="text-sm text-slate-500">{t("parent.noUniformOrders")}</p>}
              {mine.map((o) => {
                const bal = round2(toNum(o.total) - toNum(o.paidAmount));
                return (
                  <div key={o.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{o.orderNo} {o.isPreOrder && <Badge tone="purple">{fill(t("parent.preOrderTag"), { year: o.academicYear.name })}</Badge>}</p>
                        <p className="text-xs text-slate-500">{fmtDate(o.createdAt)} · {money(o.total)}{toNum(o.paidAmount) > 0 && ` · ${fill(t("parent.paidAmount"), { amount: money(o.paidAmount) })}`}</p>
                      </div>
                      <StatusBadge status={o.status} label={statusLabel(t, o.status)} />
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
                      {o.lines.filter((l) => l.qty - l.qtyReturned > 0).map((l) => <li key={l.id}>{fill(t("parent.sizeLine"), { item: l.variant.item.name, size: l.variant.size, qty: l.qty - l.qtyReturned })}</li>)}
                    </ul>
                    <div className="mt-3"><OrderTimeline order={o} compact labels={{ ORDERED: t("uorder.step.ORDERED"), PAID: t("uorder.step.PAID"), READY: t("uorder.step.READY"), DELIVERED: t("uorder.step.DELIVERED"), CANCELLED: t("uorder.step.CANCELLED") }} /></div>
                    {o.status === "READY" && <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">{t("parent.readyForCollection")}</p>}
                    {o.status !== "CANCELLED" && bal > 0 && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                        <span className="text-sm">{t("common.balance")}: <b className="text-rose-700">{money(bal)}</b>{o.payments.length > 0 && <span className="ml-2 text-xs text-slate-500">{t("parent.paymentInProgress")}</span>}</span>
                        <PayOnlineButton orderId={o.id} label={`${t("parent.payNow")} ${money(bal)}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardBody>
          </Card>
        );
      })}
      <p className="text-center text-xs text-slate-500"><Link href="/parent" className="hover:underline">← {t("nav.home")}</Link></p>
    </div>
  );
}
