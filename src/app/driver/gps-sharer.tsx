"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";

const INTERVAL = 15000;

/** While a trip is active, watch the phone's GPS and POST the latest fix to /api/driver/location every ~15 s. */
export function GpsSharer({ tripId }: { tripId: string }) {
  const t = useT();
  const latest = useRef<{ lat: number; lng: number; speed: number | null } | null>(null);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) { setError(t("driver.gpsUnsupported")); return; }
    let stopped = false;
    let sending = false;
    const send = async () => {
      const p = latest.current;
      if (!p || sending || stopped) return;
      sending = true;
      try {
        const r = await fetch("/api/driver/location", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { setLastSent(new Date()); setError(null); } else setError(d.error ?? t("driver.locationNotSaved"));
      } catch { setError(t("driver.noNetwork")); }
      sending = false;
    };
    let first = true;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        latest.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed !== null && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 3.6) : null };
        if (first) { first = false; send(); }
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? t("driver.allowLocation") : t("driver.waitingGps")),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    const id = setInterval(send, INTERVAL);
    return () => { stopped = true; navigator.geolocation.clearWatch(watch); clearInterval(id); };
  }, [tripId]);
  return (
    <div className={"mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm " + (error ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
      {error ? <AlertTriangle className="size-5 shrink-0" /> : <MapPin className="size-5 shrink-0 animate-pulse" />}
      <div>
        <p className="font-medium">{t("driver.sharingLocation")}</p>
        <p className="text-xs">{error ?? (lastSent ? fill(t("driver.lastSent"), { time: lastSent.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }) : t("driver.gettingLocation"))}</p>
      </div>
    </div>
  );
}
