"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { cn } from "@/components/ui/cn";
import { saveRegisterAction } from "../actions";

type Status = "PRESENT" | "LATE" | "HALF_DAY" | "ABSENT" | "ON_LEAVE";
type Row = { staffId: string; name: string; sub: string; status: Status | null; detail?: string; note?: string };
const OPTIONS: { v: Status; l: string }[] = [{ v: "PRESENT", l: "Present" }, { v: "LATE", l: "Late" }, { v: "HALF_DAY", l: "Half" }, { v: "ABSENT", l: "Absent" }, { v: "ON_LEAVE", l: "Leave" }];
const ON: Record<Status, string> = { PRESENT: "bg-brand-300 text-on-brand", LATE: "bg-amber-500 text-white", HALF_DAY: "bg-sky-600 text-white", ABSENT: "bg-rose-500 text-white", ON_LEAVE: "bg-violet-600 text-white" };

/** Daily staff register: one tap per person. Unmarked people default to Present; saved rows keep their status. */
export function RegisterForm({ date, rows, readOnly }: { date: string; rows: Row[]; readOnly?: boolean }) {
  const [marks, setMarks] = useState<Record<string, Status>>(Object.fromEntries(rows.map((r) => [r.staffId, r.status ?? "PRESENT"])));
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.staffId, r.note ?? ""])));
  const save = useAction(saveRegisterAction, { successMessage: "@result" });
  const n = (s: Status) => Object.values(marks).filter((v) => v === s).length;
  const unsaved = rows.filter((r) => r.status === null).length;
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <li key={r.staffId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <span className="min-w-0 flex-1 basis-48">
              <span className="block text-sm font-medium text-ink">{r.name}{r.status === null && <span className="ml-2 text-[11px] font-normal text-amber-700">not saved</span>}</span>
              <span className="block truncate text-xs text-muted">{r.sub}{r.detail ? ` · ${r.detail}` : ""}</span>
            </span>
            <div role="radiogroup" aria-label={`${r.name} attendance`} className="inline-flex flex-wrap rounded-full border border-line bg-surface-2 p-0.5">
              {OPTIONS.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={marks[r.staffId] === o.v} disabled={readOnly}
                  onClick={() => setMarks((m) => ({ ...m, [r.staffId]: o.v }))}
                  className={cn("rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-default", marks[r.staffId] === o.v ? ON[o.v] : "text-muted hover:text-ink")}>
                  {o.l}
                </button>
              ))}
            </div>
            {(marks[r.staffId] !== "PRESENT" || notes[r.staffId]) && !readOnly && (
              <input aria-label={`Note for ${r.name}`} value={notes[r.staffId]} maxLength={200} placeholder="Note (optional)"
                onChange={(e) => setNotes((x) => ({ ...x, [r.staffId]: e.target.value }))}
                className="h-8 w-full rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink placeholder:text-muted/80 focus:border-brand-400 focus:outline-none sm:w-44" />
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-muted">
            {rows.length} staff · {n("PRESENT") + n("LATE")} present · <span className={n("ABSENT") ? "font-semibold text-rose-700" : ""}>{n("ABSENT")} absent</span> · {n("ON_LEAVE")} on leave
            {unsaved > 0 && <> · <span className="text-amber-700">{unsaved} not saved yet</span></>}
          </span>
          <Button loading={save.pending} onClick={() => save.run({ date, entries: JSON.stringify(rows.map((r) => ({ staffId: r.staffId, status: marks[r.staffId], note: notes[r.staffId] || undefined }))) })}>Save register</Button>
        </div>
      )}
    </div>
  );
}
