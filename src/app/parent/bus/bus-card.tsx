"use client";
import { useEffect, useState } from "react";
import { Phone, Bus, Clock, MapPin } from "lucide-react";
import { Badge, Card, CardBody } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";
import { TransportMap, type MapMarker } from "@/app/(staff)/transport/_components/map";

export type BusInfo = {
  busNo: string; registrationNo: string; routeName: string; routeCode: string;
  stop: { id: string; name: string; lat: number | null; lng: number | null; pickupTime: string | null; dropTime: string | null };
  routeStops: { id: string; name: string; lat: number; lng: number }[];
  driver: { name: string; phone: string } | null; attendant: { name: string; phone: string } | null;
  trip: { type: string; startedAt: string } | null;
  location: { lat: number; lng: number; at: string } | null;
  lastBoarding: { event: string; at: string; tripType: string } | null;
};

const hm = (s: string) => new Date(s).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

export function BusCard({ studentId, childName, initial }: { studentId: string; childName: string; initial: BusInfo }) {
  const t = useT();
  const [info, setInfo] = useState(initial);
  const [updated, setUpdated] = useState(new Date().toISOString());
  useEffect(() => {
    const load = () => fetch(`/api/transport/parent/${studentId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.bus) { setInfo(d.bus); setUpdated(d.at); } }).catch(() => {});
    const id = setInterval(load, info.trip ? 15000 : 60000);
    return () => clearInterval(id);
  }, [studentId, info.trip]);

  const markers: MapMarker[] = [
    ...info.routeStops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.name, text: s.id === info.stop.id ? "★" : "", color: "#94a3b8", highlight: s.id === info.stop.id })),
    ...(info.location ? [{ id: "bus", kind: "bus" as const, lat: info.location.lat, lng: info.location.lng, text: info.busNo, color: "#059669", label: info.busNo, sub: fill(t("parent.updatedAt"), { time: hm(info.location.at) }) }] : []),
  ];
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{childName}</p>
            <p className="flex items-center gap-2 text-lg font-semibold"><Bus className="size-5 text-brand-600" />{info.busNo} <span className="text-sm font-normal text-slate-500">{info.registrationNo}</span></p>
            <p className="text-sm text-slate-600">{info.routeCode} · {info.routeName}</p>
          </div>
          {info.trip ? <Badge tone="green">{info.trip.type === "PICKUP" ? t("driver.pickupTrip") : t("driver.dropTrip")}</Badge> : <Badge>{t("parent.notRunning")}</Badge>}
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <p className="flex items-center gap-2"><MapPin className="size-4 text-slate-400" />{t("parent.stop")}: <b>{info.stop.name}</b></p>
          <p className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />{t("parent.pickup")}: <b>{info.stop.pickupTime ?? "—"}</b></p>
          <p className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />{t("parent.drop")}: <b>{info.stop.dropTime ?? "—"}</b></p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {info.driver && <a href={`tel:${info.driver.phone}`} className="flex h-12 items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm"><Phone className="size-4" />{t("parent.driver")}: {info.driver.name}<span className="ml-auto font-mono">{info.driver.phone}</span></a>}
          {info.attendant && <a href={`tel:${info.attendant.phone}`} className="flex h-12 items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm"><Phone className="size-4" />{t("parent.attendant")}: {info.attendant.name}<span className="ml-auto font-mono">{info.attendant.phone}</span></a>}
        </div>
        {info.lastBoarding && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
            {fill(t(info.lastBoarding.event === "BOARDED" ? "parent.lastBoarded" : "parent.lastAlighted"), { name: childName, trip: t(info.lastBoarding.tripType === "PICKUP" ? "parent.tripPickup" : "parent.tripDrop") })} · {hm(info.lastBoarding.at)}
          </p>
        )}
        {info.trip ? (
          info.location
            ? <><TransportMap markers={markers} height={300} fitKey={info.location ? "bus" : "stops"} /><p className="text-xs text-slate-500">{fill(t("parent.liveStatus"), { loc: hm(info.location.at), ref: hm(updated) })}</p></>
            : <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("parent.waitingLocation")}</p>
        ) : <p className="text-sm text-slate-500">{t("parent.liveHint")}</p>}
      </CardBody>
    </Card>
  );
}
