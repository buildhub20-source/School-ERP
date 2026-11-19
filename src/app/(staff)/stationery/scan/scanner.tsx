"use client";
import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, Minus, Plus, Search } from "lucide-react";
import { Button, Input, Select, Badge } from "@/components/ui";
import { useAction, useToast } from "@/components/ui/client";
import { lookupCode, scanMove } from "../actions";

type Item = { id: string; code: string; name: string; unit: string; currentStock: number; reorderLevel: number; unitCost: number; isActive: boolean };
type Opt = { id: string; name: string };

const IN_KINDS = [{ value: "PURCHASE", label: "Received (no PO)" }, { value: "RETURN", label: "Returned" }, { value: "ADJUST_IN", label: "Adjustment +" }];
const OUT_KINDS = [{ value: "ISSUE", label: "Issued" }, { value: "DAMAGE", label: "Damaged" }, { value: "LOSS", label: "Lost" }, { value: "ADJUST_OUT", label: "Adjustment −" }];

/** Phone-camera scanner for item QR/barcodes, then stock in/out a quantity. Manual code entry works without a camera. */
export function Scanner({ staff, classes }: { staff: Opt[]; classes: Opt[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const busy = useRef(false);
  const [on, setOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [item, setItem] = useState<Item | null>(null);
  const [dir, setDir] = useState<"in" | "out">("out");
  const [kind, setKind] = useState("ISSUE");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const [classId, setClassId] = useState("");
  const [log, setLog] = useState<{ t: string; text: string }[]>([]);
  const toast = useToast();

  const lookup = useAction(lookupCode, { refresh: false, onSuccess: (d: Item) => { setItem(d); setQty("1"); } });
  const move = useAction(scanMove, {
    refresh: false,
    onSuccess: (d: { currentStock: number }) => {
      if (!item) return;
      const n = Number(qty);
      setLog((l) => [{ t: new Date().toLocaleTimeString("en-IN"), text: `${dir === "in" ? "+" : "−"}${n} ${item.unit} ${item.name} → stock ${d.currentStock}` }, ...l].slice(0, 20));
      toast.success(`${item.name}: stock is now ${d.currentStock}`);
      setItem({ ...item, currentStock: d.currentStock });
      setNote("");
    },
  });

  const find = async (c: string) => {
    const v = c.trim();
    if (!v) return;
    setCode(v);
    await lookup.run({ code: v });
  };

  const stop = () => { controls.current?.stop(); controls.current = null; setOn(false); };
  const start = async () => {
    setCamError(null);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      controls.current = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (result) => {
        if (!result || busy.current) return;
        busy.current = true;
        if (navigator.vibrate) navigator.vibrate(80);
        find(result.getText()).finally(() => setTimeout(() => { busy.current = false; }, 1500));
      });
      setOn(true);
    } catch (e) {
      setCamError(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access or type the code below." : "No camera available (it needs HTTPS or localhost). Type the code below instead.");
      setOn(false);
    }
  };
  useEffect(() => () => controls.current?.stop(), []);

  const kinds = dir === "in" ? IN_KINDS : OUT_KINDS;
  const n = Number(qty);
  const over = dir === "out" && item && n > item.currentStock;
  const submit = () => {
    if (!item) return;
    move.run({ itemId: item.id, kind, qty, note: note || undefined, ...(kind === "ISSUE" || kind === "RETURN" ? (who ? { recipientType: "TEACHER", recipientUserId: who, classId: classId || undefined } : classId ? { recipientType: "CLASS", classId } : { recipientType: "OTHER" }) : {}) });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
          <video ref={video} className="size-full object-cover" muted playsInline />
          {!on && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">{camError ?? "Point the phone camera at an item label."}</div>}
          {on && <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {on ? <Button variant="secondary" onClick={stop}><CameraOff className="size-4" />Stop camera</Button> : <Button onClick={start}><Camera className="size-4" />Start camera</Button>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(code); }}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Or type / scan item code, e.g. STN-0001" className="font-mono uppercase" autoCapitalize="characters" aria-label="Item code" />
          <Button type="submit" variant="secondary" loading={lookup.pending}><Search className="size-4" />Find</Button>
        </form>
      </div>

      <div className="space-y-4">
        {!item ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Scan a label or enter a code to load the item.</div>
        ) : (
          <div className="space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900">{item.name}</p>
                <p className="font-mono text-xs text-slate-500">{item.code}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">{item.currentStock}</p>
                <p className="text-xs text-slate-500">{item.unit} in stock</p>
                {item.reorderLevel > 0 && item.currentStock <= item.reorderLevel && <Badge tone="red">Low</Badge>}
                {!item.isActive && <Badge>Inactive</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              <button type="button" onClick={() => { setDir("in"); setKind("PURCHASE"); }} className={`rounded-md py-2 text-sm font-medium ${dir === "in" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Stock in</button>
              <button type="button" onClick={() => { setDir("out"); setKind("ISSUE"); }} className={`rounded-md py-2 text-sm font-medium ${dir === "out" ? "bg-rose-600 text-white" : "text-slate-600"}`}>Stock out</button>
            </div>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Reason">{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="lg" aria-label="Less" onClick={() => setQty(String(Math.max(1, n - 1)))}><Minus className="size-4" /></Button>
              <Input type="number" min={1} step={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 text-center text-lg" aria-label="Quantity" />
              <Button type="button" variant="secondary" size="lg" aria-label="More" onClick={() => setQty(String(n + 1))}><Plus className="size-4" /></Button>
            </div>
            {over && <p className="text-sm text-rose-600">Only {item.currentStock} {item.unit} in stock.</p>}
            {(kind === "ISSUE" || kind === "RETURN") && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Teacher"><option value="">{kind === "ISSUE" ? "To teacher (optional)" : "From teacher (optional)"}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class"><option value="">Charge to class (optional)</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              </div>
            )}
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind.startsWith("ADJUST") || kind === "DAMAGE" || kind === "LOSS" ? "Note (required)" : "Note (optional)"} maxLength={300} aria-label="Note" />
            <Button className="w-full" size="lg" variant={dir === "in" ? "success" : "danger"} loading={move.pending} disabled={!n || n < 1 || !!over} onClick={submit}>
              {dir === "in" ? "Add" : "Remove"} {n || 0} {item.unit}
            </Button>
          </div>
        )}
        {log.length > 0 && (
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">This session</p>
            <ul className="space-y-1 text-sm">{log.map((l, i) => <li key={i}><span className="text-slate-400">{l.t}</span> {l.text}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
