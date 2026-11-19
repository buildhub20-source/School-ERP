"use client";
import { ActionForm } from "@/components/ui/client";
import { Field, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { setMyChannel } from "@/app/(staff)/account/actions";

export function ParentPrefsForm({ channel, language, email }: { channel: string; language: string; email: string | null }) {
  const t = useT();
  return (
    <ActionForm action={setMyChannel} submitLabel={t("common.save")} successMessage={t("parent.saved")}>
      <Field label={t("parent.preferredChannel")}>
        <Select name="preferredChannel" defaultValue={channel}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">{t("parent.channelEmail")}</option><option value="IN_APP">{t("parent.channelInApp")}</option></Select>
      </Field>
      <Field label={t("common.language")}><Select name="language" defaultValue={language}><option value="en">English</option><option value="ta">தமிழ்</option></Select></Field>
      <Field label={t("parent.email")} hint={t("parent.emailHint")}><Input type="email" name="email" defaultValue={email ?? ""} /></Field>
    </ActionForm>
  );
}
