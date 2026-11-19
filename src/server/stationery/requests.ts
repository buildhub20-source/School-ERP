import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { notifyPermission, notifyUsers } from "@/lib/messaging/notify";
import { docNumber, mergeLines, moveStock, withStock } from "./core";
import { notifyIssued } from "./automations";

export type RequestInput = { classId?: string; departmentId?: string; purpose?: string; lines: { itemId: string; qty: number }[] };

export async function createRequest(branchId: string, userId: string, input: RequestInput) {
  const lines = mergeLines(input.lines);
  if (input.classId && input.departmentId) throw new AppError("Choose either a class or a department, not both.");
  if (input.classId && !(await db.schoolClass.findFirst({ where: { id: input.classId, branchId } }))) throw new AppError("Choose a valid class.");
  if (input.departmentId && !(await db.department.findFirst({ where: { id: input.departmentId, branchId } }))) throw new AppError("Choose a valid department.");
  const items = await db.stationeryItem.findMany({ where: { branchId, isActive: true, id: { in: lines.map((l) => l.itemId) } } });
  if (items.length !== lines.length) throw new AppError("One of the items is not available.");
  const req = await db.$transaction(async (tx) => tx.stationeryRequest.create({
    data: {
      branchId, requestNo: await docNumber("SR", tx), requestedById: userId, classId: input.classId ?? null, departmentId: input.departmentId ?? null, purpose: input.purpose ?? null,
      lines: { create: lines.map((l) => ({ itemId: l.itemId, qtyRequested: l.qty })) },
    },
    include: { requestedBy: true },
  }));
  await notifyPermission("stationery.approve", {
    title: `New stationery request ${req.requestNo}`,
    body: `${req.requestedBy.name} requested ${lines.length} item(s)${input.purpose ? ` — ${input.purpose}` : ""}.`,
    link: `/stationery/requests/${req.id}`, category: "STATIONERY", inAppOnly: true,
  }, branchId);
  return req;
}

async function getRequest(branchId: string, id: string) {
  const r = await db.stationeryRequest.findFirst({ where: { id, branchId }, include: { lines: { include: { item: true } } } });
  if (!r) throw new AppError("Request not found.");
  return r;
}

/** Approve in full or in part. qty per line ≤ requested; 0 drops a line. Nobody approves their own request. */
export async function approveRequest(branchId: string, approverId: string, id: string, input: { lines: { lineId: string; qty: number }[]; remarks?: string }) {
  const r = await getRequest(branchId, id);
  if (r.requestedById === approverId) throw new AppError("You cannot approve your own request. Another approver must do it.");
  if (r.status !== "PENDING") throw new AppError(`This request is already ${r.status.replace(/_/g, " ").toLowerCase()}.`);
  const qty = new Map(input.lines.map((l) => [l.lineId, l.qty]));
  let partial = false;
  let total = 0;
  for (const l of r.lines) {
    const q = qty.has(l.id) ? qty.get(l.id)! : l.qtyRequested;
    if (!Number.isInteger(q) || q < 0) throw new AppError(`${l.item.name}: approved quantity must be a whole number, 0 or more.`);
    if (q > l.qtyRequested) throw new AppError(`${l.item.name}: cannot approve more than the ${l.qtyRequested} requested.`);
    if (q < l.qtyRequested) partial = true;
    total += q;
  }
  if (total === 0) throw new AppError("Nothing is approved. Use Reject instead.");
  const status = partial ? "PARTIALLY_APPROVED" : "APPROVED";
  const updated = await db.$transaction(async (tx) => {
    for (const l of r.lines) await tx.stationeryRequestLine.update({ where: { id: l.id }, data: { qtyApproved: qty.has(l.id) ? qty.get(l.id)! : l.qtyRequested } });
    return tx.stationeryRequest.update({ where: { id }, data: { status, approvedById: approverId, approvedAt: new Date(), remarks: input.remarks ?? null } });
  });
  await notifyUsers([r.requestedById], {
    title: `Request ${r.requestNo} ${partial ? "partly approved" : "approved"}`,
    body: `${partial ? "Some quantities were reduced. " : ""}The store will issue the items shortly.${input.remarks ? ` Note: ${input.remarks}` : ""}`,
    link: `/teacher/requests/${r.id}`, category: "STATIONERY", inAppOnly: true,
  });
  return updated;
}

export async function rejectRequest(branchId: string, approverId: string, id: string, reason: string) {
  const r = await getRequest(branchId, id);
  if (r.requestedById === approverId) throw new AppError("You cannot reject your own request. Cancel it instead.");
  if (r.status !== "PENDING" && r.status !== "APPROVED" && r.status !== "PARTIALLY_APPROVED") throw new AppError("Only pending or approved (not yet issued) requests can be rejected.");
  if (!reason.trim()) throw new AppError("Give a reason for rejecting.");
  const updated = await db.stationeryRequest.update({ where: { id }, data: { status: "REJECTED", approvedById: approverId, approvedAt: new Date(), remarks: reason } });
  await notifyUsers([r.requestedById], { title: `Request ${r.requestNo} rejected`, body: `Reason: ${reason}`, link: `/teacher/requests/${r.id}`, category: "STATIONERY", inAppOnly: true });
  return updated;
}

/** The requester cancels their own request before it is issued. */
export async function cancelRequest(branchId: string, userId: string, id: string) {
  const r = await getRequest(branchId, id);
  if (r.requestedById !== userId) throw new AppError("Only the person who made the request can cancel it.");
  if (!["PENDING", "APPROVED", "PARTIALLY_APPROVED"].includes(r.status)) throw new AppError("This request can no longer be cancelled.");
  return db.stationeryRequest.update({ where: { id }, data: { status: "CANCELLED" } });
}

/**
 * Issue an approved request: deducts the approved quantities from stock (all or nothing),
 * records ISSUE movements against the teacher and the class/department budget, notifies the teacher.
 */
export async function issueRequest(branchId: string, issuerId: string, id: string) {
  const r = await getRequest(branchId, id);
  if (r.status !== "APPROVED" && r.status !== "PARTIALLY_APPROVED") throw new AppError(r.status === "PENDING" ? "Approve the request before issuing." : `This request is ${r.status.replace(/_/g, " ").toLowerCase()}.`);
  const toIssue = r.lines.map((l) => ({ line: l, qty: (l.qtyApproved ?? 0) - l.qtyIssued })).filter((x) => x.qty > 0);
  const short = toIssue.filter((x) => x.line.item.currentStock < x.qty).map((x) => `${x.line.item.name} (need ${x.qty}, have ${x.line.item.currentStock})`);
  if (short.length) throw new AppError(`Not enough stock: ${short.join("; ")}. Nothing was issued.`);
  const updated = await withStock(branchId, async (tx, touch) => {
    for (const { line, qty } of toIssue) {
      await moveStock(tx, branchId, {
        itemId: line.itemId, type: "ISSUE", qty: -qty, recipientType: "TEACHER", recipientUserId: r.requestedById,
        classId: r.classId, departmentId: r.departmentId, requestId: r.id, note: r.requestNo,
      });
      await tx.stationeryRequestLine.update({ where: { id: line.id }, data: { qtyIssued: { increment: qty } } });
      touch(line.itemId);
    }
    return tx.stationeryRequest.update({ where: { id }, data: { status: "ISSUED", issuedById: issuerId, issuedAt: new Date() } });
  });
  await notifyIssued(r, toIssue.map((x) => `${x.line.item.name} × ${x.qty}`).join(", ") + ". Please collect from the store.");
  return updated;
}
