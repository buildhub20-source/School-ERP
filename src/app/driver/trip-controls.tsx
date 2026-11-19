"use client";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ui/client";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";
import { endTripAction, startTripAction } from "./actions";

export function TripControls({ trip }: { trip: { id: string; type: string; startedAt: string } | null }) {
  const t = useT();
  const start = useAction(startTripAction, { successMessage: t("driver.tripStarted") });
  if (trip) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-slate-600">{trip.type === "PICKUP" ? t("driver.pickupTrip") : t("driver.dropTrip")} · {fill(t("driver.since"), { time: new Date(trip.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) })}</p>
        <ActionButton action={endTripAction} args={{ tripId: trip.id }} variant="danger" size="lg" className="h-14 w-full text-lg" confirm={`${t("driver.endTrip")}?`} successMessage={t("driver.tripEnded")}><Square className="size-5" />{t("driver.endTrip")}</ActionButton>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Button size="lg" className="h-16 text-lg" loading={start.pending} onClick={() => start.run({ type: "PICKUP" })}><Play className="size-5" />{t("driver.startTrip")}: {t("driver.pickupTrip")}</Button>
      <Button size="lg" variant="secondary" className="h-16 text-lg" loading={start.pending} onClick={() => start.run({ type: "DROP" })}><Play className="size-5" />{t("driver.startTrip")}: {t("driver.dropTrip")}</Button>
    </div>
  );
}
