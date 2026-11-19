import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { SettingsTabs } from "./tabs";
import { SchoolProfileForm } from "./forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("settings.manage");
  const school = await getSetting("school");
  return (
    <>
      <PageHeader title="Settings" description="School profile and letterhead used on receipts, ID cards, statements and reports." />
      <SettingsTabs user={user} active="/settings" />
      <Card><CardBody><SchoolProfileForm school={school} /></CardBody></Card>
    </>
  );
}
