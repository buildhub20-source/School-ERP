"use client";
import dynamic from "next/dynamic";

export type MapMarker = { id: string; lat: number; lng: number; label: string; sub?: string; color?: string; kind?: "stop" | "bus"; text?: string; highlight?: boolean };
export type MapLine = { id: string; points: [number, number][]; color: string; dashed?: boolean };
export type MapProps = {
  markers: MapMarker[];
  lines?: MapLine[];
  height?: number;
  onPick?: (lat: number, lng: number) => void;
  center?: [number, number];
  /** Change this to re-fit the map to the markers (otherwise it fits once, and when the number of points changes). */
  fitKey?: string;
  className?: string;
};

/** OpenStreetMap map (Leaflet), rendered on the client only. */
export const TransportMap = dynamic<MapProps>(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="grid h-64 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-400">Loading map…</div>,
});
