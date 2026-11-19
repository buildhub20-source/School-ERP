import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { PasswordForm } from "../account-forms";

export const metadata = { title: "Change password" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const { first } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader title={first ? "Set a new password" : "Change password"} description={first ? "For security, choose your own password before continuing." : undefined} />
        <CardBody><PasswordForm first={!!first && user.mustChangePassword} /></CardBody>
      </Card>
    </div>
  );
}
