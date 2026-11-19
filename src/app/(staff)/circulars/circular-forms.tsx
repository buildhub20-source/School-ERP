"use client";
import { useState } from "react";
import { ModalForm } from "@/components/ui/client";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { createCircular, saveEvent } from "./actions";

export function CircularForm({ classes }: { classes: { id: string; name: string }[] }) {
  const [aud, setAud] = useState("ALL_PARENTS");
  return (
    <ModalForm trigger="New circular" title="New circular" size="lg" action={createCircular} successMessage={(d) => (d.recipients ? `Sent to ${d.recipients} recipient(s)` : "Saved as draft")}>
      <FormGrid cols={2}>
        <Field label="Title" required className="sm:col-span-2"><Input name="title" required /></Field>
        <Field label="Message" required className="sm:col-span-2"><Textarea name="body" rows={5} required /></Field>
        <Field label="Title in Tamil (optional)" hint="Parents who chose Tamil receive the Tamil version." className="sm:col-span-2"><Input name="titleTa" lang="ta" /></Field>
        <Field label="Message in Tamil (optional)" className="sm:col-span-2"><Textarea name="bodyTa" rows={4} lang="ta" /></Field>
        <Field label="Type"><Select name="type"><option value="CIRCULAR">Circular</option><option value="HOLIDAY">Holiday</option><option value="EVENT">Event</option><option value="GREETING">Greeting</option></Select></Field>
        <Field label="Send to"><Select name="audience" value={aud} onChange={(e) => setAud(e.target.value)}><option value="ALL_PARENTS">All parents</option><option value="CLASSES">Parents of selected classes</option><option value="ALL_STAFF">All staff</option><option value="EVERYONE">Everyone</option></Select></Field>
      </FormGrid>
      {aud === "CLASSES" && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
          {classes.map((c) => <Checkbox key={c.id} name="classIds[]" value={c.id} label={c.name} />)}
        </div>
      )}
      <Checkbox name="sendNow" label="Send now (otherwise save as draft)" defaultChecked />
    </ModalForm>
  );
}

export function EventForm({ initial }: { initial?: { id: string; title: string; description: string; date: string; endDate: string; type: string; audience: string; notifyDaysBefore: number } }) {
  return (
    <ModalForm trigger={initial ? "Edit" : "Add"} triggerVariant={initial ? "ghost" : "primary"} triggerSize="sm" title={initial ? "Edit event" : "Add holiday or event"} action={saveEvent} extra={{ id: initial?.id }} successMessage="Saved">
      <FormGrid cols={2}>
        <Field label="Title" required className="sm:col-span-2"><Input name="title" defaultValue={initial?.title} required /></Field>
        <Field label="Type"><Select name="type" defaultValue={initial?.type ?? "HOLIDAY"}><option value="HOLIDAY">Holiday</option><option value="EVENT">Event</option></Select></Field>
        <Field label="Announce to"><Select name="audience" defaultValue={initial?.audience ?? "EVERYONE"}><option value="EVERYONE">Everyone</option><option value="ALL_PARENTS">All parents</option><option value="ALL_STAFF">All staff</option></Select></Field>
        <Field label="Date" required><Input type="date" name="date" defaultValue={initial?.date} required /></Field>
        <Field label="End date (optional)"><Input type="date" name="endDate" defaultValue={initial?.endDate} /></Field>
        <Field label="Announce how many days before"><Input type="number" name="notifyDaysBefore" defaultValue={initial?.notifyDaysBefore ?? 1} min={0} max={30} /></Field>
        <Field label="Details" className="sm:col-span-2"><Textarea name="description" defaultValue={initial?.description} rows={3} /></Field>
      </FormGrid>
    </ModalForm>
  );
}
