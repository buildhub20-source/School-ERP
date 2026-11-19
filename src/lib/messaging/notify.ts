import "server-only";
import type { Channel } from "@prisma/client";
import { db } from "../db";
import { getRequestContext } from "../context";
import { sendEmail, sendPush, sendSms, sendWhatsApp, type TemplateKey } from "./providers";

export type Message = {
  title: string;
  body: string;
  /** Relative link inside the app (e.g. /fees/students/123). */
  link?: string;
  category?: string;
  /** Extra channels to use in addition to in-app + user's preferred channel. */
  channels?: Channel[];
  /** Only send in-app (no SMS/WhatsApp/email/push). */
  inAppOnly?: boolean;
  attachments?: { filename: string; content: Buffer }[];
  /** Tamil version, sent to users whose language is Tamil. */
  ta?: { title: string; body: string };
  /** Template key used for DLT SMS and WhatsApp templates. */
  template?: TemplateKey;
};

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const absoluteUrl = (path: string) => (path.startsWith("http") ? path : `${appUrl()}${path}`);

/** Send to an external address directly (logged in the outbox). */
export async function sendExternal(channel: Channel, to: string, msg: { subject?: string; body: string; category?: string; userId?: string; branchId?: string; attachments?: { filename: string; content: Buffer }[]; template?: TemplateKey; vars?: string[]; lang?: string }) {
  // Login codes are never stored readable: anyone with outbox access could otherwise sign in as that parent/driver.
  const storedBody = msg.category === "OTP" ? msg.body.replace(/\d{4,8}/g, "••••••") : msg.body;
  const isOtp = msg.category === "OTP";
  // Branch of the message (the outbox is filtered by branch): given, else the current request's, else the recipient user's.
  const branchId = msg.branchId ?? getRequestContext()?.branchId
    ?? (msg.userId ? (await db.user.findUnique({ where: { id: msg.userId }, select: { branchId: true } }))?.branchId : undefined);
  const log = await db.messageLog.create({
    data: {
      channel, to, subject: msg.subject, body: storedBody, category: msg.category ?? "GENERAL", userId: msg.userId, branchId,
      // What a retry needs; never kept for login OTPs (they expire in 5 minutes anyway).
      template: isOtp ? null : msg.template, vars: isOtp || !msg.vars ? undefined : msg.vars, lang: isOtp ? null : msg.lang,
      hasAttachment: !!msg.attachments?.length,
    },
  });
  let r;
  const opts = { template: msg.template, vars: msg.vars, lang: msg.lang };
  if (channel === "SMS") r = await sendSms(to, msg.body, opts);
  else if (channel === "WHATSAPP") r = await sendWhatsApp(to, msg.body, opts);
  else if (channel === "EMAIL") r = await sendEmail(to, msg.subject ?? "School notification", msg.body, msg.attachments);
  else r = { status: "SANDBOX" as const, provider: "none" };
  await db.messageLog.update({ where: { id: log.id }, data: { status: r.status, provider: r.provider, providerRef: r.providerRef, error: r.error, sentAt: r.status === "SENT" ? new Date() : null } });
  return r;
}

/** Notify one or more users: in-app notification + their preferred channel (+ any extra channels) + web push. */
export async function notifyUsers(userIds: string[], msg: Message) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const users = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, include: { pushSubscriptions: true } });
  for (const u of users) {
    const lang = u.language === "ta" && msg.ta ? "ta" : "en";
    const title = lang === "ta" ? msg.ta!.title : msg.title;
    const body = lang === "ta" ? msg.ta!.body : msg.body;
    await db.notification.create({ data: { userId: u.id, title, body, link: msg.link, category: msg.category ?? "GENERAL" } });
    if (msg.inAppOnly) continue;
    const text = `${title}\n${body}${msg.link ? `\n${absoluteUrl(msg.link)}` : ""}`;
    const tpl = { template: msg.template ?? "GENERAL", vars: [title, body, msg.link ? absoluteUrl(msg.link) : ""], lang };
    const channels = new Set<Channel>([u.preferredChannel, ...(msg.channels ?? [])]);
    for (const ch of channels) {
      if (ch === "IN_APP" || ch === "PUSH") continue;
      if ((ch === "SMS" || ch === "WHATSAPP") && u.phone) await sendExternal(ch, u.phone, { body: text, category: msg.category, userId: u.id, branchId: u.branchId, ...tpl });
      if (ch === "EMAIL" && u.email) await sendExternal("EMAIL", u.email, { subject: title, body: text, category: msg.category, userId: u.id, branchId: u.branchId, attachments: msg.attachments });
    }
    for (const sub of u.pushSubscriptions) {
      const r = await sendPush(sub, { title, body, link: msg.link });
      if (r.status !== "SANDBOX") await db.messageLog.create({ data: { channel: "PUSH", to: u.name, subject: title, body, status: r.status, provider: r.provider, error: r.error, userId: u.id, branchId: u.branchId, category: msg.category ?? "GENERAL", attempts: 1 } });
      if ("gone" in r && r.gone) await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

/** Notify everyone holding a permission (e.g. all Store Managers via "stationery.manage"). */
export async function notifyPermission(permission: string, msg: Message, branchId?: string) {
  const users = await db.user.findMany({
    where: { isActive: true, ...(branchId ? { branchId } : {}), role: { OR: [{ permissions: { has: permission } }, { key: "SUPER_ADMIN" }] } },
    select: { id: true, role: { select: { key: true, permissions: true } } },
  });
  // Super admins get in-app only for operational alerts unless they hold the permission explicitly
  const direct = users.filter((u) => u.role.permissions.includes(permission)).map((u) => u.id);
  const supers = users.filter((u) => !u.role.permissions.includes(permission)).map((u) => u.id);
  await notifyUsers(direct, msg);
  if (supers.length) await notifyUsers(supers, { ...msg, inAppOnly: true });
}

/** Notify all guardians (parent logins) of a student. Guardians without a login get SMS directly. */
export async function notifyGuardians(studentId: string, msg: Message) {
  const links = await db.studentGuardian.findMany({ where: { studentId }, include: { guardian: true } });
  const withLogin = links.filter((l) => l.guardian.userId).map((l) => l.guardian.userId!) as string[];
  await notifyUsers(withLogin, msg);
  if (msg.inAppOnly) return;
  const student = await db.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
  for (const l of links.filter((l) => !l.guardian.userId)) {
    await sendExternal("SMS", l.guardian.phone, { branchId: student?.branchId, body: `${msg.title}\n${msg.body}${msg.link ? `\n${absoluteUrl(msg.link)}` : ""}`, category: msg.category, template: msg.template ?? "GENERAL", vars: [msg.title, msg.body, msg.link ? absoluteUrl(msg.link) : ""] });
  }
}
