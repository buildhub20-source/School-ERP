"use client";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui";

type Hit = { value: string; label: string; sub: string; resident: boolean };

/** Search students by name or admission number; writes the chosen student's id into a hidden input `name`. */
export function StudentPicker({ name = "studentId", residentsOnly = false }: { name?: string; residentsOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      const r = await fetch(`/api/hostel/students?q=${encodeURIComponent(q)}${residentsOnly ? "&residents=1" : ""}`, { signal: ctl.signal }).catch(() => null);
      if (r?.ok) setHits((await r.json()).results);
    }, 200);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, residentsOnly]);
  return (
    <div className="relative">
      <input type="hidden" name={name} value={picked?.value ?? ""} />
      {picked ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-2">
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{picked.label}</span><span className="block truncate text-xs text-muted">{picked.sub}</span></span>
          <button type="button" onClick={() => setPicked(null)} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Change student"><X className="size-4" /></button>
        </div>
      ) : (
        <>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student name or admission no" className="pl-10" aria-label="Student" />
          {hits.length > 0 && (
            <ul className="absolute inset-x-0 top-12 z-20 max-h-64 overflow-y-auto rounded-2xl border border-line bg-surface py-1.5 shadow-2xl">
              {hits.map((h) => (
                <li key={h.value}><button type="button" onClick={() => { setPicked(h); setQ(""); setHits([]); }} className="block w-full px-4 py-2 text-left hover:bg-surface-2"><span className="block truncate text-sm font-medium text-ink">{h.label}</span><span className="block truncate text-xs text-muted">{h.sub}</span></button></li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
