"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, UserPlus, ArrowRightLeft, X } from "lucide-react";
import { Button, Checkbox, Field, FormGrid, Input, Select } from "@/components/ui";
import { ActionForm, Modal } from "@/components/ui/client";
import { allocateAction, changeAllocationAction } from "../actions";

export type RouteOpt = { id: string; code: string; name: string; busId: string | null; stops: { id: string; name: string; sequence: number; pickupTime: string | null; fee: number | null }[] };
export type BusOpt = { id: string; busNo: string; capacity: number; taken: number };
type StudentHit = { id: string; name: string; admissionNo: string; className: string; address: string | null; currentBus: string | null };

function TargetFields({ routes, buses, policy, initial, showFees }: { routes: RouteOpt[]; buses: BusOpt[]; policy: "BLOCK" | "WARN"; initial?: { routeId: string; stopId: string; busId: string }; showFees: boolean }) {
  const [routeId, setRouteId] = useState(initial?.routeId ?? "");
  const [stopId, setStopId] = useState(initial?.stopId ?? "");
  const route = routes.find((r) => r.id === routeId);
  const [busId, setBusId] = useState(initial?.busId ?? "");
  const effectiveBus = buses.find((b) => b.id === (busId || route?.busId));
  const full = effectiveBus ? effectiveBus.taken >= effectiveBus.capacity : false;
  return (
    <>
      <FormGrid>
        <Field label="Route" required>
          <Select name="routeId" value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(""); setBusId(""); }} placeholder="Choose route" required>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
          </Select>
        </Field>
        <Field label="Pickup stop" required>
          <Select name="stopId" value={stopId} onChange={(e) => setStopId(e.target.value)} placeholder={route ? "Choose stop" : "Choose a route first"} required disabled={!route}>
            {route?.stops.map((s) => <option key={s.id} value={s.id}>{s.sequence}. {s.name}{s.pickupTime ? ` (${s.pickupTime})` : ""}{showFees && s.fee !== null ? ` · ₹${s.fee}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Bus" hint={route?.busId ? "Defaults to the route's bus" : "This route has no bus — choose one"}>
          <Select name="busId" value={busId} onChange={(e) => setBusId(e.target.value)} placeholder={route?.busId ? `Route bus (${buses.find((b) => b.id === route.busId)?.busNo ?? ""})` : "Choose bus"}>
            {buses.map((b) => <option key={b.id} value={b.id}>{b.busNo} — {b.taken}/{b.capacity} seats{b.taken >= b.capacity ? " (FULL)" : ""}</option>)}
          </Select>
        </Field>
        {effectiveBus && (
          <div className={"self-end rounded-lg px-3 py-2 text-sm " + (full ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
            {effectiveBus.busNo}: {effectiveBus.taken}/{effectiveBus.capacity} seats filled{full ? (policy === "BLOCK" ? " — full, allocation will be blocked" : " — full") : ""}
          </div>
        )}
      </FormGrid>
      {policy === "WARN" && full && <Checkbox name="override" value="true" label="Allocate anyway (over capacity)" />}
    </>
  );
}

export function AllocateForm({ routes, buses, policy, initialStudent, today, showFees }: { routes: RouteOpt[]; buses: BusOpt[]; policy: "BLOCK" | "WARN"; initialStudent?: StudentHit | null; today: string; showFees: boolean }) {
  const [open, setOpen] = useState(!!initialStudent && !initialStudent.currentBus);
  const [student, setStudent] = useState<StudentHit | null>(initialStudent ?? null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/transport/students?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setHits(d.students ?? [])).catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  return (
    <>
      <Button onClick={() => setOpen(true)}><UserPlus className="size-4" />Assign student</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Assign student to a bus" description="The transport fee is added to the student's fee account automatically." size="lg">
        {open && (
          <ActionForm action={allocateAction} submitLabel="Allocate seat" extra={{ studentId: student?.id ?? "" }}
            successMessage={(d) => `Seat allocated${d.feeLines ? ` · ${d.feeLines} fee line(s) added` : ""}${d.warning ? ` · ${d.warning}` : ""}`}
            onSuccess={() => { setOpen(false); setStudent(null); setQ(""); }}
            cancel={<Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>}>
            <Field label="Student" required>
              {student ? (
                <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <div><p className="font-medium">{student.name} <span className="text-slate-500">· {student.admissionNo}</span></p><p className="text-xs text-slate-500">{student.className}{student.address ? ` · ${student.address}` : ""}</p>
                    {student.currentBus && <p className="text-xs text-amber-700">Already on {student.currentBus} — use Change in the list instead.</p>}</div>
                  <button type="button" onClick={() => setStudent(null)} className="text-slate-400 hover:text-slate-600" aria-label="Clear"><X className="size-4" /></button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or admission no" className="pl-8" autoFocus />
                  {hits.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {hits.map((h) => (
                        <li key={h.id}><button type="button" onClick={() => { setStudent(h); setHits([]); }} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span className="font-medium">{h.name}</span> <span className="text-slate-500">· {h.admissionNo} · {h.className}</span>{h.currentBus && <span className="ml-1 text-xs text-amber-700">(on {h.currentBus})</span>}
                        </button></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
            <TargetFields routes={routes} buses={buses} policy={policy} showFees={showFees} />
            <Field label="Start date" hint="Fees are added for the terms from this date"><Input type="date" name="startDate" defaultValue={today} /></Field>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}

export function ChangeForm({ allocation, routes, buses, policy, today, showFees }: { allocation: { id: string; routeId: string; stopId: string; busId: string; student: string }; routes: RouteOpt[]; buses: BusOpt[]; policy: "BLOCK" | "WARN"; today: string; showFees: boolean }) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => ({ routeId: allocation.routeId, stopId: allocation.stopId, busId: allocation.busId }), [allocation]);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><ArrowRightLeft className="size-3.5" />Change</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Change stop / bus — ${allocation.student}`} description="The current allocation ends the day before the change date and a new one starts." size="lg">
        {open && (
          <ActionForm action={changeAllocationAction} submitLabel="Change" extra={{ allocationId: allocation.id }}
            successMessage={(d) => `Allocation changed${d.warning ? ` · ${d.warning}` : ""}`} onSuccess={() => setOpen(false)}
            cancel={<Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>}>
            <TargetFields routes={routes} buses={buses} policy={policy} initial={initial} showFees={showFees} />
            <Field label="Change from"><Input type="date" name="changeDate" defaultValue={today} /></Field>
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
