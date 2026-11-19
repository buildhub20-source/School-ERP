import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, Pagination, pageParams, cn } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { markNotificationsRead } from "../account/actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { page, pageSize, skip, take } = pageParams(sp, 30);
  const [total, items] = await Promise.all([
    db.notification.count({ where: { userId: user.id } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  return (
    <>
      <PageHeader title="Notifications" actions={<ActionButton action={markNotificationsRead} args={{}} successMessage="All marked as read">Mark all read</ActionButton>} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {items.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No notifications yet.</li>}
          {items.map((n) => (
            <li key={n.id} className={cn("px-5 py-3", !n.readAt && "bg-brand-50/40")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{n.link ? <Link href={n.link} className="hover:text-brand-700">{n.title}</Link> : n.title}</p>
                <span className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600 [overflow-wrap:anywhere]">{n.body}</p>
            </li>
          ))}
        </ul>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/notifications" />
      </Card>
    </>
  );
}
