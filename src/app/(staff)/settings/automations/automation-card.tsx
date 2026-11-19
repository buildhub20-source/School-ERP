"use client";
import { useState } from "react";
import { useAction } from "@/components/ui/client";
import { Badge, Button, Card, Input } from "@/components/ui";
import type { AutomationMeta } from "@/lib/automations/catalog";
import { runAutomationNow, saveAutomation } from "../actions";
import { Clock, Zap, Play } from "lucide-react";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function AutomationCard({ meta, enabled, config, lastRunAt, lastResult, history }: { meta: AutomationMeta; enabled: boolean; config: Record<string, unknown>; lastRunAt: string | null; lastResult: string | null; history: { at: string; ok: boolean; summary: string }[] }) {
  const [on, setOn] = useState(enabled);
  const [cfg, setCfg] = useState<Record<string, unknown>>({ ...config, ...(meta.schedule.kind === "daily" ? { time: (config.time as string) ?? meta.schedule.defaultTime } : {}) });
  const [showHistory, setShowHistory] = useState(false);
  const save = useAction(saveAutomation, { successMessage: "Automation saved" });
  const runNow = useAction(runAutomationNow, { successMessage: (d) => d.summary });
  const keys = Object.keys(cfg);
  const dirty = on !== enabled || JSON.stringify(cfg) !== JSON.stringify({ ...config, ...(meta.schedule.kind === "daily" ? { time: (config.time as string) ?? meta.schedule.defaultTime } : {}) });

  const setVal = (k: string, raw: string, sample: unknown) => {
    let v: unknown = raw;
    if (Array.isArray(sample)) v = raw.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
    else if (typeof sample === "number") v = Number(raw);
    else if (typeof sample === "boolean") v = raw === "true";
    setCfg((c) => ({ ...c, [k]: v }));
  };

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{meta.trigger}</p>
          <p className="mt-0.5 text-sm text-slate-600">{meta.action}</p>
        </div>
        <label className="relative inline-flex shrink-0 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-emerald-500" />
          <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {meta.schedule.kind === "event" ? <Badge tone="purple"><Zap className="mr-1 size-3" />When it happens</Badge> : <Badge tone="blue"><Clock className="mr-1 size-3" />{meta.schedule.kind === "interval" ? `Every ${meta.schedule.minutes} min` : "Daily"}</Badge>}
        {lastRunAt && <span className="text-slate-500">Last run {fmt(lastRunAt)}</span>}
      </div>
      {keys.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {keys.map((k) => {
            const v = cfg[k];
            const label = k === "time" ? "Run at (HH:MM)" : meta.configHelp?.[k] ?? k;
            return (
              <label key={k} className="text-xs text-slate-600">
                <span className="mb-1 block">{label}</span>
                {typeof v === "boolean" ? (
                  <select value={String(v)} onChange={(e) => setVal(k, e.target.value, v)} className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="true">Yes</option><option value="false">No</option></select>
                ) : (
                  <Input className="h-8" value={Array.isArray(v) ? v.join(", ") : String(v ?? "")} type={k === "time" ? "time" : "text"} onChange={(e) => setVal(k, e.target.value, v)} />
                )}
              </label>
            );
          })}
        </div>
      )}
      {lastResult && <p className={`mt-3 rounded-md px-2 py-1 text-xs ${lastResult.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>{lastResult}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <button className="text-xs text-brand-700 hover:underline disabled:text-slate-400" disabled={!history.length} onClick={() => setShowHistory(!showHistory)}>{history.length ? `History (${history.length})` : "No runs yet"}</button>
        <div className="flex gap-2">
          {meta.schedule.kind !== "event" && <Button size="sm" variant="secondary" loading={runNow.pending} onClick={() => runNow.run({ key: meta.key })}><Play className="size-3.5" />Run now</Button>}
          <Button size="sm" disabled={!dirty} loading={save.pending} onClick={() => save.run({ key: meta.key, enabled: on, config: JSON.stringify(cfg) })}>Save</Button>
        </div>
      </div>
      {showHistory && (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs">
          {history.map((h, i) => <li key={i} className={h.ok ? "text-slate-600" : "text-rose-600"}>{fmt(h.at)} — {h.summary}</li>)}
        </ul>
      )}
    </Card>
  );
}
