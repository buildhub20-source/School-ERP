import "server-only";
import { db } from "@/lib/db";
import { isAutomationEnabled } from "@/lib/automations/config";
import { notifyPermission, notifyUsers } from "@/lib/messaging/notify";
import { getRequestContext } from "@/lib/context";
import { toNum } from "@/lib/format";
import { docNumber } from "./core";

/**
 * Automation "stationery.lowStock". Runs after every stock change on the touched items:
 * - stock at/below reorder level and not yet alerted → alert holders of stationery.manage and add the item
 *   to ONE open auto-draft purchase order for its usual supplier (created if needed); mark lowStockAlertedAt.
 * - stock back above the reorder level → clear lowStockAlertedAt so the next drop alerts again.
 */
export async function checkLowStock(branchId: string, itemIds: string[]) {
  if (!itemIds.length) return { alerted: 0 };
  const items = await db.stationeryItem.findMany({ where: { branchId, id: { in: itemIds } } });
  const restocked = items.filter((i) => i.lowStockAlertedAt && (i.reorderLevel <= 0 || i.currentStock > i.reorderLevel)).map((i) => i.id);
  if (restocked.length) await db.stationeryItem.updateMany({ where: { id: { in: restocked } }, data: { lowStockAlertedAt: null } });

  const low = items.filter((i) => i.isActive && i.reorderLevel > 0 && i.currentStock <= i.reorderLevel && !i.lowStockAlertedAt);
  if (!low.length || !(await isAutomationEnabled("stationery.lowStock"))) return { alerted: 0 };

  const createdById = getRequestContext()?.userId ?? null;
  let alerted = 0;
  for (const item of low) {
    // Claim the alert atomically so concurrent stock changes do not alert twice.
    const claim = await db.stationeryItem.updateMany({ where: { id: item.id, lowStockAlertedAt: null }, data: { lowStockAlertedAt: new Date() } });
    if (!claim.count) continue;
    alerted++;

    // The usual supplier: preferred supplier, else the supplier of the latest purchase.
    let supplierId = item.preferredSupplierId;
    if (!supplierId) {
      const last = await db.supplierPrice.findFirst({ where: { stationeryItemId: item.id, source: "PURCHASE" }, orderBy: { effectiveDate: "desc" } });
      supplierId = last?.supplierId ?? null;
    }
    const orderQty = item.reorderQty > 0 ? item.reorderQty : Math.max(item.reorderLevel * 2 - item.currentStock, 1);
    let poInfo = "No usual supplier is set, so no purchase order was drafted.";
    let link = `/stationery/items/${item.id}`;
    if (supplierId) {
      const lastPrice = await db.supplierPrice.findFirst({ where: { stationeryItemId: item.id, supplierId }, orderBy: { effectiveDate: "desc" } });
      const unitPrice = lastPrice ? toNum(lastPrice.price) : toNum(item.unitCost);
      const po = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stn-autopo-${supplierId}`}))`;
        let draft = await tx.purchaseOrder.findFirst({ where: { branchId, supplierId: supplierId!, type: "STATIONERY", status: "DRAFT", isAutoDraft: true }, include: { lines: true } });
        if (!draft) {
          draft = await tx.purchaseOrder.create({
            data: { branchId, supplierId: supplierId!, type: "STATIONERY", status: "DRAFT", isAutoDraft: true, poNumber: await docNumber("PO", tx), createdById, notes: "Drafted automatically for items at or below their reorder level." },
            include: { lines: true },
          });
        }
        if (!draft.lines.some((l) => l.stationeryItemId === item.id)) {
          await tx.purchaseOrderLine.create({ data: { poId: draft.id, stationeryItemId: item.id, qtyOrdered: orderQty, unitPrice } });
        }
        return draft;
      });
      poInfo = `Added ${orderQty} ${item.unit} to draft purchase order ${po.poNumber}.`;
      link = `/stationery/purchases/${po.id}`;
    }
    await notifyPermission("stationery.manage", {
      title: `Low stock: ${item.name}`,
      body: `${item.name} (${item.code}) is down to ${item.currentStock} ${item.unit}; reorder level is ${item.reorderLevel}. ${poInfo}`,
      link, category: "STATIONERY",
    }, branchId);
  }
  return { alerted };
}

/** Daily: remind approvers about stationery requests pending longer than config.days. */
export async function stationeryPendingReminder(config: Record<string, unknown>): Promise<string> {
  const days = Math.max(0, Number(config.days ?? 2) || 2);
  const cutoff = new Date(Date.now() - days * 86400000);
  const pending = await db.stationeryRequest.findMany({
    where: { status: "PENDING", createdAt: { lte: cutoff }, reminderSentAt: null },
    include: { requestedBy: { select: { name: true } }, _count: { select: { lines: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!pending.length) return `No stationery requests pending over ${days} day(s)`;
  const byBranch = new Map<string, typeof pending>();
  for (const r of pending) byBranch.set(r.branchId, [...(byBranch.get(r.branchId) ?? []), r]);
  for (const [branchId, list] of byBranch) {
    const lines = list.slice(0, 10).map((r) => `${r.requestNo} — ${r.requestedBy.name}, ${r._count.lines} item(s), since ${r.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`);
    await notifyPermission("stationery.approve", {
      title: `${list.length} stationery request${list.length === 1 ? "" : "s"} waiting for approval`,
      body: `Pending for more than ${days} day(s):\n${lines.join("\n")}${list.length > 10 ? `\n…and ${list.length - 10} more` : ""}`,
      link: "/stationery/requests?status=PENDING", category: "STATIONERY",
    }, branchId);
    await db.stationeryRequest.updateMany({ where: { id: { in: list.map((r) => r.id) } }, data: { reminderSentAt: new Date() } });
  }
  return `Reminded approvers about ${pending.length} pending stationery request(s)`;
}

/** Automation "stationery.issued": tell the requesting teacher what was issued. */
export async function notifyIssued(request: { id: string; requestNo: string; requestedById: string }, summary: string) {
  if (!(await isAutomationEnabled("stationery.issued"))) return;
  await notifyUsers([request.requestedById], {
    title: `Stationery issued: ${request.requestNo}`,
    body: `Your request ${request.requestNo} has been issued. ${summary}`,
    link: `/teacher/requests/${request.id}`, category: "STATIONERY",
  });
}
