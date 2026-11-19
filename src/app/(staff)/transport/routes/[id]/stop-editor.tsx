"use client";
import { useState } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { Button, Field, FormGrid, Input } from "@/components/ui";
import { ActionForm, Modal } from "@/components/ui/client";
import { TransportMap, type MapMarker } from "../../_components/map";
import { saveStopAction } from "../../actions";

export type StopRow = { id: string; name: string; sequence: number; lat: number | null; lng: number | null; pickupTime: string | null; dropTime: string | null; distanceKm: number; feeAmount: number | null };

/** Add / edit a stop: click on the map to set its latitude & longitude. */
export function StopEditor({ routeId, stop, others, nextSeq }: { routeId: string; stop?: StopRow; others: StopRow[]; nextSeq: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(stop?.lat != null && stop?.lng != null ? { lat: stop.lat, lng: stop.lng } : null);
  const markers: MapMarker[] = [
    ...others.filter((o) => o.id !== stop?.id && o.lat !== null && o.lng !== null).map((o) => ({ id: o.id, lat: o.lat!, lng: o.lng!, label: `${o.sequence}. ${o.name}`, text: String(o.sequence), color: "#94a3b8" })),
    ...(pos ? [{ id: "new", lat: pos.lat, lng: pos.lng, label: stop?.name ?? "New stop", text: "+", color: "#4f46e5", highlight: true }] : []),
  ];
  return (
    <>
      {stop
        ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Edit stop"><Pencil className="size-4" /></Button>
        : <Button onClick={() => setOpen(true)}><Plus className="size-4" />Add stop</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={stop ? `Edit ${stop.name}` : "Add stop"} size="xl">
        {open && (
          <ActionForm action={saveStopAction} successMessage={stop ? "Stop updated" : "Stop added"} extra={{ routeId, id: stop?.id, lat: pos?.lat, lng: pos?.lng }}
            onSuccess={() => { setOpen(false); if (!stop) setPos(null); }}
            cancel={<Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>}>
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-2">
                <Field label="Stop name" required><Input name="name" defaultValue={stop?.name} required /></Field>
                <FormGrid>
                  <Field label="Sequence" hint="Position on the route"><Input name="sequence" type="number" min={1} defaultValue={stop?.sequence ?? nextSeq} /></Field>
                  <Field label="Distance (km)" required hint="From school"><Input name="distanceKm" type="number" step="0.1" min={0} defaultValue={stop?.distanceKm ?? 0} required /></Field>
                  <Field label="Pickup time"><Input name="pickupTime" type="time" defaultValue={stop?.pickupTime ?? ""} /></Field>
                  <Field label="Drop time"><Input name="dropTime" type="time" defaultValue={stop?.dropTime ?? ""} /></Field>
                </FormGrid>
                <Field label="Stop fee (per term)" hint="Used in STOP fee mode; in DISTANCE mode the slab applies and this is the fallback."><Input name="feeAmount" type="number" step="1" min={0} defaultValue={stop?.feeAmount ?? ""} /></Field>
                <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="size-4 text-brand-600" />{pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : "Click on the map to place the stop."}</p>
                {pos && <Button type="button" variant="link" onClick={() => setPos(null)}>Clear location</Button>}
              </div>
              <div className="lg:col-span-3">
                <TransportMap markers={markers} height={360} onPick={(lat, lng) => setPos({ lat, lng })} fitKey={stop?.id ?? "new"} />
              </div>
            </div>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
