"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/** Signs the user out after `minutes` of inactivity, with a 60-second warning. Server also enforces idle expiry. */
export function IdleLogout({ minutes }: { minutes: number }) {
  const t = useT();
  const [warn, setWarn] = useState(false);
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => { last.current = Date.now(); };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(async () => {
      const idle = Date.now() - last.current;
      const limit = minutes * 60000;
      if (idle > limit) {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login?expired=1";
      } else setWarn(idle > limit - 60000);
    }, 5000);
    // keep the server session alive while the user is active
    const ping = setInterval(() => { if (Date.now() - last.current < 120000) fetch("/api/auth/ping", { method: "POST" }).catch(() => {}); }, 120000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(id); clearInterval(ping); };
  }, [minutes]);
  if (!warn) return null;
  return (
    <div className="no-print fixed inset-x-0 top-0 z-[90] flex flex-wrap items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-900 shadow">
      {t("common.sessionExpiring")}
      <Button size="sm" onClick={() => { fetch("/api/auth/ping", { method: "POST" }); setWarn(false); }}>{t("common.stay")}</Button>
    </div>
  );
}
