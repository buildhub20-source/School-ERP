import crypto from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";

function hash(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export async function issueOtp(phone: string, purpose = "LOGIN"): Promise<string> {
  const recent = await db.otpCode.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 10 * 60000) } } });
  if (recent >= 5) throw new AppError("Too many OTP requests. Please wait 10 minutes and try again.");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.otpCode.create({ data: { phone, purpose, codeHash: hash(code), expiresAt: new Date(Date.now() + 5 * 60000) } });
  return code;
}

/**
 * Fixed demo login code (DEMO_OTP in .env, e.g. 123456) for local demos without an SMS provider. Never active on a live
 * site: ignored when APP_URL is https or when an SMS provider (MSG91) is configured.
 */
export function demoOtp(): string | null {
  const code = process.env.DEMO_OTP?.trim();
  if (!code || !/^\d{6}$/.test(code)) return null;
  if ((process.env.APP_URL ?? "").startsWith("https://") || process.env.MSG91_AUTH_KEY?.trim()) return null;
  return code;
}

export async function verifyOtp(phone: string, code: string, purpose = "LOGIN"): Promise<boolean> {
  const demo = demoOtp();
  if (demo && code.trim() === demo) return true;
  const otp = await db.otpCode.findFirst({ where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!otp) return false;
  if (otp.attempts >= 5) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hash(code.trim())));
  await db.otpCode.update({ where: { id: otp.id }, data: ok ? { usedAt: new Date() } : { attempts: { increment: 1 } } });
  return ok;
}
