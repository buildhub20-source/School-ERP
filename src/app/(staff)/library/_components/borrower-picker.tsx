"use client";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export type Borrower = { value: string; label: string; sub: string; loans: number; overdue: boolean };

/** Borrower picker: type a name or admission number, pick a student or staff member. */
export function BorrowerPicker({ value, onChange, autoFocus }: { value: Borrower | null; onChange: (h: Borrower | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Borrower[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      const r = await fetch(`/api/library/borrowers?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).catch(() => null);
      if (r?.ok) setHits((await r.json()).results);
    }, 200);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-2.5">
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{value.label}</span><span className="block truncate text-xs text-muted">{value.sub} · {value.loans} book{value.loans === 1 ? "" : "s"} out{value.overdue ? " · has an overdue book" : ""}</span></span>
        <button type="button" onClick={() => onChange(null)} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Change borrower"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a student name, admission no or staff name" className="pl-10" aria-label="Borrower" autoFocus={autoFocus} />
      {hits.length > 0 && (
        <ul className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface py-1.5 shadow-2xl">
          {hits.map((h) => (
            <li key={h.value}>
              <button type="button" onClick={() => { onChange(h); setQ(""); setHits([]); }} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{h.label}</span><span className="block truncate text-xs text-muted">{h.sub}</span></span>
                <span className={cn("shrink-0 text-xs", h.overdue ? "text-rose-700" : "text-muted")}>{h.loans} out{h.overdue ? " · overdue" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
