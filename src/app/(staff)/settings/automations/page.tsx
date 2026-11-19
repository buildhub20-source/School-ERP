import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { AUTOMATIONS } from "@/lib/automations/catalog";
import { SettingsTabs } from "../tabs";
import { AutomationCard } from "./automation-card";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const user = await requireUser("settings.manage");
  const [rows, runs] = await Promise.all([
    db.automationSetting.findMany(),
    db.automationRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
  ]);
  const areas = [...new Set(AUTOMATIONS.map((a) => a.area))];
  return (
    <>
      <PageHeader title="Settings" description="Everything the system does on its own. Turn each automation on or off, change its timing and parameters, or run a scheduled one now." />
      <SettingsTabs user={user} active="/settings/automations" />
      <div className="space-y-6">
        {areas.map((area) => (
          <section key={area}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{area}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {AUTOMATIONS.filter((a) => a.area === area).map((a) => {
                const row = rows.find((r) => r.key === a.key);
                const history = runs.filter((r) => r.key === a.key).slice(0, 5).map((r) => ({ at: r.startedAt.toISOString(), ok: r.ok, summary: r.summary ?? "" }));
                return <AutomationCard key={a.key} meta={a} enabled={row?.enabled ?? true} config={{ ...a.defaultConfig, ...((row?.config as object) ?? {}) }} lastRunAt={row?.lastRunAt?.toISOString() ?? null} lastResult={row?.lastResult ?? null} history={history} />;
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
