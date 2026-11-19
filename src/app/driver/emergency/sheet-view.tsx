"use client";
import { useEffect, useState } from "react";
import { CloudOff, HeartPulse, Phone, Search, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";
import type { EmergencySheet } from "@/server/transport/trips";

const KEY = "sms-driver-emergency-sheet";
type Saved = { sheet: EmergencySheet; savedAt: string };

function readSaved(): Saved | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; }
}

/** Emergency contact sheet. Kept in localStorage (and the page + JSON are cached by the service worker) for offline use. */
export function SheetView({ initial }: { initial: EmergencySheet | null }) {
  const t = useT();
  const [data, setData] = useState<Saved | null>(initial ? { sheet: initial, savedAt: initial.generatedAt } : null);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const save = (sheet: EmergencySheet) => {
      const s = { sheet, savedAt: new Date().toISOString() };
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
      setData(s);
    };
    const saved = readSaved();
    if (initial && (!saved || saved.sheet.generatedAt <= initial.generatedAt)) save(initial);
    else if (saved) setData(saved);
    // Refresh from the network (also warms the service-worker cache of /api/driver/emergency).
    fetch("/api/driver/emergency", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error();
      save(await r.json()); setOffline(false);
    }).catch(() => { setOffline(true); const s = readSaved(); if (s) setData(s); });
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [initial]);

  if (!data) return <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">{t("driver.notSaved")}</p>;
  const { sheet } = data;
  const s = q.trim().toLowerCase();
  const list = s ? sheet.students.filter((x) => x.name.toLowerCase().includes(s) || x.stop.toLowerCase().includes(s)) : sheet.students;
  return (
    <div className="space-y-3">
      <div className={"flex items-center gap-2 rounded-xl px-4 py-3 text-sm " + (offline ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
        {offline ? <CloudOff className="size-5" /> : <ShieldCheck className="size-5" />}
        <span>{offline ? t("driver.offlineCopy") : ""}{t("driver.offlineReady")} · {new Date(data.savedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-lg font-bold">{sheet.busNo} <span className="text-sm font-normal text-slate-500">{sheet.registrationNo}</span></p>
        <p className="text-sm text-slate-500">{sheet.routes.join(" · ") || t("driver.noRouteShort")} · {sheet.students.length} {t("driver.students").toLowerCase()}</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {sheet.schoolPhone && <a href={`tel:${sheet.schoolPhone.replace(/\s/g, "")}`} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-rose-600 font-semibold text-white"><Phone className="size-4" />{t("driver.schoolOffice")}</a>}
          {sheet.driver && <a href={`tel:${sheet.driver.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm"><Phone className="size-4" />{t("parent.driver")}: {sheet.driver.name}</a>}
          {sheet.attendant && <a href={`tel:${sheet.attendant.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm"><Phone className="size-4" />{t("parent.attendant")}: {sheet.attendant.name}</a>}
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("driver.findPlaceholder")} className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-base" />
      </div>
      <ul className="space-y-2">
        {list.map((x) => (
          <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-base font-semibold">{x.name}</p><p className="text-xs text-slate-500">{x.className} · {x.stop}{x.bloodGroup ? ` · ${fill(t("driver.blood"), { group: x.bloodGroup })}` : ""}</p></div>
            </div>
            {x.medicalNotes && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-sm text-rose-800"><HeartPulse className="mt-0.5 size-4 shrink-0" /><span><b>{t("driver.medical")}:</b> {x.medicalNotes}</span></p>}
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {x.contacts.map((c) => <a key={c.phone} href={`tel:${c.phone}`} className="flex h-12 items-center gap-2 rounded-xl bg-brand-50 px-3 text-sm text-brand-800"><Phone className="size-4" /><span className="truncate">{c.relation}: {c.name}</span><span className="ml-auto font-mono">{c.phone}</span></a>)}
              {x.emergencyPhone && !x.contacts.some((c) => c.phone === x.emergencyPhone) && <a href={`tel:${x.emergencyPhone}`} className="flex h-12 items-center gap-2 rounded-xl bg-amber-50 px-3 text-sm text-amber-800"><Phone className="size-4" />{t("driver.emergency")}<span className="ml-auto font-mono">{x.emergencyPhone}</span></a>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
