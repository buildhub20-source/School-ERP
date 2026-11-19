"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { cn } from "@/components/ui/cn";
import { saveRollCallAction } from "../actions";

type Row = { studentId: string; name: string; room: string; status: "PRESENT" | "ABSENT" | "ON_LEAVE"; onPass: boolean };
const OPTIONS = [{ v: "PRESENT", l: "Present" }, { v: "ABSENT", l: "Absent" }, { v: "ON_LEAVE", l: "On leave" }] as const;

export function RollCallForm({ hostelId, date, session, rows }: { hostelId: string; date: string; session: string; rows: Row[] }) {
  const [marks, setMarks] = useState<Record<string, Row["status"]>>(Object.fromEntries(rows.map((r) => [r.studentId, r.status])));
  const save = useAction(saveRollCallAction, { successMessage: "@result" });
  const absent = Object.values(marks).filter((v) => v === "ABSENT").length;
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <li key={r.studentId} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">{r.name}</span><span className="block text-xs text-muted">Room {r.room}{r.onPass ? " · out on a pass" : ""}</span></span>
            <div role="radiogroup" aria-label={`${r.name} attendance`} className="inline-flex rounded-full border border-line bg-surface-2 p-0.5">
              {OPTIONS.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={marks[r.studentId] === o.v} onClick={() => setMarks((m) => ({ ...m, [r.studentId]: o.v }))}
                  className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150",
                    marks[r.studentId] === o.v ? (o.v === "ABSENT" ? "bg-rose-500 text-white" : o.v === "ON_LEAVE" ? "bg-sky-50 text-sky-700" : "bg-brand-300 text-on-brand") : "text-muted hover:text-ink")}>
                  {o.l}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-muted">{rows.length} residents · <span className={absent ? "font-semibold text-rose-700" : ""}>{absent} absent</span></span>
        <Button loading={save.pending} onClick={() => save.run({ hostelId, date, session, entries: JSON.stringify(Object.entries(marks).map(([studentId, status]) => ({ studentId, status }))) })}>Save roll call</Button>
      </div>
    </div>
  );
}
