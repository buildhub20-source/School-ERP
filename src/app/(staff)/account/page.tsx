import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { AccountForms } from "./account-forms";

export const metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ require2fa?: string }> }) {
  const user = await requireUser();
  const { require2fa } = await searchParams;
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { role: true, branch: true } });
  const sessions = await db.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" }, take: 5 });
  return (
    <>
      <PageHeader title="My account" description="Your profile, password, two-step verification and preferences." />
      {require2fa && !u.twoFactorEnabled && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">The school requires two-step verification for your role. Set it up below to continue.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DescList items={[
              { label: "Name", value: u.name }, { label: "Role", value: u.role.name }, { label: "Email", value: u.email },
              { label: "Mobile", value: u.phone }, { label: "Branch", value: u.branch.name }, { label: "Last sign-in", value: fmtDateTime(u.lastLoginAt) },
              { label: "Two-step verification", value: u.twoFactorEnabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge> },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent sessions" />
          <CardBody className="space-y-2 text-sm">
            {sessions.map((s) => (
              <div key={s.id} className="flex justify-between gap-3">
                <span className="truncate text-slate-600">{s.userAgent?.slice(0, 60) ?? "Unknown device"}</span>
                <span className="shrink-0 text-slate-500">{s.id === user.sessionId ? <Badge tone="green">This device</Badge> : fmtDateTime(s.lastSeenAt)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <AccountForms twoFactorEnabled={u.twoFactorEnabled} channel={u.preferredChannel} language={u.language} email={u.email} vapidKey={process.env.VAPID_PUBLIC_KEY ?? ""} />
      </div>
    </>
  );
}
