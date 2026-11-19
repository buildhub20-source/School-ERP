import { requireParent } from "@/server/parent";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { Card, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Circulars" };

export default async function ParentCirculars() {
  const { user, children } = await requireParent();
  const { t, lang } = await getT();
  const [circulars, events] = await Promise.all([
    db.circular.findMany({ where: { branchId: user.branchId, sentAt: { not: null }, OR: [{ audience: { in: ["ALL_PARENTS", "EVERYONE"] } }, { audience: "CLASSES", classIds: { hasSome: children.map((c) => c.classId) } }] }, orderBy: { sentAt: "desc" }, take: 50 }),
    db.schoolEvent.findMany({ where: { branchId: user.branchId, audience: { in: ["ALL_PARENTS", "EVERYONE"] }, date: { gte: new Date(Date.now() - 86400000) } }, orderBy: { date: "asc" }, take: 10 }),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t("parent.circulars")}</h1>
      {events.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">{t("parent.upcoming")}</p>
          <ul className="space-y-1 text-sm">{events.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2"><Badge tone={e.type === "HOLIDAY" ? "yellow" : "blue"}>{e.type === "HOLIDAY" || e.type === "EVENT" ? t(`event.${e.type}`) : e.type.toLowerCase()}</Badge>{fmtDate(e.date)}{e.endDate && ` – ${fmtDate(e.endDate)}`} · {e.title}</li>)}</ul>
        </Card>
      )}
      <Card className="divide-y divide-slate-100">
        {circulars.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">{t("parent.noCirculars")}</p>}
        {circulars.map((c) => {
          const inTamil = lang === "ta" && c.titleTa && c.bodyTa;
          return (
            <article key={c.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{inTamil ? c.titleTa : c.title}</h2><span className="text-xs text-slate-400">{fmtDate(c.sentAt)}</span></div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-600 [overflow-wrap:anywhere]">{inTamil ? c.bodyTa : c.body}</p>
            </article>
          );
        })}
      </Card>
    </div>
  );
}
