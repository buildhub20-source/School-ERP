import "server-only";
import { db } from "../db";
import { runWithContext } from "../context";
import { AUTOMATIONS } from "./catalog";
import { automation } from "./config";
import { JOBS } from "./jobs";

/** Run one scheduled automation now and record the result. */
export async function runAutomation(key: string, opts: { manual?: boolean } = {}): Promise<string> {
  const job = JOBS[key];
  if (!job) return "This automation runs when its triggering action happens; nothing to run on a schedule.";
  const state = await automation(key);
  if (!state.enabled && !opts.manual) return "Disabled";
  const run = await db.automationRun.create({ data: { key } });
  try {
    const summary = await runWithContext({ userName: "Automation" }, () => job(state.config));
    await db.automationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, summary } });
    await db.automationSetting.upsert({ where: { key }, create: { key, lastRunAt: new Date(), lastResult: summary }, update: { lastRunAt: new Date(), lastResult: summary } });
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.automationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, summary: msg } });
    await db.automationSetting.upsert({ where: { key }, create: { key, lastRunAt: new Date(), lastResult: `Error: ${msg}` }, update: { lastRunAt: new Date(), lastResult: `Error: ${msg}` } });
    console.error(`[automation] ${key} failed`, e);
    return `Error: ${msg}`;
  }
}

function istNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Called every few minutes by the scheduler: runs each daily job once per day after its configured time. */
export async function runDueAutomations() {
  const now = istNow();
  const results: Record<string, string> = {};
  for (const meta of AUTOMATIONS) {
    if (meta.schedule.kind === "event") continue;
    const state = await automation(meta.key);
    if (!state.enabled) continue;
    const row = await db.automationSetting.findUnique({ where: { key: meta.key } });
    if (meta.schedule.kind === "daily") {
      const time = state.time ?? meta.schedule.defaultTime;
      if (now.time < time) continue;
      const last = row?.lastRunAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(row.lastRunAt) : null;
      if (last === now.date) continue;
    } else if (meta.schedule.kind === "interval") {
      if (row?.lastRunAt && Date.now() - row.lastRunAt.getTime() < meta.schedule.minutes * 60000) continue;
    }
    results[meta.key] = await runAutomation(meta.key);
  }
  return results;
}
