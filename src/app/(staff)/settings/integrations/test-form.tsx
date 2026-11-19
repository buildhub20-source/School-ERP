"use client";
import { ActionForm } from "@/components/ui/client";
import { Field, FormGrid, Input, Select } from "@/components/ui";
import { sendTestMessage } from "../actions";

export function TestMessageForm() {
  return (
    <ActionForm action={sendTestMessage} submitLabel="Send test" successMessage={(r) => (r.status === "SENT" ? "Sent" : r.status === "SANDBOX" ? "Logged to the outbox (sandbox mode)" : `Failed: ${r.error ?? "unknown error"}`)}>
      <FormGrid cols={2}>
        <Field label="Channel"><Select name="channel"><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option></Select></Field>
        <Field label="To (mobile or email)" required><Input name="to" required /></Field>
      </FormGrid>
    </ActionForm>
  );
}
