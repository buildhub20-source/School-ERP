"use client";
import { useState } from "react";
import { BellRing, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { cn } from "@/components/ui/cn";
import { saveStudentRegisterAction } from "../actions";

type Status = "PRESENT" | "LATE" | "HALF_DAY" | "ABSENT";
export type RegisterRow = { studentId: string; name: string; roll: string; admissionNo: string; status: Status | null; note?: string; parentTold: boolean };
const OPTIONS: { v: Status; l: string }[] = [{ v: "PRESENT", l: "Present" }, { v: "ABSENT", l: "Absent" }, { v: "LATE", l: "Late" }, { v: "HALF_DAY", l: "Half day" }];
const ON: Record<Status, string> = { PRESENT: "bg-brand-300 text-on-brand", LATE: "bg-amber-500 text-white", HALF_DAY: "bg-sky-600 text-white", ABSENT: "bg-rose-500 text-white" };

/** Class register: everyone starts as Present; tap the children who are absent, late or here for half the day, then save. */
export function StudentRegisterForm({ sectionId, date, rows, readOnly, isToday }: { sectionId: string; date: string; rows: RegisterRow[]; readOnly?: boolean; isToday: boolean }) {
  const initial = () => Object.fromEntries(rows.map((r) => [r.studentId, r.status ?? "PRESENT"])) as Record<string, Status>;
  const [marks, setMarks] = useState<Record<string, Status>>(initial);
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.studentId, r.note ?? ""])));
  const save = useAction(saveStudentRegisterAction, { successMessage: "@result" });
  const n = (s: Status) => Object.values(marks).filter((v) => v === s).length;
  const saved = rows.some((r) => r.status !== null);
  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
          <span>Everyone starts as <b className="text-ink">Present</b>. Tap only the children who are absent, late or here for half the day.{isToday && " Parents of absent children are told as soon as you save."}</span>
          <button type="button" onClick={() => setMarks(Object.fromEntries(rows.map((r) => [r.studentId, "PRESENT"])))} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><CheckCheck className="size-4" />Mark all present</button>
        </div>
      )}
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <li key={r.studentId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <span className="w-8 shrink-0 text-right font-mono text-xs text-muted">{r.roll || "—"}</span>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-sm font-medium text-ink">{r.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted">{r.admissionNo}{r.parentTold && <span className="inline-flex items-center gap-1 text-rose-700"><BellRing className="size-3" />parents told</span>}</span>
            </span>
            <div role="radiogroup" aria-label={`${r.name} attendance`} className="inline-flex flex-wrap rounded-full border border-line bg-surface-2 p-0.5">
              {OPTIONS.map((o) => (
                <button key={o.v} type="button" role="radio" aria-checked={marks[r.studentId] === o.v} disabled={readOnly}
                  onClick={() => setMarks((m) => ({ ...m, [r.studentId]: o.v }))}
                  className={cn("min-h-9 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 disabled:cursor-default", marks[r.studentId] === o.v ? ON[o.v] : "text-muted hover:text-ink")}>
                  {o.l}
                </button>
              ))}
            </div>
            {(marks[r.studentId] !== "PRESENT" || notes[r.studentId]) && !readOnly && (
              <input aria-label={`Reason for ${r.name}`} value={notes[r.studentId]} maxLength={200} placeholder="Reason (optional)"
                onChange={(e) => setNotes((x) => ({ ...x, [r.studentId]: e.target.value }))}
                className="h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-xs text-ink placeholder:text-muted/80 focus:border-brand-400 focus:outline-none sm:w-48" />
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-1 py-3">
          <span className="text-sm text-muted">
            {rows.length} students · {n("PRESENT") + n("LATE") + n("HALF_DAY")} present · <span className={n("ABSENT") ? "font-semibold text-rose-700" : ""}>{n("ABSENT")} absent</span>
            {n("LATE") > 0 && <> · {n("LATE")} late</>}
          </span>
          <Button size="lg" loading={save.pending}
            onClick={() => save.run({ sectionId, date, entries: JSON.stringify(rows.map((r) => ({ studentId: r.studentId, status: marks[r.studentId], note: notes[r.studentId] || undefined }))) })}>
            {saved ? "Save changes" : "Save attendance"}
          </Button>
        </div>
      )}
    </div>
  );
}
