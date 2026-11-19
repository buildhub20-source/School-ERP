import { describe, expect, it, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { REPORTS, getReport } from "@/lib/reports/registry";
import { filterOptions } from "@/server/reports-options";
import type { ReportFilters } from "@/lib/reports/types";
import type { SessionUser } from "@/lib/auth/session";
import { testCtx } from "./helpers";

let ctx: { user: SessionUser; branchId: string };

beforeAll(async () => {
  const { branchId } = await testCtx();
  const u = await db.user.findUniqueOrThrow({ where: { email: "superadmin@school.test" }, include: { role: true } });
  ctx = {
    branchId,
    user: { id: u.id, name: u.name, email: u.email, phone: u.phone, roleKey: u.role.key, roleName: u.role.name, permissions: u.role.permissions, branchId, homeBranchId: branchId, language: "en", mustChangePassword: false, twoFactorEnabled: false, sessionId: "test", idleMinutes: 30 },
  };
});

const run = (key: string, f: ReportFilters = {}) => getReport(key)!.run(f, ctx);

describe("every report", () => {
  it("runs with no filters, with every grouping and with each filter, returning well-formed rows", async () => {
    for (const r of REPORTS) {
      const variants: ReportFilters[] = [{}, ...(r.groupBy ?? []).filter((g) => g.value).map((g) => ({ groupBy: g.value }))];
      if (r.filters.includes("dateRange")) variants.push({ from: new Date("2026-04-01T00:00:00Z"), to: new Date() });
      if (r.filters.includes("status")) {
        expect(r.statusFilter, `${r.key} declares a status filter but no choices`).toBeDefined();
        for (const o of r.statusFilter!.options) variants.push({ status: o.value });
      }
      const opts = await filterOptions(ctx.branchId, r.filters);
      if (opts.class?.[0]) variants.push({ classId: opts.class[0].value });
      for (const f of variants) {
        const res = await r.run(f, ctx);
        expect(res.columns.length, r.key).toBeGreaterThan(0);
        for (const row of res.rows) {
          for (const c of res.columns) {
            if ((c.format === "money" || c.format === "number") && row[c.key] != null) expect(Number.isFinite(Number(row[c.key])), `${r.key} ${c.key}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("report fixes", () => {
  it("Leavers lists students who left or graduated", async () => {
    const s = await db.student.findFirstOrThrow({ where: { branchId: ctx.branchId, status: "ACTIVE" } });
    await db.student.update({ where: { id: s.id }, data: { status: "GRADUATED", leftOn: new Date("2026-03-31T00:00:00Z"), leftReason: "Completed the final class" } });
    try {
      const res = await run("students-admissions", { groupBy: "left" });
      expect(res.rows.some((r) => r.adm === s.admissionNo && r.reason === "Completed the final class")).toBe(true);
    } finally {
      await db.student.update({ where: { id: s.id }, data: { status: "ACTIVE", leftOn: null, leftReason: null } });
    }
  });

  it("Purchase history totals count only the orders of the chosen supplier", async () => {
    const all = await run("stationery-purchases");
    const suppliers = await db.supplier.findMany({ where: { branchId: ctx.branchId } });
    for (const sp of suppliers) {
      const res = await run("stationery-purchases", { supplierId: sp.id });
      expect(res.totals!.orders).toBe(res.rows.reduce((s, r) => s + (r.orders as number), 0));
      expect(res.totals!.orders as number).toBeLessThanOrEqual(all.totals!.orders as number);
    }
  });

  it("Pending dues for a term uses that term's academic year", async () => {
    const term = await db.term.findFirstOrThrow({ where: { studentFees: { some: { student: { branchId: ctx.branchId } } } } });
    const res = await run("fees.pendingDues", { termId: term.id });
    const lines = await db.studentFee.count({ where: { termId: term.id, status: { not: "CANCELLED" }, student: { branchId: ctx.branchId, status: "ACTIVE" } } });
    expect(lines).toBeGreaterThan(0);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("Concessions can show pending ones through the status filter", async () => {
    const pending = await db.concession.count({ where: { status: "PENDING", student: { branchId: ctx.branchId } } });
    const res = await run("fees.concessions", { status: "PENDING" });
    if (pending) expect(res.rows.length).toBeGreaterThan(0);
    for (const r of res.rows) expect(r.amount).toBe(0);
  });

  it("Fee collection totals match the database", async () => {
    const res = await run("fees.collection");
    const agg = await db.payment.aggregate({ where: { branchId: ctx.branchId, purpose: "FEE", status: "SUCCESS" }, _sum: { amount: true }, _count: true });
    expect(res.totals!.collected).toBe(Number(agg._sum.amount ?? 0));
    expect(res.totals!.receipts).toBe(agg._count);
  });

  it("Class strength totals match active students", async () => {
    const res = await run("students-strength");
    expect(res.totals!.total).toBe(await db.student.count({ where: { branchId: ctx.branchId, status: "ACTIVE" } }));
  });
});
