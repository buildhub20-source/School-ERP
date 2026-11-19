"use client";
import { Field, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/client";
import { useT } from "@/lib/i18n/client";
import { setMyChannel } from "@/app/(staff)/account/actions";

export function DriverSettingsForm({ language, channel }: { language: string; channel: string }) {
  const t = useT();
  return (
    <ActionForm action={setMyChannel} successMessage={t("driver.prefsSaved")} onSuccess={() => window.location.reload()}>
      <Field label="Language / மொழி">
        <Select name="language" defaultValue={language} className="h-11 text-base"><option value="en">English</option><option value="ta">தமிழ்</option></Select>
      </Field>
      <Field label={t("parent.preferredChannel")}>
        <Select name="preferredChannel" defaultValue={channel === "PUSH" ? "IN_APP" : channel} className="h-11 text-base">
          <option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="IN_APP">{t("parent.channelInApp")}</option>
        </Select>
      </Field>
    </ActionForm>
  );
}
