"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, useMapEvents } from "react-leaflet";
import type { MapProps } from "./map";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function icon(kind: string, color: string, text: string, highlight?: boolean) {
  if (kind === "bus") {
    return L.divIcon({
      className: "", iconSize: undefined, iconAnchor: [20, 14],
      html: `<div style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;background:${color};color:#fff;border:2px solid #fff;border-radius:9999px;padding:2px 8px;font:600 11px/1.4 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 6v6M16 6v6M2 12h20M7 18h10M4 18V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>${esc(text)}</div>`,
    });
  }
  const size = highlight ? 26 : 20;
  return L.divIcon({
    className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${highlight ? "#f59e0b" : "#fff"};border:3px solid ${color};color:#0f172a;display:grid;place-items:center;font:700 10px system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.35)">${esc(text)}</div>`,
  });
}

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 14));
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6) });
  return null;
}

export default function LeafletMap({ markers, lines = [], height = 420, onPick, center, fitKey, className }: MapProps) {
  const points = useMemo(() => [...markers.map((m) => [m.lat, m.lng] as [number, number]), ...lines.flatMap((l) => l.points)], [markers, lines]);
  const start: [number, number] = center ?? points[0] ?? [13.0827, 80.2707]; // Chennai
  const key = fitKey ?? String(points.length);
  return (
    <div className={"isolate overflow-hidden rounded-lg border border-slate-200 " + (className ?? "")} style={{ height }}>
      <MapContainer center={start} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }} className={onPick ? "cursor-crosshair" : undefined}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {lines.map((l) => <Polyline key={l.id} positions={l.points} pathOptions={{ color: l.color, weight: 4, opacity: 0.8, dashArray: l.dashed ? "6 8" : undefined }} />)}
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={icon(m.kind ?? "stop", m.color ?? "#4f46e5", m.text ?? "", m.highlight)} zIndexOffset={m.kind === "bus" ? 1000 : m.highlight ? 500 : 0}>
            <Popup><div className="text-sm"><p className="font-semibold">{m.label}</p>{m.sub && <p className="whitespace-pre-line text-slate-600">{m.sub}</p>}</div></Popup>
          </Marker>
        ))}
        {onPick && <ClickPicker onPick={onPick} />}
        <FitBounds points={points} fitKey={key} />
      </MapContainer>
    </div>
  );
}
