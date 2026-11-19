import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Card, CardHeader, Pagination, pageParams, cn } from "@/components/ui";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.notifications") };
}

export default async function DriverNotifications({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("driver.portal");
  const { t } = await getT();
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 30);
  const [total, items] = await Promise.all([
    db.notification.count({ where: { userId: user.id } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return (
    <Card>
      <CardHeader title={t("nav.notifications")} />
      <ul className="divide-y divide-slate-100">
        {items.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">{t("parent.noNotifications")}</li>}
        {items.map((n) => (
          <li key={n.id} className={cn("px-5 py-3", !n.readAt && "bg-brand-50/40")}>
            <p className="text-sm font-medium text-slate-900">{n.title}</p>
            <p className="whitespace-pre-line text-sm text-slate-600 [overflow-wrap:anywhere]">{n.body}</p>
            <p className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/driver/notifications" />
    </Card>
  );
}
