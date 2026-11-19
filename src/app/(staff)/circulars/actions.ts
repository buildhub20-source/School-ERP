"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { sendCircular } from "@/server/communication/service";

export const createCircular = defineAction({
  perm: "circulars.manage", revalidate: "/circulars",
  schema: z.object({ title: zs.str(150), body: zs.str(4000), titleTa: zs.optStr(150), bodyTa: zs.optStr(4000), type: z.enum(["CIRCULAR", "HOLIDAY", "EVENT", "GREETING"]), audience: z.enum(["ALL_PARENTS", "ALL_STAFF", "EVERYONE", "CLASSES"]), classIds: z.array(z.string()).default([]), sendNow: zs.bool() }),
}, async (i, { branchId, user }) => {
  if (i.audience === "CLASSES" && !i.classIds.length) throw new AppError("Choose at least one class.");
  if (!!i.titleTa !== !!i.bodyTa) throw new AppError("For the Tamil version, fill in both the Tamil title and the Tamil message (or leave both empty).");
  const c = await db.circular.create({ data: { branchId, title: i.title, body: i.body, titleTa: i.titleTa ?? null, bodyTa: i.bodyTa ?? null, type: i.type, audience: i.audience, classIds: i.audience === "CLASSES" ? i.classIds : [], createdById: user.id } });
  const recipients = i.sendNow ? await sendCircular(c.id) : 0;
  return { id: c.id, recipients };
});

export const sendCircularNow = defineAction({ perm: "circulars.manage", revalidate: "/circulars", schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  const c = await db.circular.findFirst({ where: { id, branchId } });
  if (!c) throw new AppError("Circular not found.");
  return { recipients: await sendCircular(id) };
});

export const deleteCircular = defineAction({ perm: "circulars.manage", revalidate: "/circulars", schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  const c = await db.circular.findFirst({ where: { id, branchId } });
  if (!c) throw new AppError("Circular not found.");
  if (c.sentAt) throw new AppError("A circular that was already sent cannot be deleted.");
  await db.circular.delete({ where: { id } });
  return true;
});

export const saveEvent = defineAction({
  perm: "circulars.manage", revalidate: "/circulars",
  schema: z.object({ id: zs.optStr(40), title: zs.str(150), description: zs.optStr(2000), date: zs.date(), endDate: zs.optDate(), type: z.enum(["HOLIDAY", "EVENT"]), audience: z.enum(["ALL_PARENTS", "ALL_STAFF", "EVERYONE"]), notifyDaysBefore: z.coerce.number().int().min(0).max(30) }),
}, async ({ id, ...data }, { branchId }) => {
  if (data.endDate && data.endDate < data.date) throw new AppError("End date is before the start date.");
  if (id) await db.schoolEvent.update({ where: { id }, data: { ...data, endDate: data.endDate ?? null, notifiedAt: null } });
  else await db.schoolEvent.create({ data: { ...data, branchId } });
  return true;
});

export const deleteEvent = defineAction({ perm: "circulars.manage", revalidate: "/circulars", schema: z.object({ id: zs.id }) }, async ({ id }) => {
  await db.schoolEvent.delete({ where: { id } });
  return true;
});
