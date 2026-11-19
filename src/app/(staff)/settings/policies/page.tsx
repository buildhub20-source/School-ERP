import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { SettingsTabs } from "../tabs";
import { PoliciesForm } from "../forms";

export const metadata = { title: "Policies" };

export default async function PoliciesPage() {
  const user = await requireUser("settings.manage");
  const p = await getSetting("policies");
  return (
    <>
      <PageHeader title="Settings" description="Rules used across the system: security, fees, transport and uniforms." />
      <SettingsTabs user={user} active="/settings/policies" />
      <Card><CardBody><PoliciesForm p={p} /></CardBody></Card>
    </>
  );
}
