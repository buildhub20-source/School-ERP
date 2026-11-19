"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui";
import { TransportMap, type MapLine, type MapMarker } from "../_components/map";

type LiveBus = { id: string; busNo: string; registrationNo: string; driver: string | null; driverPhone: string | null; routes: string; students: number; capacity: number; lat: number | null; lng: number | null; at: string | null; trip: { id: string; type: string; startedAt: string } | null };
const time = (s: string) => new Date(s).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const ago = (s: string) => { const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export function LiveView({ initial, stops }: { initial: LiveBus[]; stops: MapLine[] }) {
  const [buses, setBuses] = useState(initial);
  const [updated, setUpdated] = useState<string>(new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/transport/live", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not refresh");
      const d = await r.json(); setBuses(d.buses); setUpdated(d.at); setError(null);
    }).catch((e) => setError(e.message));
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  const markers: MapMarker[] = buses.filter((b) => b.lat !== null && b.lng !== null).map((b) => ({
    id: b.id, kind: "bus", lat: b.lat!, lng: b.lng!, text: b.busNo, color: b.trip ? "#059669" : "#64748b", label: `${b.busNo} · ${b.registrationNo}`,
    sub: `${b.trip ? `${b.trip.type === "PICKUP" ? "Pickup" : "Drop"} trip since ${time(b.trip.startedAt)}` : "No active trip"}\nLast seen ${b.at ? ago(b.at) : "—"}${b.driver ? `\nDriver ${b.driver}` : ""}`,
  }));
  const running = buses.filter((b) => b.trip).length;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <RefreshCw className="size-4" />Auto-refreshes every 15 s · updated {time(updated)} · {running} trip{running === 1 ? "" : "s"} running
        {error && <span className="text-rose-600">· {error}</span>}
      </div>
      <TransportMap markers={markers} lines={stops} height={460} fitKey={String(markers.length)} />
      <Card className="mt-5">
        <CardHeader title="Buses" />
        <Table>
          <THead><tr><TH>Bus</TH><TH>Routes</TH><TH>Driver</TH><TH>Trip</TH><TH>Last location</TH><TH align="right">Students</TH></tr></THead>
          <TBody>
            {buses.length === 0 && <EmptyRow colSpan={6} />}
            {buses.map((b) => (
              <TR key={b.id} highlight={b.trip ? "green" : undefined}>
                <TD className="font-medium">{b.busNo}<span className="block text-xs text-slate-500">{b.registrationNo}</span></TD>
                <TD>{b.routes || "—"}</TD>
                <TD>{b.driver ?? "—"}{b.driverPhone && <a href={`tel:${b.driverPhone}`} className="block text-xs text-brand-700">{b.driverPhone}</a>}</TD>
                <TD>{b.trip ? <><Badge tone="green">{b.trip.type === "PICKUP" ? "Pickup" : "Drop"}</Badge><span className="block text-xs text-slate-500">since {time(b.trip.startedAt)}</span></> : <Badge>Idle</Badge>}</TD>
                <TD>{b.at ? <>{ago(b.at)}<span className="block font-mono text-xs text-slate-500">{b.lat?.toFixed(4)}, {b.lng?.toFixed(4)}</span></> : "—"}</TD>
                <TD align="right">{b.students}/{b.capacity}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
