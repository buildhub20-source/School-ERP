"use client";
import { useState } from "react";

const SKIP = new Set(["updatedAt", "createdAt", "id"]);
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function AuditDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !SKIP.has(k));
  const changed = before && after ? keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])) : keys;
  if (!changed.length) return <span className="text-xs text-slate-400">—</span>;
  const summary = before && after ? `${changed.length} field${changed.length > 1 ? "s" : ""}: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? "…" : ""}` : after ? "New record" : "Removed record";
  return (
    <div className="max-w-md text-xs">
      <button onClick={() => setOpen(!open)} className="text-left text-brand-700 hover:underline">{summary}</button>
      {open && (
        <table className="mt-1 w-full">
          <tbody>
            {changed.map((k) => (
              <tr key={k} className="align-top">
                <td className="pr-2 font-medium text-slate-600">{k}</td>
                {before && <td className="break-all pr-2 text-rose-700 line-through">{show(before[k])}</td>}
                <td className="break-all text-emerald-700">{after ? show(after[k]) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
