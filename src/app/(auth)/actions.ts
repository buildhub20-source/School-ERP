"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession, destroySession, getPendingTwoFactorUser, getUser, homePathFor, clientIp, reissueSessionCookie } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotpStep } from "@/lib/auth/totp";
import { hitRateLimit } from "@/lib/auth/rate-limit-db";
import { issueOtp, normalizePhone, verifyOtp } from "@/lib/auth/otp";
import { sendExternal } from "@/lib/messaging/notify";
import { integrationStatus } from "@/lib/messaging/providers";
import { getSetting } from "@/lib/settings";
import { runWithContext } from "@/lib/context";

type Result = { ok: boolean; error?: string; next?: string; devOtp?: string };

const TWO_FA_WINDOW_MS = 10 * 60000;

/**
 * Sign-in attempts per client IP, shared by all servers: 50 per 10 minutes (password, OTP and 2-step together), on top of
 * the per-account lockout and per-phone OTP limits. Skipped when the IP is unknown (no proxy header), so a misconfigured
 * proxy cannot lock everyone out; the middleware's per-server limit still applies then.
 */
async function ipLimited(): Promise<Result | null> {
  const ip = await clientIp();
  if (!ip) return null;
  const r = await hitRateLimit(`auth:${ip}`, 50, 10 * 60000);
  return r.ok ? null : { ok: false, error: `Too many sign-in attempts from this network. Please try again in ${Math.ceil(r.retryAfter / 60)} minute(s).` };
}
const MAX_2FA_ATTEMPTS = 5;

async function logAuth(userId: string | null, userName: string | null, action: string, detail?: object) {
  await db.auditLog.create({ data: { userId: userId ?? undefined, userName: userName ?? undefined, action, entity: "Auth", ip: await clientIp(), after: detail ?? undefined } });
}

function safeNext(next: string | undefined | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

/** Validate staff credentials and create a session. Returns where to go next. */
export async function authenticateStaff(_: Result | null, fd: FormData): Promise<Result> {
  const parsed = z.object({ login: z.string().trim().min(1), password: z.string().min(1), next: z.string().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Enter your email/mobile and password." };
  const limited = await ipLimited();
  if (limited) return limited;
  const { login, password } = parsed.data;
  const phone = normalizePhone(login);
  const user = await db.user.findFirst({
    where: { OR: [{ email: login.toLowerCase() }, ...(phone.length === 10 ? [{ phone }] : [])] },
    include: { role: true },
  });
  const generic = { ok: false, error: "Incorrect login or password." };
  if (!user || !user.passwordHash || !user.isActive) {
    await logAuth(null, login, "LOGIN_FAILED");
    return generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: `Too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}.` };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await runWithContext({ skipAudit: true }, () => db.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60000) : null } }));
    await logAuth(user.id, user.name, "LOGIN_FAILED");
    return generic;
  }
  await runWithContext({ skipAudit: true }, () => db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }));
  await createSession(user.id, { twoFactorPending: user.twoFactorEnabled });
  await logAuth(user.id, user.name, "LOGIN");
  if (user.twoFactorEnabled) return { ok: true, next: `/login/2fa?next=${encodeURIComponent(parsed.data.next ?? "")}` };
  const home = homePathFor({ roleKey: user.role.key, permissions: user.role.permissions });
  return { ok: true, next: user.mustChangePassword ? "/account/password?first=1" : safeNext(parsed.data.next, home) };
}

async function checkTwoFactor(_: Result | null, fd: FormData): Promise<Result> {
  const pending = await getPendingTwoFactorUser();
  if (!pending) return { ok: false, error: "Your sign-in expired. Please sign in again.", next: "/login" };
  const user = await db.user.findUnique({ where: { id: pending.id } });
  const session = await db.session.findUnique({ where: { id: pending.sessionId } });
  // The half-signed-in session only lives 10 minutes and allows 5 wrong codes; after that the password is needed again
  // (and the password lockout applies). 10 wrong codes in 15 minutes across sessions lock the account for 15 minutes.
  const restart = async (error: string): Promise<Result> => {
    await db.session.deleteMany({ where: { id: pending.sessionId } });
    return { ok: false, error, next: "/login?twofa=1" };
  };
  if (!session || Date.now() - session.createdAt.getTime() > TWO_FA_WINDOW_MS) return restart("Your sign-in expired. Please sign in again.");
  if (user?.lockedUntil && user.lockedUntil > new Date()) return restart("Too many wrong codes. Please try again later.");
  const limited = await ipLimited();
  if (limited) return limited;
  const code = String(fd.get("code") ?? "");
  const step = user?.twoFactorSecret ? verifyTotpStep(user.twoFactorSecret, code) : null;
  // A code that was already used (seen by someone over the shoulder, or replayed) is refused.
  const reused = step !== null && user?.twoFactorLastStep != null && step <= user.twoFactorLastStep;
  if (!user?.twoFactorSecret || step === null || reused) {
    await logAuth(pending.id, pending.name, "2FA_FAILED");
    const [inSession, recent] = await Promise.all([
      db.auditLog.count({ where: { userId: pending.id, action: "2FA_FAILED", createdAt: { gte: session.createdAt } } }),
      db.auditLog.count({ where: { userId: pending.id, action: "2FA_FAILED", createdAt: { gte: new Date(Date.now() - 15 * 60000) } } }),
    ]);
    if (recent >= 10) {
      await runWithContext({ skipAudit: true }, () => db.user.update({ where: { id: pending.id }, data: { lockedUntil: new Date(Date.now() + 15 * 60000) } }));
      return restart("Too many wrong codes. Your account is locked for 15 minutes.");
    }
    if (inSession >= MAX_2FA_ATTEMPTS) return restart("Too many wrong codes. Please sign in again.");
    return { ok: false, error: "That code is not correct. Check your authenticator app and try again." };
  }
  await db.session.update({ where: { id: pending.sessionId }, data: { twoFactorPending: false } });
  await reissueSessionCookie(pending.sessionId);
  await runWithContext({ skipAudit: true }, () => db.user.update({ where: { id: user.id }, data: { twoFactorLastStep: step } }));
  await logAuth(pending.id, pending.name, "2FA_OK");
  return { ok: true, next: user.mustChangePassword ? "/account/password?first=1" : safeNext(String(fd.get("next") ?? ""), homePathFor(pending)) };
}

export async function requestOtp(_: Result | null, fd: FormData): Promise<Result> {
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!/^\d{10}$/.test(phone)) return { ok: false, error: "Enter your 10-digit mobile number." };
  const limited = await ipLimited();
  if (limited) return limited;
  const user = await db.user.findUnique({ where: { phone }, include: { role: true } });
  // Do not reveal whether the number exists.
  if (!user || !user.isActive || !(user.role.permissions.includes("parent.portal") || user.role.permissions.includes("driver.portal"))) {
    return { ok: true };
  }
  try {
    const code = await issueOtp(phone);
    const school = await getSetting("school");
    const body = user.language === "ta"
      ? `${school.name} உள்நுழைவுக்கான உங்கள் OTP ${code}. இது 5 நிமிடங்கள் செல்லுபடியாகும். யாரிடமும் பகிர வேண்டாம்.`
      : `${code} is your OTP to sign in to ${school.name}. It is valid for 5 minutes. Do not share it.`;
    await sendExternal("SMS", phone, { body, category: "OTP", userId: user.id, template: "OTP", vars: [code, school.name], lang: user.language });
    const sandbox = !integrationStatus().sms && process.env.NODE_ENV !== "production";
    return { ok: true, devOtp: sandbox ? code : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function authenticateOtp(_: Result | null, fd: FormData): Promise<Result> {
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  const code = String(fd.get("code") ?? "");
  const limited = await ipLimited();
  if (limited) return limited;
  const user = await db.user.findUnique({ where: { phone }, include: { role: true } });
  if (!user || !(await verifyOtp(phone, code))) {
    await logAuth(user?.id ?? null, phone, "OTP_FAILED");
    return { ok: false, error: "The OTP is incorrect or has expired." };
  }
  await runWithContext({ skipAudit: true }, () => db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }));
  await createSession(user.id);
  await logAuth(user.id, user.name, "LOGIN_OTP");
  return { ok: true, next: homePathFor({ roleKey: user.role.key, permissions: user.role.permissions }) };
}

export async function logout() {
  const user = await getUser();
  if (user) await logAuth(user.id, user.name, "LOGOUT");
  await destroySession();
  redirect("/login");
}

export async function setGuestLanguage(lang: string) {
  (await cookies()).set("lang", lang === "ta" ? "ta" : "en", { path: "/", maxAge: 31536000 });
}

/* Form actions: on success the SERVER redirects, so sign-in completes even if page JavaScript has not loaded. */
export async function staffLogin(prev: Result | null, fd: FormData): Promise<Result> {
  const r = await authenticateStaff(prev, fd);
  if (r.ok && r.next) redirect(r.next);
  return r;
}

export async function verifyTwoFactor(prev: Result | null, fd: FormData): Promise<Result> {
  const r = await checkTwoFactor(prev, fd);
  if (r.next) redirect(r.next);
  return r;
}

export async function verifyOtpLogin(prev: Result | null, fd: FormData): Promise<Result> {
  const r = await authenticateOtp(prev, fd);
  if (r.ok && r.next) redirect(r.next);
  return r;
}
