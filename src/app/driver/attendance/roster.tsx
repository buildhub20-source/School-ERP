"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Search, X } from "lucide-react";
import { Button, Badge, cn } from "@/components/ui";
import { Modal, useToast } from "@/components/ui/client";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";
import { studentIdFromQr } from "@/server/transport/helpers";
import { boardingAction } from "../actions";

type Row = { studentId: string; name: string; admissionNo: string; className: string; stopName: string; stopSeq: number; pickupTime: string | null; dropTime: string | null; last: { event: string; at: string } | null };

export function Roster({ tripId, tripType, rows }: { tripId: string; tripType: string; rows: Row[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState(() => new Map(rows.map((r) => [r.studentId, r.last])));
  const [scanning, setScanning] = useState(false);
  useEffect(() => setState(new Map(rows.map((r) => [r.studentId, r.last]))), [rows]);

  const mark = async (studentId: string, event: "BOARDED" | "ALIGHTED", method: "APP" | "SCAN") => {
    setBusy(studentId + event);
    const res = await boardingAction({ tripId, studentId, event, method });
    setBusy(null);
    if (res.ok) {
      setState((m) => new Map(m).set(studentId, { event, at: new Date().toISOString() }));
      toast.success(`${res.data.studentName}: ${event === "BOARDED" ? t("driver.board") : t("driver.alight")}`);
      router.refresh();
    } else toast.error(res.error);
    return res.ok;
  };

  const onScan = (text: string) => {
    const id = studentIdFromQr(text);
    if (!id) { toast.error(t("driver.badQr")); return; }
    const row = rows.find((r) => r.studentId === id);
    if (!row) { toast.error(t("driver.notOnBus")); return; }
    const last = state.get(id);
    mark(id, last?.event === "BOARDED" ? "ALIGHTED" : "BOARDED", "SCAN");
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.name.toLowerCase().includes(s) || r.stopName.toLowerCase().includes(s) || r.admissionNo.toLowerCase().includes(s)) : rows;
  }, [q, rows]);
  const onBus = [...state.values()].filter((v) => v?.event === "BOARDED").length;
  const off = [...state.values()].filter((v) => v?.event === "ALIGHTED").length;

  return (
    <>
      <div className="sticky top-14 z-10 -mx-4 mb-3 space-y-2 bg-slate-50/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-sm">
          <Badge tone="green">{fill(t("driver.onBusCount"), { n: onBus })}</Badge><Badge>{fill(t("driver.gotOffCount"), { n: off })}</Badge><Badge tone="yellow">{fill(t("driver.notMarkedCount"), { n: rows.length - onBus - off })}</Badge>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("driver.searchPlaceholder")} className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-base" />
          </div>
          <Button size="lg" className="h-11" onClick={() => setScanning(true)}><ScanLine className="size-5" />{t("driver.scan")}</Button>
        </div>
      </div>
      <ul className="space-y-2">
        {filtered.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">{t("driver.noStudents")}</li>}
        {filtered.map((r) => {
          const last = state.get(r.studentId);
          return (
            <li key={r.studentId} className={cn("rounded-xl border bg-white p-3 shadow-sm", last?.event === "BOARDED" ? "border-emerald-300" : last?.event === "ALIGHTED" ? "border-slate-200 opacity-70" : "border-slate-200")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">{r.className} · {r.stopSeq}. {r.stopName} · {tripType === "PICKUP" ? r.pickupTime ?? "" : r.dropTime ?? ""}</p>
                </div>
                {last && <Badge tone={last.event === "BOARDED" ? "green" : "gray"}>{last.event === "BOARDED" ? t("driver.board") : t("driver.alight")} {new Date(last.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="lg" variant="success" className="h-12" disabled={last?.event === "BOARDED" || !!busy} loading={busy === r.studentId + "BOARDED"} onClick={() => mark(r.studentId, "BOARDED", "APP")}>{t("driver.board")}</Button>
                <Button size="lg" variant="secondary" className="h-12" disabled={last?.event !== "BOARDED" || !!busy} loading={busy === r.studentId + "ALIGHTED"} onClick={() => mark(r.studentId, "ALIGHTED", "APP")}>{t("driver.alight")}</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal open={scanning} onClose={() => setScanning(false)} title={t("driver.scan")} description={t("driver.scanHelp")}>
        {scanning && <Scanner onResult={onScan} onClose={() => setScanning(false)} />}
      </Modal>
    </>
  );
}

function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const msg = useRef({ allowCamera: t("driver.allowCamera"), cameraFailed: t("driver.cameraFailed") });
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastHit = useRef<{ text: string; at: number } | null>(null);
  const cb = useRef(onResult);
  cb.current = onResult;
  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const c = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (result) => {
          if (!result) return;
          const text = result.getText();
          const now = Date.now();
          if (lastHit.current && lastHit.current.text === text && now - lastHit.current.at < 4000) return; // same card still in view
          lastHit.current = { text, at: now };
          if (navigator.vibrate) navigator.vibrate(80);
          cb.current(text);
        });
        if (cancelled) c.stop(); else controls = c;
      } catch (e) {
        setError((e as Error).name === "NotAllowedError" ? msg.current.allowCamera : msg.current.cameraFailed);
      }
    })();
    return () => { cancelled = true; controls?.stop(); };
  }, []);
  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : <video ref={video} className="aspect-square w-full rounded-xl bg-black object-cover" muted playsInline />}
      <p className="text-center text-xs text-slate-500">{t("driver.scanToggle")}</p>
      <Button variant="secondary" size="lg" className="w-full" onClick={onClose}><X className="size-4" />{t("driver.done")}</Button>
    </div>
  );
}
