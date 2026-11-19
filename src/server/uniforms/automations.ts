import "server-only";
import { db } from "@/lib/db";
import { isAutomationEnabled } from "@/lib/automations/config";
import { notifyGuardians } from "@/lib/messaging/notify";
import { fullName } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { suggestSizes } from "./core";

/** Automation uniforms.ready (event): when an order is marked Ready, tell the parent to collect it. */
export async function notifyOrderReady(orderId: string) {
  if (!(await isAutomationEnabled("uniforms.ready"))) return false;
  const o = await db.uniformOrder.findUnique({ where: { id: orderId }, include: { student: true, lines: { include: { variant: { include: { item: true } } } } } });
  if (!o || o.status !== "READY") return false;
  const items = o.lines.filter((l) => l.qty - l.qtyReturned > 0).map((l) => `${l.variant.item.name} (${l.variant.size}) × ${l.qty - l.qtyReturned}`).join(", ");
  await notifyGuardians(o.studentId, {
    title: `Uniform order ${o.orderNo} is ready`,
    body: `${fullName(o.student)}'s uniform order is ready for collection at the school store: ${items}.`,
    link: "/parent/uniforms",
    category: "UNIFORM",
    template: "UNIFORM_READY",
    ta: { title: `சீருடை ஆர்டர் ${o.orderNo} தயார்`, body: `${fullName(o.student)} இன் சீருடை ஆர்டர் பள்ளி கடையில் பெற்றுக்கொள்ள தயாராக உள்ளது: ${items}.` },
  });
  return true;
}

/** Tell every parent the pre-order window is open, with each child's suggested sizes. Returns the number of students notified. */
export async function notifyPreorderSizes(academicYearId: string, branchId?: string) {
  const year = await db.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
  const steps = (await getSetting("policies")).sizeGrowthSteps;
  const students = await db.student.findMany({ where: { status: "ACTIVE", ...(branchId ? { branchId } : {}), guardians: { some: {} } }, select: { id: true, firstName: true, lastName: true } });
  let n = 0;
  for (const s of students) {
    const sizes = [...(await suggestSizes(s.id, year.startDate, db, steps)).values()];
    const list = sizes.length ? `Suggested sizes: ${sizes.map((x) => `${x.itemName} ${x.size}`).join(", ")}.` : "Choose sizes when you place the order.";
    await notifyGuardians(s.id, {
      title: `Uniform pre-orders are open for ${year.name}`,
      body: `Pre-order ${fullName(s)}'s uniforms for ${year.name} and pay online. ${list}`,
      link: "/parent/uniforms",
      category: "UNIFORM",
      template: "UNIFORM_PREORDER",
      ta: {
        title: `${year.name} க்கான சீருடை முன்பதிவு திறக்கப்பட்டுள்ளது`,
        body: `${fullName(s)} இன் ${year.name} சீருடைகளை முன்பதிவு செய்து ஆன்லைனில் செலுத்துங்கள். ${sizes.length ? `பரிந்துரைக்கப்பட்ட அளவுகள்: ${sizes.map((x) => `${x.itemName} ${x.size}`).join(", ")}.` : "ஆர்டர் செய்யும் போது அளவைத் தேர்ந்தெடுக்கவும்."}`,
      },
    });
    n++;
  }
  return n;
}

/**
 * Automation uniforms.newYear (event, called from the year-close flow): opens parent pre-orders for the year
 * and notifies parents with each child's suggested sizes. Idempotent: parents are notified only when the window opens.
 */
export async function openPreorders(academicYearId: string): Promise<string> {
  if (!(await isAutomationEnabled("uniforms.newYear"))) return "Uniform pre-order automation is turned off.";
  const year = await db.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) return "Academic year not found.";
  if (year.preorderOpen) return `Uniform pre-orders for ${year.name} were already open.`;
  await db.academicYear.update({ where: { id: year.id }, data: { preorderOpen: true, preorderOpensAt: new Date() } });
  const n = await notifyPreorderSizes(year.id);
  return `Opened uniform pre-orders for ${year.name}; notified parents of ${n} students.`;
}
