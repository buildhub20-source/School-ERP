import "server-only";
import { db } from "@/lib/db";
import { notifyUsers, sendExternal } from "@/lib/messaging/notify";

/** Deliver a circular to its audience: parents (by class or all), staff, or everyone. */
export async function sendCircular(circularId: string) {
  const c = await db.circular.findUniqueOrThrow({ where: { id: circularId } });
  const userIds = new Set<string>();
  const smsOnly = new Set<string>();
  if (c.audience === "ALL_PARENTS" || c.audience === "EVERYONE" || c.audience === "CLASSES") {
    const links = await db.studentGuardian.findMany({
      where: { student: { branchId: c.branchId, status: "ACTIVE", ...(c.audience === "CLASSES" ? { classId: { in: c.classIds } } : {}) } },
      include: { guardian: true },
    });
    for (const l of links) {
      if (l.guardian.userId) userIds.add(l.guardian.userId);
      else smsOnly.add(l.guardian.phone);
    }
  }
  if (c.audience === "ALL_STAFF" || c.audience === "EVERYONE") {
    const staff = await db.user.findMany({ where: { branchId: c.branchId, isActive: true, role: { key: { notIn: ["PARENT"] } } }, select: { id: true } });
    staff.forEach((s) => userIds.add(s.id));
  }
  const ta = c.titleTa && c.bodyTa ? { title: c.titleTa, body: c.bodyTa } : undefined;
  await notifyUsers([...userIds], { title: c.title, body: c.body, ta, link: "/parent/circulars", category: c.type, template: "CIRCULAR" });
  for (const phone of smsOnly) await sendExternal("SMS", phone, { body: `${c.title}\n${c.body}`, category: c.type, template: "CIRCULAR", vars: [c.title, c.body], branchId: c.branchId });
  await db.circular.update({ where: { id: c.id }, data: { sentAt: new Date() } });
  return userIds.size + smsOnly.size;
}
