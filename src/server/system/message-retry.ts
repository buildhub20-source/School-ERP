import "server-only";
import { db } from "@/lib/db";
import { sendEmail, sendSms, sendWhatsApp, type TemplateKey } from "@/lib/messaging/providers";

/**
 * Retry SMS / WhatsApp / email messages that failed (provider down, network error…).
 * Only recent messages (default 24 h), at most `maxAttempts` in total. Never retried: login OTPs (they expire after
 * 5 minutes) and emails with attachments (attachments are not stored). Sandbox messages are not failures.
 */
export async function retryFailedMessages(config: Record<string, unknown>): Promise<string> {
  const maxAttempts = Math.max(1, Number(config.maxAttempts ?? 3) || 3);
  const hours = Math.max(1, Number(config.withinHours ?? 24) || 24);
  const failed = await db.messageLog.findMany({
    where: {
      status: "FAILED", channel: { in: ["SMS", "WHATSAPP", "EMAIL"] }, category: { not: "OTP" }, hasAttachment: false,
      attempts: { lt: maxAttempts }, createdAt: { gte: new Date(Date.now() - hours * 3600000) },
    },
    orderBy: { createdAt: "asc" }, take: 200,
  });
  let sent = 0, stillFailing = 0;
  for (const m of failed) {
    const opts = { template: (m.template ?? undefined) as TemplateKey | undefined, vars: Array.isArray(m.vars) ? (m.vars as string[]) : undefined, lang: m.lang ?? undefined };
    const r = m.channel === "SMS" ? await sendSms(m.to, m.body, opts)
      : m.channel === "WHATSAPP" ? await sendWhatsApp(m.to, m.body, opts)
      : await sendEmail(m.to, m.subject ?? "School notification", m.body);
    await db.messageLog.update({
      where: { id: m.id },
      data: { attempts: { increment: 1 }, status: r.status, provider: r.provider, providerRef: r.providerRef ?? m.providerRef, error: r.status === "SENT" ? null : r.error ?? m.error, sentAt: r.status === "SENT" ? new Date() : m.sentAt },
    });
    if (r.status === "SENT") sent++;
    else stillFailing++;
  }
  return failed.length ? `Retried ${failed.length} failed message(s): ${sent} sent, ${stillFailing} still failing` : "No failed messages to retry";
}
