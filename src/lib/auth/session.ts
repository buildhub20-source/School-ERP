import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db";
import { getSetting } from "../settings";
import { AppError } from "../errors";
import { hasPerm, type Permission } from "../permissions";

export const SESSION_COOKIE = "sms_session";

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roleKey: string;
  roleName: string;
  permissions: string[];
  branchId: string; // active branch
  homeBranchId: string;
  language: string;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  sessionId: string;
  idleMinutes: number;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  // X-Real-IP is set by our proxy; in X-Forwarded-For only the right-most entry (added by our proxy) can be trusted.
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").pop()?.trim() || undefined;
}

/** True when the browser reached us over HTTPS (directly or via a proxy that sets x-forwarded-proto). Secure cookies are only kept by browsers on HTTPS. */
async function isHttps(): Promise<boolean> {
  // A live site with an https APP_URL always gets Secure cookies, whatever headers the request carries.
  if (process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https://")) return true;
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return (process.env.APP_URL ?? "").startsWith("https://") && !(h.get("host") ?? "").startsWith("localhost");
}

export async function createSession(userId: string, opts: { twoFactorPending?: boolean } = {}) {
  const policies = await getSetting("policies");
  const token = crypto.randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + policies.sessionDays * 86400000);
  await db.session.create({
    data: {
      userId, tokenHash: hashToken(token), expiresAt, twoFactorPending: !!opts.twoFactorPending,
      ip: await clientIp(), userAgent: h.get("user-agent")?.slice(0, 300),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: await isHttps(), path: "/", expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

type Loaded = { user: SessionUser | null; twoFactorPending: boolean };

const loadSession = cache(async (): Promise<Loaded> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { user: null, twoFactorPending: false };
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return { user: null, twoFactorPending: false };

  const policies = await getSetting("policies");
  const idleMs = policies.idleLogoutMinutes * 60000;
  if (Date.now() - session.lastSeenAt.getTime() > idleMs) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return { user: null, twoFactorPending: false };
  }
  if (Date.now() - session.lastSeenAt.getTime() > 60000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = session.user;
  const permissions = u.role.permissions;
  const user: SessionUser = {
    id: u.id, name: u.name, email: u.email, phone: u.phone, roleKey: u.role.key, roleName: u.role.name,
    permissions, branchId: session.activeBranchId ?? u.branchId, homeBranchId: u.branchId, language: u.language,
    mustChangePassword: u.mustChangePassword, twoFactorEnabled: u.twoFactorEnabled, sessionId: session.id,
    idleMinutes: policies.idleLogoutMinutes,
  };
  return { user, twoFactorPending: session.twoFactorPending };
});

/** The signed-in user (fully authenticated), or null. */
export async function getUser(): Promise<SessionUser | null> {
  const s = await loadSession();
  return s.twoFactorPending ? null : s.user;
}

export async function getPendingTwoFactorUser(): Promise<SessionUser | null> {
  const s = await loadSession();
  return s.twoFactorPending ? s.user : null;
}

/** For pages: redirect to login when not signed in, or to the home page when lacking permission. */
export async function requireUser(perm?: Permission | Permission[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password?first=1");
  if (!user.twoFactorEnabled) {
    const policies = await getSetting("policies");
    const path = (await headers()).get("x-pathname") ?? "";
    if (policies.requireTwoFactorRoles?.includes(user.roleKey) && !path.startsWith("/account")) redirect("/account?require2fa=1");
  }
  if (perm && !hasPerm(user, perm)) redirect("/forbidden");
  return user;
}

/**
 * For actions and API routes: throws instead of redirecting. Applies the same account rules as requireUser (forced
 * password change, two-step verification required for the role) unless `selfService` is set — only for the user's own
 * account actions (change password, set up 2-step, preferences), which must keep working while those are pending.
 */
export async function requireUserOrThrow(perm?: Permission | Permission[], opts: { selfService?: boolean } = {}): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  if (!opts.selfService) {
    if (user.mustChangePassword) throw new AppError("Please change your password before continuing (My account → Change password).", "FORBIDDEN");
    if (!user.twoFactorEnabled) {
      const policies = await getSetting("policies");
      if (policies.requireTwoFactorRoles?.includes(user.roleKey)) throw new AppError("Please turn on two-step verification before continuing (My account).", "FORBIDDEN");
    }
  }
  if (perm && !hasPerm(user, perm)) throw new AppError("You do not have permission to do this.", "FORBIDDEN");
  return user;
}

export function homePathFor(user: { roleKey: string; permissions: string[] }): string {
  if (user.permissions.includes("parent.portal")) return "/parent";
  if (user.permissions.includes("driver.portal")) return "/driver";
  if (user.permissions.includes("dashboard.view")) return "/dashboard";
  if (user.permissions.includes("stationery.request")) return "/teacher";
  return "/account";
}
