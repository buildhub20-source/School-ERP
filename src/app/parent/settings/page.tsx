import { requireParent } from "@/server/parent";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { ParentPrefsForm } from "./prefs-form";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PushToggle } from "@/app/(staff)/account/account-forms";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("parent.prefsTitle") };
}

export default async function ParentSettings() {
  const { user } = await requireParent();
  const { t } = await getT();
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-xl font-semibold">{t("parent.preferences")}</h1>
      <Card>
        <CardHeader title={t("parent.preferences")} description={t("parent.prefsDesc")} />
        <CardBody><ParentPrefsForm channel={u.preferredChannel} language={u.language} email={u.email} /></CardBody>
      </Card>
      <Card><CardBody className="flex items-center justify-between gap-3 text-sm text-ink"><span>{t("common.theme")}</span><ThemeToggle /></CardBody></Card>
      <Card>
        <CardHeader title={t("parent.phoneNotifications")} />
        <CardBody><PushToggle vapidKey={process.env.VAPID_PUBLIC_KEY ?? ""} /></CardBody>
      </Card>
      <Card><CardBody className="text-sm text-slate-600">{t("parent.signedInWith")} <b>{u.phone}</b>. {t("parent.installHint")}</CardBody></Card>
    </div>
  );
}
