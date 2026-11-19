"use server";
import { z } from "zod";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { saveSetting } from "@/lib/settings";
import { saveUpload } from "@/lib/uploads";
import { hashPassword, checkPasswordStrength } from "@/lib/auth/password";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { AUTOMATIONS } from "@/lib/automations/catalog";
import { runAutomation } from "@/lib/automations/runner";
import { createBackup, pruneBackups } from "@/server/system/backup";
import { resetJsonData } from "@/lib/json-db/client";
import { sendExternal } from "@/lib/messaging/notify";

// ── School profile ──
export const saveSchoolProfile = defineAction({
  perm: "settings.manage", revalidate: "/",
  schema: z.object({
    name: zs.str(150), tagline: zs.optStr(150), address: zs.optStr(300), phone: zs.optStr(40), email: zs.optEmail(), website: zs.optStr(120),
    affiliation: zs.optStr(200), principalName: zs.optStr(120), principalEmail: zs.optEmail(), logo: z.any().optional(), removeLogo: zs.bool(),
  }),
}, async (input) => {
  let logoUrl: string | undefined;
  if (input.logo instanceof File && input.logo.size > 0) logoUrl = await saveUpload(input.logo, "public/logo", { maxMb: 2, types: ["image/png", "image/jpeg", "image/webp"] });
  const { logo: _l, removeLogo, ...rest } = input;
  await saveSetting("school", {
    ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? ""])),
    ...(logoUrl ? { logoUrl } : removeLogo ? { logoUrl: "" } : {}),
  });
  return true;
});

// ── Policies ──
export const savePolicies = defineAction({
  perm: "settings.manage", revalidate: "/",
  schema: z.object({
    idleLogoutMinutes: z.coerce.number().int().min(5).max(480),
    sessionDays: z.coerce.number().int().min(1).max(60),
    defaulterDays: z.coerce.number().int().min(0).max(365),
    capacityPolicy: z.enum(["BLOCK", "WARN"]),
    transportFeeMode: z.enum(["STOP", "DISTANCE"]),
    transportFeeBasis: z.enum(["TERM", "ANNUAL"]),
    lateFeeEnabled: zs.bool(), lateFeeType: z.enum(["FIXED", "PER_DAY", "PERCENT"]), lateFeeAmount: zs.money(), lateFeeGraceDays: z.coerce.number().int().min(0).max(120), lateFeeMax: zs.money(),
    siblingDiscountPercent: z.coerce.number().min(0).max(100), staffChildDiscountPercent: z.coerce.number().min(0).max(100),
    receiptPrefix: z.string().trim().regex(/^[A-Z0-9]{2,8}$/, "2–8 capital letters or digits"),
    gpsNearStopMeters: z.coerce.number().int().min(50).max(5000), sizeGrowthSteps: z.coerce.number().int().min(0).max(3),
    requireTwoFactorRoles: z.array(z.string()).default([]),
  }),
}, async (i) => {
  await saveSetting("policies", {
    idleLogoutMinutes: i.idleLogoutMinutes, sessionDays: i.sessionDays, defaulterDays: i.defaulterDays, capacityPolicy: i.capacityPolicy,
    transportFeeMode: i.transportFeeMode, transportFeeBasis: i.transportFeeBasis,
    lateFee: { enabled: i.lateFeeEnabled, type: i.lateFeeType, amount: i.lateFeeAmount, graceDays: i.lateFeeGraceDays, maxAmount: i.lateFeeMax },
    siblingDiscountPercent: i.siblingDiscountPercent, staffChildDiscountPercent: i.staffChildDiscountPercent, receiptPrefix: i.receiptPrefix,
    gpsNearStopMeters: i.gpsNearStopMeters, sizeGrowthSteps: i.sizeGrowthSteps,
    requireTwoFactorRoles: i.requireTwoFactorRoles.filter((r) => !["PARENT", "DRIVER"].includes(r)),
  });
  return true;
});

// ── Academic years ──
const termSchema = z.object({ name: zs.str(40), startDate: zs.date(), endDate: zs.date() });
export const saveAcademicYear = defineAction({
  perm: "settings.manage", revalidate: "/settings/academic",
  schema: z.object({ id: zs.optStr(40), name: z.string().trim().regex(/^\d{4}-\d{2}$/, "Use the format 2027-28"), startDate: zs.date(), endDate: zs.date(), terms: zs.json(z.array(termSchema).min(1, "Add at least one term")) }),
}, async (i) => {
  if (i.endDate <= i.startDate) throw new AppError("The year must end after it starts.");
  for (const [n, t] of i.terms.entries()) {
    if (t.endDate < t.startDate) throw new AppError(`${t.name} ends before it starts.`);
    if (t.startDate < i.startDate || t.endDate > i.endDate) throw new AppError(`${t.name} must fall inside the academic year.`);
    if (n > 0 && t.startDate <= i.terms[n - 1].endDate) throw new AppError(`${t.name} overlaps the previous term.`);
  }
  return db.$transaction(async (tx) => {
    const year = i.id
      ? await tx.academicYear.update({ where: { id: i.id }, data: { name: i.name, startDate: i.startDate, endDate: i.endDate } })
      : await tx.academicYear.create({ data: { name: i.name, startDate: i.startDate, endDate: i.endDate } });
    const existing = await tx.term.findMany({ where: { academicYearId: year.id } });
    for (const [n, t] of i.terms.entries()) {
      const seq = n + 1;
      const ex = existing.find((e) => e.sequence === seq);
      if (ex) await tx.term.update({ where: { id: ex.id }, data: { name: t.name, startDate: t.startDate, endDate: t.endDate } });
      else await tx.term.create({ data: { academicYearId: year.id, sequence: seq, name: t.name, startDate: t.startDate, endDate: t.endDate } });
    }
    for (const ex of existing.filter((e) => e.sequence > i.terms.length)) {
      const used = await tx.studentFee.count({ where: { termId: ex.id } }) + await tx.feeStructure.count({ where: { termId: ex.id } });
      if (used) throw new AppError(`${ex.name} already has fees and cannot be removed.`);
      await tx.term.delete({ where: { id: ex.id } });
    }
    return { id: year.id };
  });
});

// ── Classes, sections, departments ──
export const saveClass = defineAction({ perm: "settings.manage", revalidate: "/settings/academic", schema: z.object({ id: zs.optStr(40), name: zs.str(40), grade: z.coerce.number().int().min(-3).max(20), sections: z.string().trim().default("A") }) }, async (i, { branchId }) => {
  const names = [...new Set(i.sections.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return db.$transaction(async (tx) => {
    const c = i.id
      ? await tx.schoolClass.update({ where: { id: i.id }, data: { name: i.name, grade: i.grade } })
      : await tx.schoolClass.create({ data: { branchId, name: i.name, grade: i.grade } });
    const existing = await tx.section.findMany({ where: { classId: c.id } });
    for (const n of names) if (!existing.find((e) => e.name === n)) await tx.section.create({ data: { classId: c.id, name: n } });
    for (const e of existing.filter((e) => !names.includes(e.name))) {
      if (await tx.student.count({ where: { sectionId: e.id } })) throw new AppError(`Section ${e.name} has students and cannot be removed.`);
      await tx.section.delete({ where: { id: e.id } });
    }
    return { id: c.id };
  });
});

export const deleteClass = defineAction({ perm: "settings.manage", revalidate: "/settings/academic", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  if (await db.student.count({ where: { classId: id } })) throw new AppError("This class has students and cannot be deleted.");
  if (await db.feeStructure.count({ where: { classId: id } })) throw new AppError("This class has a fee structure and cannot be deleted.");
  await db.section.deleteMany({ where: { classId: id } });
  await db.schoolClass.delete({ where: { id } });
  return true;
});

export const setClassTeacher = defineAction({ perm: "settings.manage", revalidate: "/settings/academic", schema: z.object({ sectionId: zs.id, teacherId: zs.optStr(40) }) }, async ({ sectionId, teacherId }) => {
  await db.section.update({ where: { id: sectionId }, data: { classTeacherId: teacherId ?? null } });
  return true;
});

export const saveDepartment = defineAction({ perm: "settings.manage", revalidate: "/settings/academic", schema: z.object({ id: zs.optStr(40), name: zs.str(80) }) }, async ({ id, name }, { branchId }) => {
  if (id) await db.department.update({ where: { id }, data: { name } });
  else await db.department.create({ data: { branchId, name } });
  return true;
});

export const deleteDepartment = defineAction({ perm: "settings.manage", revalidate: "/settings/academic", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  if (await db.user.count({ where: { departmentId: id } }) || await db.stockMovement.count({ where: { departmentId: id } })) throw new AppError("This department is in use and cannot be deleted.");
  await db.department.delete({ where: { id } });
  return true;
});

// ── Users ──
function tempPassword() {
  return `Sms@${crypto.randomBytes(4).toString("hex")}${crypto.randomInt(10, 99)}A`;
}

export const saveUser = defineAction({
  perm: "users.manage", revalidate: "/settings/users",
  schema: z.object({ id: zs.optStr(40), name: zs.str(120), email: zs.optEmail(), phone: zs.optPhone(), roleId: zs.id, departmentId: zs.optStr(40), isActive: zs.bool(), dob: zs.optDate(), branchId: zs.optStr(40) }),
}, async (i, { user, branchId }) => {
  const role = await db.role.findUniqueOrThrow({ where: { id: i.roleId } });
  if (role.key === "SUPER_ADMIN" && user.roleKey !== "SUPER_ADMIN") throw new AppError("Only a Super Admin can create another Super Admin.");
  if (!i.email && !i.phone) throw new AppError("Add an email or a mobile number so the user can sign in.");
  if (role.key !== "PARENT" && role.key !== "DRIVER" && !i.email) throw new AppError("Staff accounts need an email address.");
  if (i.id === user.id && !i.isActive) throw new AppError("You cannot deactivate your own account.");
  const data = { name: i.name, email: i.email ?? null, phone: i.phone ?? null, roleId: i.roleId, departmentId: i.departmentId ?? null, isActive: i.isActive, dob: i.dob ?? null, branchId: i.branchId ?? branchId };
  if (i.id) {
    const u = await db.user.update({ where: { id: i.id }, data });
    if (!i.isActive) await db.session.deleteMany({ where: { userId: u.id } });
    return { id: u.id, password: null as string | null };
  }
  const password = role.key === "PARENT" || role.key === "DRIVER" ? null : tempPassword();
  const u = await db.user.create({ data: { ...data, passwordHash: password ? await hashPassword(password) : null, mustChangePassword: !!password, preferredChannel: i.email ? "EMAIL" : "SMS" } });
  return { id: u.id, password };
});

export const resetUserPassword = defineAction({ perm: "users.manage", revalidate: "/settings/users", schema: z.object({ id: zs.id, password: z.string().optional() }) }, async ({ id, password }) => {
  const pw = password || tempPassword();
  const weak = checkPasswordStrength(pw);
  if (weak) throw new AppError(weak);
  await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
  await db.session.deleteMany({ where: { userId: id } });
  return { password: pw };
});

export const resetUserTwoFactor = defineAction({ perm: "users.manage", revalidate: "/settings/users", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  await db.user.update({ where: { id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  return true;
});

export const unlockUser = defineAction({ perm: "users.manage", revalidate: "/settings/users", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  await db.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
  return true;
});

// ── Roles & permissions ──
export const saveRolePermissions = defineAction({ perm: "roles.manage", revalidate: "/", schema: z.object({ roleId: zs.id, permissions: z.array(z.string()).default([]) }) }, async ({ roleId, permissions }) => {
  const role = await db.role.findUniqueOrThrow({ where: { id: roleId } });
  if (role.key === "SUPER_ADMIN") {
    for (const p of ["settings.manage", "users.manage", "roles.manage"]) if (!permissions.includes(p)) throw new AppError("The Super Admin must keep settings, users and roles permissions.");
  }
  const valid = permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  await db.role.update({ where: { id: roleId }, data: { permissions: valid } });
  return true;
});

export const createRole = defineAction({ perm: "roles.manage", revalidate: "/settings/roles", schema: z.object({ name: zs.str(60), description: zs.optStr(200), copyFrom: zs.optStr(40) }) }, async ({ name, description, copyFrom }) => {
  const from = copyFrom ? await db.role.findUnique({ where: { id: copyFrom } }) : null;
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (await db.role.findUnique({ where: { key } })) throw new AppError("A role with this name already exists.");
  const r = await db.role.create({ data: { key, name, description, permissions: from?.permissions ?? [], isSystem: false } });
  return { id: r.id };
});

export const deleteRole = defineAction({ perm: "roles.manage", revalidate: "/settings/roles", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  const role = await db.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
  if (role.isSystem) throw new AppError("Built-in roles cannot be deleted.");
  if (role._count.users) throw new AppError("Move this role's users to another role first.");
  await db.role.delete({ where: { id } });
  return true;
});

// ── Automations ──
export const saveAutomation = defineAction({ perm: "settings.manage", revalidate: "/settings/automations", schema: z.object({ key: zs.id, enabled: zs.bool(), config: zs.json(z.record(z.string(), z.unknown())) }) }, async ({ key, enabled, config }) => {
  const meta = AUTOMATIONS.find((a) => a.key === key);
  if (!meta) throw new AppError("Unknown automation.");
  if (typeof config.time === "string" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time)) throw new AppError("Time must be HH:MM (24-hour).");
  await db.automationSetting.upsert({ where: { key }, create: { key, enabled, config: config as object }, update: { enabled, config: config as object } });
  return true;
});

export const runAutomationNow = defineAction({ perm: "settings.manage", revalidate: "/settings/automations", schema: z.object({ key: zs.id }) }, async ({ key }) => {
  return { summary: await runAutomation(key, { manual: true }) };
});

// ── Branches ──
export const saveBranch = defineAction({ perm: "settings.manage", revalidate: "/", schema: z.object({ id: zs.optStr(40), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, "2–10 letters or digits"), name: zs.str(120), address: zs.optStr(300), phone: zs.optStr(40), email: zs.optEmail(), isActive: zs.bool() }) }, async ({ id, ...data }) => {
  if (id) await db.branch.update({ where: { id }, data });
  else await db.branch.create({ data });
  return true;
});

// ── Backups ──
export const backupNow = defineAction({ perm: "settings.manage", revalidate: "/settings/backups", schema: z.object({}) }, async () => {
  const r = await createBackup();
  pruneBackups();
  return r;
});

/** POC: throw away every change and reload the original mock data (data/demo-data.json). Signs everyone out. */
export const resetDemoData = defineAction({ perm: "settings.manage", revalidate: "/", schema: z.object({}) }, async () => {
  resetJsonData();
  return "Demo data reset";
});

// ── Integrations ──
export const sendTestMessage = defineAction({ perm: "settings.manage", schema: z.object({ channel: z.enum(["SMS", "WHATSAPP", "EMAIL"]), to: zs.str(120) }) }, async ({ channel, to }) => {
  const r = await sendExternal(channel, to, { subject: "Test message", body: "This is a test message from the School Management System.", category: "TEST" });
  return r;
});
