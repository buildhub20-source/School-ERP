"use server";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { checkPasswordStrength, hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, totpUri, verifyTotpStep } from "@/lib/auth/totp";
import { reissueSessionCookie } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";

export const setMyLanguage = defineAction({ selfService: true, schema: z.object({ language: z.enum(["en", "ta"]) }) }, async ({ language }, { user }) => {
  await db.user.update({ where: { id: user.id }, data: { language } });
  return true;
});

export const setMyChannel = defineAction({ selfService: true, schema: z.object({ preferredChannel: z.enum(["SMS", "WHATSAPP", "EMAIL", "IN_APP"]), language: z.enum(["en", "ta"]).optional(), email: zs.optEmail() }) }, async (input, { user }) => {
  if (input.preferredChannel === "EMAIL" && !input.email && !user.email) throw new AppError("Add an email address to receive messages by email.");
  await db.user.update({ where: { id: user.id }, data: { preferredChannel: input.preferredChannel, ...(input.language ? { language: input.language } : {}), ...(input.email ? { email: input.email } : {}) } });
  return true;
});

export const switchBranch = defineAction({ schema: z.object({ branchId: zs.id }) }, async ({ branchId }, { user }) => {
  if (user.roleKey !== "SUPER_ADMIN") throw new AppError("Only the Super Admin can switch branches.");
  await db.session.update({ where: { id: user.sessionId }, data: { activeBranchId: branchId } });
  await reissueSessionCookie(user.sessionId);
  return true;
});

export const changePassword = defineAction(
  { selfService: true, schema: z.object({ current: z.string().optional(), password: z.string(), confirm: z.string() }) },
  async ({ current, password, confirm }, { user }) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.passwordHash && !u.mustChangePassword && !(await verifyPassword(current ?? "", u.passwordHash))) throw new AppError("Your current password is not correct.");
    if (password !== confirm) throw new AppError("The two passwords do not match.");
    const weak = checkPasswordStrength(password);
    if (weak) throw new AppError(weak);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await db.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
    return true;
  },
);

export const startTwoFactor = defineAction({ selfService: true, schema: z.object({}) }, async (_, { user }) => {
  // Re-enrolling would silently replace a working authenticator; turning 2-step off first requires the password.
  if (user.twoFactorEnabled) throw new AppError("Two-step verification is already on. Turn it off with your password first to set up a new device.");
  const secret = generateTotpSecret();
  const school = await getSetting("school");
  await db.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });
  const uri = totpUri(secret, user.email ?? user.phone ?? user.name, school.name);
  return { secret, qr: await QRCode.toDataURL(uri) };
});

export const confirmTwoFactor = defineAction({ selfService: true, schema: z.object({ code: z.string() }) }, async ({ code }, { user }) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const step = u.twoFactorSecret ? verifyTotpStep(u.twoFactorSecret, code) : null;
  if (step === null) throw new AppError("That code is not correct. Try the current code in your app.");
  await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true, twoFactorLastStep: step } });
  return true;
});

export const disableTwoFactor = defineAction({ selfService: true, schema: z.object({ password: z.string() }) }, async ({ password }, { user }) => {
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!u.passwordHash || !(await verifyPassword(password, u.passwordHash))) throw new AppError("Password is not correct.");
  await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastStep: null } });
  return true;
});

export const savePushSubscription = defineAction({ selfService: true, schema: z.object({ endpoint: z.string().url(), p256dh: z.string(), auth: z.string() }) }, async (s, { user }) => {
  await db.pushSubscription.upsert({ where: { endpoint: s.endpoint }, create: { ...s, userId: user.id }, update: { userId: user.id, p256dh: s.p256dh, auth: s.auth } });
  return true;
});

export const markNotificationsRead = defineAction({ selfService: true, schema: z.object({}) }, async (_, { user }) => {
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return true;
});
