import { requireParent } from "@/server/parent";
import { getT } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/dict";
import { currentAcademicYear } from "@/lib/settings";
import { studentAttendanceSummary } from "@/server/attendance/service";
import { Card, Badge, EmptyState } from "@/components/ui";
import { fullName, fmtDate, className, today } from "@/lib/format";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("att.title") };
}

export default async function ParentAttendancePage() {
  const { children } = await requireParent();
  const { t } = await getT();
  const tday = today();
  const monthStart = new Date(Date.UTC(tday.getUTCFullYear(), tday.getUTCMonth(), 1));
  const year = await currentAcademicYear();
  const yearStart = year?.startDate ?? monthStart;
  const data = await Promise.all(children.map(async (c) => ({ c, month: await studentAttendanceSummary(c.id, monthStart, tday), year: await studentAttendanceSummary(c.id, yearStart, tday) })));
  const label = { PRESENT: t("att.present"), ABSENT: t("att.absent"), LATE: t("att.late"), HALF_DAY: t("att.halfDay") } as const;
  const tone = { PRESENT: "green", ABSENT: "red", LATE: "yellow", HALF_DAY: "blue" } as const;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t("att.title")}</h1>
      {children.length === 0 && <EmptyState title={t("parent.noChildrenTitle")} description={t("parent.noChildrenDesc")} />}
      {data.map(({ c, month, year: y }) => (
        <Card key={c.id} className="overflow-hidden">
          <div className="border-b border-line p-4">
            <p className="font-semibold">{fullName(c)}</p>
            <p className="text-xs text-muted">{className(c.schoolClass, c.section)}</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
            {[{ k: "att.thisMonth" as const, s: month }, { k: "att.thisYear" as const, s: y }].map(({ k, s }) => (
              <div key={k} className="p-4">
                <p className="text-xs text-muted">{t(k)}</p>
                <p className={`mt-1 text-2xl font-semibold ${s.percent !== null && s.percent < 75 ? "text-rose-700" : "text-ink"}`}>{s.percent === null ? "—" : `${s.percent}%`}</p>
                <p className="mt-1 text-xs text-muted">{fill(t("att.daysMarked"), { n: s.marked })}{s.counts.absent ? ` · ${t("att.absent")} ${s.counts.absent}` : ""}</p>
              </div>
            ))}
          </div>
          <div className="p-4">
            <p className="mb-2 text-sm font-medium">{t("att.notFully")}</p>
            {y.marked === 0 ? <p className="text-sm text-muted">{t("att.none")}</p> : y.notPresent.length === 0 ? <p className="text-sm text-emerald-700">{t("att.allPresent")}</p> : (
              <ul className="divide-y divide-line/70">
                {y.notPresent.slice(0, 30).map((d) => (
                  <li key={d.date.toISOString()} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-28 shrink-0">{fmtDate(d.date)}</span>
                    <Badge tone={tone[d.status]}>{label[d.status]}</Badge>
                    {d.note && <span className="min-w-0 truncate text-xs text-muted">{d.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">{t("att.rule")}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
