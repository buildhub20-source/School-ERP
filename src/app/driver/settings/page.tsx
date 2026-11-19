import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/dict";
import { Card, CardHeader, CardBody } from "@/components/ui";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DriverSettingsForm } from "./settings-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("parent.prefsTitle") };
}

export default async function DriverSettings() {
  const user = await requireUser("driver.portal");
  const { t } = await getT();
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { language: true, preferredChannel: true, phone: true } });
  return (
    <Card>
      <CardHeader title={t("parent.preferences")} description={`${fill(t("driver.signedInAs"), { name: user.name })}${u.phone ? ` · ${u.phone}` : ""}`} />
      <CardBody><DriverSettingsForm language={u.language} channel={u.preferredChannel} /></CardBody>
      <CardBody className="flex items-center justify-between gap-3 border-t border-line text-sm text-ink"><span>{t("common.theme")}</span><ThemeToggle /></CardBody>
    </Card>
  );
}
