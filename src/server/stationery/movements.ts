import "server-only";
import type { MovementType, Prisma } from "@prisma/client";
import { MOVEMENT_LABELS } from "./core";

export type MovementFilter = { itemId?: string; type?: string; classId?: string; departmentId?: string; userId?: string; byId?: string; studentQ?: string; from?: string; to?: string; dir?: string };

/** Where clause for the movement log (all filters optional). Dates are school-time (IST) days. */
export function movementWhere(branchId: string, f: MovementFilter): Prisma.StockMovementWhereInput {
  const type = (Object.keys(MOVEMENT_LABELS) as MovementType[]).find((t) => t === f.type);
  return {
    item: { branchId },
    ...(f.itemId ? { itemId: f.itemId } : {}),
    ...(type ? { type } : {}),
    ...(f.classId ? { classId: f.classId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.userId ? { recipientUserId: f.userId } : {}),
    ...(f.byId ? { createdById: f.byId } : {}),
    ...(f.dir === "in" ? { qty: { gt: 0 } } : f.dir === "out" ? { qty: { lt: 0 } } : {}),
    ...(f.studentQ ? { student: { OR: [{ firstName: { contains: f.studentQ, mode: "insensitive" } }, { lastName: { contains: f.studentQ, mode: "insensitive" } }, { admissionNo: { contains: f.studentQ, mode: "insensitive" } }] } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(f.from + "T00:00:00+05:30") } : {}), ...(f.to ? { lte: new Date(f.to + "T23:59:59.999+05:30") } : {}) } } : {}),
  };
}

export function movementFilterFrom(get: (k: string) => string | undefined): MovementFilter {
  return { itemId: get("itemId"), type: get("type"), classId: get("classId"), departmentId: get("departmentId"), userId: get("userId"), byId: get("byId"), studentQ: get("student"), from: get("from"), to: get("to"), dir: get("dir") };
}
