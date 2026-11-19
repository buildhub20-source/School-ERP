"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/client";
import { Button, Checkbox, Field, Input } from "@/components/ui";
import { sendAttendanceReportAction } from "../actions";

export type ReportSection = { sectionId: string; label: string; students: number; marked: number; present: number; absent: number; hasTeacher: boolean };

const GROUPS = [
  { key: "admins", label: "Admins", hint: "Whole-school summary with every class and the absent list" },
  { key: "teachers", label: "Class teachers", hint: "Each teacher gets their own class: counts and absent names" },
  { key: "staff", label: "All other staff", hint: "Whole-school summary" },
  { key: "absentParents", label: "Parents of absent students", hint: "“<child> was absent on <date>”" },
  { key: "presentParents", label: "Parents of present students", hint: "“<child> was present at school on <date>” (late / half day said so)" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

export function ReportForm({ date, sections, admins, staff }: { date: string; sections: ReportSection[]; admins: number; staff: number }) {
  const router = useRouter();
  const markable = sections.filter((s) => s.marked > 0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(markable.map((s) => s.sectionId)));
  const [groups, setGroups] = useState<Record<GroupKey, boolean>>({ admins: true, teachers: true, staff: false, absentParents: false, presentParents: false });
  const [skipAlerted, setSkipAlerted] = useState(true);
  const chosen = useMemo(() => markable.filter((s) => picked.has(s.sectionId)), [markable, picked]);
  const reach: Record<GroupKey, number> = {
    admins, staff,
    teachers: chosen.filter((s) => s.hasTeacher).length,
    absentParents: chosen.reduce((a, s) => a + s.absent, 0),
    presentParents: chosen.reduce((a, s) => a + s.present, 0),
  };
  const unit: Record<GroupKey, string> = { admins: "people", staff: "people", teachers: "teachers", absentParents: "students' parents", presentParents: "students' parents" };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <ActionForm action={sendAttendanceReportAction} submitLabel="Send report" successMessage="@result"
      extra={{ ...Object.fromEntries(GROUPS.map((g) => [g.key, groups[g.key]])), skipAlerted }}>
      <div className="space-y-6">
        <Field label="Date" hint="Change the date to send the report for another day">
          <Input name="date" type="date" value={date} max={new Date().toISOString().slice(0, 10)} className="max-w-xs"
            onChange={(e) => e.target.value && router.push(`/attendance/report?date=${e.target.value}`)} />
        </Field>

        <Field label="Send to" required hint="Tick one or more groups. Everyone gets it in the app and on their usual channel.">
          <div className="divide-y divide-line/60 rounded-lg border border-line">
            {GROUPS.map((g) => (
              <div key={g.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div>
                  <Checkbox label={<span className="font-medium">{g.label}</span>} checked={groups[g.key]} onChange={(e) => setGroups({ ...groups, [g.key]: e.target.checked })} />
                  <p className="ml-6 text-xs text-slate-500">{g.hint}</p>
                  {g.key === "absentParents" && groups.absentParents && (
                    <div className="ml-6 mt-1"><Checkbox label={<span className="text-xs">Skip parents who were already alerted when the register was saved</span>} checked={skipAlerted} onChange={(e) => setSkipAlerted(e.target.checked)} /></div>
                  )}
                </div>
                <span className="text-sm text-slate-500">{reach[g.key]} {unit[g.key]}</span>
              </div>
            ))}
          </div>
        </Field>

        <Field label="Classes" required hint="Only classes whose attendance is marked for this day can be included.">
          <div className="mb-2 flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set(markable.map((s) => s.sectionId)))}>Tick all</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
          <div className="grid gap-x-4 gap-y-1 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <div key={s.sectionId} className="flex items-center justify-between gap-2 py-1">
                <Checkbox label={s.label} disabled={s.marked === 0} checked={picked.has(s.sectionId)} onChange={() => toggle(s.sectionId)} />
                <span className="text-xs text-slate-500">{s.marked === 0 ? "Not marked" : `${s.present} P · ${s.absent} A`}</span>
              </div>
            ))}
          </div>
          {[...picked].map((id) => <input key={id} type="hidden" name="sectionIds[]" value={id} />)}
          <p className="mt-1 text-sm text-slate-500">{chosen.length} class{chosen.length === 1 ? "" : "es"} chosen</p>
        </Field>

        <Field label="Also send by" hint="Optional. In-app is always sent; these are added on top of each person's usual channel.">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox name="channels[]" value="SMS" label="SMS" />
            <Checkbox name="channels[]" value="WHATSAPP" label="WhatsApp" />
            <Checkbox name="channels[]" value="EMAIL" label="Email" />
          </div>
        </Field>
      </div>
    </ActionForm>
  );
}
