import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, Badge } from "@/components/ui";
import { integrationStatus } from "@/lib/messaging/providers";
import { SettingsTabs } from "../tabs";
import { TestMessageForm } from "./test-form";

export const metadata = { title: "Integrations" };

const ITEMS = [
  { key: "payments", name: "Online payments (Razorpay)", env: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"], sandbox: "Parents pay through the built-in sandbox checkout (no money moves). Add keys to accept UPI, cards and net banking. Webhook URL: /api/payments/webhook" },
  { key: "sms", name: "SMS (MSG91)", env: ["MSG91_AUTH_KEY", "MSG91_SENDER_ID", "MSG91_TEMPLATE_ID"], sandbox: "SMS (including OTPs) are written to the Message outbox instead of being sent." },
  { key: "whatsapp", name: "WhatsApp Business (Meta Cloud API)", env: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], sandbox: "WhatsApp messages are written to the Message outbox." },
  { key: "email", name: "Email (SMTP)", env: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"], sandbox: "Emails (receipts, summaries, scheduled reports) are written to the Message outbox." },
  { key: "push", name: "Mobile push (Web Push / VAPID)", env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], sandbox: "Generate keys with: npx web-push generate-vapid-keys" },
] as const;

export default async function IntegrationsPage() {
  const user = await requireUser("settings.manage");
  const status = integrationStatus();
  return (
    <>
      <PageHeader title="Settings" description="External services. Keys are set in the server's .env file (never stored in the database) and take effect after a restart." />
      <SettingsTabs user={user} active="/settings/integrations" />
      <div className="grid gap-4 lg:grid-cols-2">
        {ITEMS.map((i) => (
          <Card key={i.key}>
            <CardHeader title={i.name} actions={status[i.key] ? <Badge tone="green">Connected</Badge> : <Badge tone="purple">Sandbox mode</Badge>} />
            <CardBody className="space-y-2 text-sm">
              {!status[i.key] && <p className="text-slate-600">{i.sandbox}</p>}
              <p className="text-xs text-slate-500">Environment variables: {i.env.map((e) => <code key={e} className="mr-1 rounded bg-slate-100 px-1">{e}</code>)}</p>
            </CardBody>
          </Card>
        ))}
        <Card className="lg:col-span-2">
          <CardHeader title="Send a test message" description="Check a channel end to end. The result appears in the Message outbox." />
          <CardBody><TestMessageForm /></CardBody>
        </Card>
      </div>
    </>
  );
}
