import { db } from "../db";
import { AUTOMATIONS } from "./catalog";

export type AutomationState = { enabled: boolean; config: Record<string, unknown>; time?: string };

/** Read an automation's enabled flag and config (merged with defaults). */
export async function automation(key: string): Promise<AutomationState> {
  const meta = AUTOMATIONS.find((a) => a.key === key);
  if (!meta) throw new Error(`Unknown automation ${key}`);
  const row = await db.automationSetting.findUnique({ where: { key } });
  const cfg = { ...meta.defaultConfig, ...((row?.config as Record<string, unknown>) ?? {}) };
  return { enabled: row?.enabled ?? true, config: cfg, time: (cfg.time as string) ?? (meta.schedule.kind === "daily" ? meta.schedule.defaultTime : undefined) };
}

export async function isAutomationEnabled(key: string) {
  return (await automation(key)).enabled;
}
