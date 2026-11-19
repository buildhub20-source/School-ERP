import Link from "next/link";
import { requireParent } from "@/server/parent";
import { db } from "@/lib/db";
import { Card, cn } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { markNotificationsRead } from "@/app/(staff)/account/actions";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.notifications") };
}

export default async function ParentNotifications() {
  const { user } = await requireParent();
  const { t } = await getT();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">{t("nav.notifications")}</h1><ActionButton action={markNotificationsRead} args={{}} successMessage={t("parent.markedRead")}>{t("common.markAllRead")}</ActionButton></div>
      <Card className="divide-y divide-slate-100">
        {items.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">{t("parent.noNotifications")}</p>}
        {items.map((n) => (
          <div key={n.id} className={cn("px-4 py-3", !n.readAt && "bg-brand-50/40")}>
            <p className="text-sm font-medium">{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</p>
            <p className="whitespace-pre-line text-sm text-slate-600 [overflow-wrap:anywhere]">{n.body}</p>
            <p className="text-[11px] text-slate-400">{fmtDateTime(n.createdAt)}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}
