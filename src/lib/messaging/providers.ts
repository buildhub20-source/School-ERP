import "server-only";
import nodemailer from "nodemailer";
import webpush from "web-push";

export type SendResult = { status: "SENT" | "FAILED" | "SANDBOX"; provider: string; providerRef?: string; error?: string };

const env = (k: string) => process.env[k]?.trim() || "";

export const integrationStatus = () => ({
  sms: !!env("MSG91_AUTH_KEY"),
  whatsapp: !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
  email: !!env("SMTP_HOST"),
  push: !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")),
  payments: !!(env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET")),
});

function intl(phone: string) {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

/** Message template keys. Each maps to a DLT-registered SMS template and an approved WhatsApp template (see README). */
export const TEMPLATE_KEYS = ["OTP", "FEE_REMINDER", "FEE_RECEIPT", "UNIFORM_READY", "UNIFORM_PREORDER", "BUS_NEAR_STOP", "BUS_BOARDING", "STUDENT_ABSENT", "CIRCULAR", "GREETING", "GENERAL"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type SendOpts = { template?: TemplateKey; vars?: string[]; lang?: string };

function jsonEnv(k: string): Record<string, string> {
  try { return JSON.parse(env(k) || "{}"); } catch { return {}; }
}

/** MSG91 DLT template id for a key: MSG91_TEMPLATES='{"OTP":"…","FEE_REMINDER":"…"}', falling back to MSG91_TEMPLATE_ID. */
export function smsTemplateId(key: TemplateKey = "GENERAL", lang = "en") {
  const map = jsonEnv("MSG91_TEMPLATES");
  return map[`${key}_${lang.toUpperCase()}`] || map[key] || map.GENERAL || env("MSG91_TEMPLATE_ID");
}

export async function sendSms(to: string, body: string, opts: SendOpts = {}): Promise<SendResult> {
  if (!env("MSG91_AUTH_KEY")) return { status: "SANDBOX", provider: "sandbox" };
  const templateId = smsTemplateId(opts.template, opts.lang);
  if (!templateId) return { status: "FAILED", provider: "msg91", error: `No DLT template configured for ${opts.template ?? "GENERAL"}` };
  try {
    // Template variables are sent as var1, var2, … (the whole text as var1 when none are given).
    const vars = opts.vars?.length ? opts.vars : [body];
    const recipient: Record<string, string> = { mobiles: intl(to) };
    vars.forEach((v, i) => (recipient[`var${i + 1}`] = v));
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTH_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ template_id: templateId, sender: env("MSG91_SENDER_ID"), short_url: "1", ...(opts.lang === "ta" ? { unicode: 1 } : {}), recipients: [recipient] }),
    });
    const json = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || json.type === "error") return { status: "FAILED", provider: "msg91", error: json.message ?? `HTTP ${res.status}` };
    return { status: "SENT", provider: "msg91", providerRef: json.message };
  } catch (e) {
    return { status: "FAILED", provider: "msg91", error: String(e) };
  }
}

/**
 * WhatsApp Cloud API. Business-initiated messages must use an approved template:
 * WHATSAPP_TEMPLATES='{"FEE_REMINDER":"fee_reminder", …}' (template name; language en / ta).
 * Without a template for the key, a free-text message is sent (accepted only within 24 h of the parent's last message).
 */
export async function sendWhatsApp(to: string, body: string, opts: SendOpts = {}): Promise<SendResult> {
  if (!env("WHATSAPP_TOKEN") || !env("WHATSAPP_PHONE_NUMBER_ID")) return { status: "SANDBOX", provider: "sandbox" };
  const name = jsonEnv("WHATSAPP_TEMPLATES")[opts.template ?? "GENERAL"];
  const payload = name
    ? { messaging_product: "whatsapp", to: intl(to), type: "template", template: { name, language: { code: opts.lang === "ta" ? "ta" : "en" }, components: [{ type: "body", parameters: (opts.vars?.length ? opts.vars : [body]).map((t) => ({ type: "text", text: t.slice(0, 1000) })) }] } }
    : { messaging_product: "whatsapp", to: intl(to), type: "text", text: { body, preview_url: true } };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
    if (!res.ok) return { status: "FAILED", provider: "whatsapp", error: json.error?.message ?? `HTTP ${res.status}` };
    return { status: "SENT", provider: "whatsapp", providerRef: json.messages?.[0]?.id };
  } catch (e) {
    return { status: "FAILED", provider: "whatsapp", error: String(e) };
  }
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
export async function sendEmail(to: string, subject: string, text: string, attachments?: { filename: string; content: Buffer }[]): Promise<SendResult> {
  if (!env("SMTP_HOST")) return { status: "SANDBOX", provider: "sandbox" };
  try {
    transporter ??= nodemailer.createTransport({
      host: env("SMTP_HOST"), port: Number(env("SMTP_PORT") || 587), secure: Number(env("SMTP_PORT")) === 465,
      auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined,
    });
    const info = await transporter.sendMail({ from: env("SMTP_FROM") || env("SMTP_USER"), to, subject, text, attachments });
    return { status: "SENT", provider: "smtp", providerRef: info.messageId };
  } catch (e) {
    return { status: "FAILED", provider: "smtp", error: String(e) };
  }
}

let vapidSet = false;
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; link?: string }): Promise<SendResult & { gone?: boolean }> {
  if (!env("VAPID_PUBLIC_KEY") || !env("VAPID_PRIVATE_KEY")) return { status: "SANDBOX", provider: "sandbox" };
  try {
    if (!vapidSet) {
      webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
      vapidSet = true;
    }
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
    return { status: "SENT", provider: "webpush" };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return { status: "FAILED", provider: "webpush", error: String(e), gone: code === 404 || code === 410 };
  }
}
