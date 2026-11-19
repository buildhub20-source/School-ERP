"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/client";
import { Field, FormGrid, Select, Textarea } from "@/components/ui";
import { recordStock } from "../actions";
import { LinesEditor, type ItemOpt } from "../_components/lines-editor";

type Opt = { id: string; name: string };
type Student = { id: string; name: string; admissionNo: string; classId: string; section: string };

const KINDS = [
  { value: "ISSUE", label: "Issue", hint: "Give items to a student, teacher, class or department. Stock goes down and the spend is charged to the class/department budget." },
  { value: "RETURN", label: "Return", hint: "Unused items handed back in good condition. Stock goes up and the budget is credited." },
  { value: "DAMAGE", label: "Damage", hint: "Items damaged in the store or returned damaged. Written off (stock goes down)." },
  { value: "LOSS", label: "Loss", hint: "Items lost or missing. Written off (stock goes down)." },
  { value: "ADJUST_IN", label: "Adjust +", hint: "Correct the stock upwards (e.g. counting error). Note required." },
  { value: "ADJUST_OUT", label: "Adjust −", hint: "Correct the stock downwards. Note required." },
];

export function IssueForm({ items, classes, departments, staff, students, defaultKind = "ISSUE" }: { items: ItemOpt[]; classes: Opt[]; departments: Opt[]; staff: Opt[]; students: Student[]; defaultKind?: string }) {
  const [kind, setKind] = useState(defaultKind);
  const [rtype, setRtype] = useState("STUDENT");
  const [classId, setClassId] = useState("");
  const [key, setKey] = useState(0);
  const withRecipient = kind === "ISSUE" || kind === "RETURN";
  const meta = KINDS.find((k) => k.value === kind)!;
  const classStudents = students.filter((s) => !classId || s.classId === classId);
  return (
    <ActionForm key={key} action={recordStock} submitLabel={`Record ${meta.label.toLowerCase()}`} successMessage={(d: { count: number }) => `${meta.label} recorded for ${d.count} item(s)`} onSuccess={() => setKey((k) => k + 1)}>
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {KINDS.map((k) => (
          <button key={k.value} type="button" onClick={() => setKind(k.value)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${kind === k.value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{k.label}</button>
        ))}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <p className="text-sm text-slate-500">{meta.hint}</p>
      {withRecipient && (
        <FormGrid>
          <Field label={kind === "ISSUE" ? "Issue to" : "Returned by"} required>
            <Select name="recipientType" value={rtype} onChange={(e) => setRtype(e.target.value)}>
              <option value="STUDENT">Student</option><option value="TEACHER">Teacher / staff</option><option value="CLASS">Whole class</option><option value="DEPARTMENT">Department</option>{kind === "RETURN" && <option value="OTHER">Other</option>}
            </Select>
          </Field>
          {(rtype === "STUDENT" || rtype === "CLASS" || rtype === "TEACHER") && (
            <Field label={rtype === "TEACHER" ? "Charge to class (optional)" : "Class"} required={rtype !== "TEACHER"}>
              <Select name="classId" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder={rtype === "TEACHER" ? "— Not charged to a class —" : "Choose class…"}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          {rtype === "STUDENT" && (
            <Field label="Student" required>
              <Select name="studentId" required placeholder={classId ? "Choose student…" : "Choose a class first"} disabled={!classId}>
                {classStudents.map((s) => <option key={s.id} value={s.id}>{s.name}{s.section ? ` (${s.section})` : ""} · {s.admissionNo}</option>)}
              </Select>
            </Field>
          )}
          {rtype === "TEACHER" && (
            <Field label="Teacher / staff" required>
              <Select name="recipientUserId" required placeholder="Choose…">{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
            </Field>
          )}
          {(rtype === "DEPARTMENT" || rtype === "TEACHER") && (
            <Field label={rtype === "TEACHER" ? "…or charge to department" : "Department"} required={rtype === "DEPARTMENT"}>
              <Select name="departmentId" required={rtype === "DEPARTMENT"} placeholder={rtype === "TEACHER" ? "— Not charged to a department —" : "Choose department…"}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
            </Field>
          )}
        </FormGrid>
      )}
      <Field label="Items" required>
        <LinesEditor items={items} showStock={kind !== "RETURN" && kind !== "ADJUST_IN"} />
      </Field>
      <Field label="Note" required={!withRecipient}><Textarea name="note" rows={2} maxLength={500} required={!withRecipient} placeholder={withRecipient ? "Optional" : "What happened?"} /></Field>
    </ActionForm>
  );
}
