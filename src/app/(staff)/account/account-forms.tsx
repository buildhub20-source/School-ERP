"use client";
import { useState } from "react";
import { ActionForm, useAction, useToast } from "@/components/ui/client";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import { changePassword, confirmTwoFactor, disableTwoFactor, savePushSubscription, setMyChannel, startTwoFactor } from "./actions";

export function PasswordForm({ first }: { first?: boolean }) {
  return (
    <ActionForm action={changePassword} submitLabel="Change password" successMessage="Password changed" resetOnSuccess redirectTo={first ? "/" : undefined}>
      {!first && <Field label="Current password" required><Input type="password" name="current" autoComplete="current-password" required /></Field>}
      <Field label="New password" hint={PASSWORD_RULES} required><Input type="password" name="password" autoComplete="new-password" required /></Field>
      <Field label="Confirm new password" required><Input type="password" name="confirm" autoComplete="new-password" required /></Field>
    </ActionForm>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const toast = useToast();
  const { run, pending } = useAction(savePushSubscription, { successMessage: "Push notifications enabled on this device" });
  if (!vapidKey) return <p className="text-sm text-slate-500">Push notifications are not configured on the server yet.</p>;
  return (
    <Button variant="secondary" loading={pending} onClick={async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return toast.error("This browser does not support push notifications.");
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return toast.error("Notifications were not allowed.");
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        run({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
      } catch (e) { toast.error(String(e)); }
    }}>Enable push notifications on this device</Button>
  );
}

export function AccountForms({ twoFactorEnabled, channel, language, email, vapidKey }: { twoFactorEnabled: boolean; channel: string; language: string; email: string | null; vapidKey: string }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const start = useAction(startTwoFactor, { onSuccess: (d) => setSetup(d), refresh: false });
  return (
    <>
      <Card>
        <CardHeader title="Change password" />
        <CardBody><PasswordForm /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Two-step verification" description="Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy)." />
        <CardBody>
          {twoFactorEnabled ? (
            <ActionForm action={disableTwoFactor} submitLabel="Turn off two-step verification" submitVariant="danger" successMessage="Two-step verification turned off">
              <Field label="Confirm with your password" required><Input type="password" name="password" required /></Field>
            </ActionForm>
          ) : setup ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Scan this QR code in your authenticator app, then enter the 6-digit code it shows.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="Authenticator QR code" className="size-44 rounded-lg border" />
              <p className="text-xs text-slate-500">Or enter this key manually: <code className="break-all font-mono">{setup.secret}</code></p>
              <ActionForm action={confirmTwoFactor} submitLabel="Turn on" successMessage="Two-step verification is on" onSuccess={() => setSetup(null)}>
                <Field label="Code" required><Input name="code" inputMode="numeric" maxLength={6} required /></Field>
              </ActionForm>
            </div>
          ) : (
            <Button onClick={() => start.run({})} loading={start.pending}>Set up two-step verification</Button>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notification preferences" />
        <CardBody className="space-y-4">
          <ActionForm action={setMyChannel} submitLabel="Save preferences" successMessage="Preferences saved">
            <Field label="Preferred channel for alerts">
              <Select name="preferredChannel" defaultValue={channel}>
                <option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="IN_APP">In-app only</option>
              </Select>
            </Field>
            <Field label="Email" hint="Needed for email alerts and scheduled reports"><Input type="email" name="email" defaultValue={email ?? ""} /></Field>
            <Field label="Language"><Select name="language" defaultValue={language}><option value="en">English</option><option value="ta">தமிழ்</option></Select></Field>
          </ActionForm>
          <PushToggle vapidKey={vapidKey} />
        </CardBody>
      </Card>
    </>
  );
}
