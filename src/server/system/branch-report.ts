import "server-only";
import { db } from "@/lib/db";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { round2, toNum, today } from "@/lib/format";
import { stockValue } from "@/server/stationery/core";

/** One row per branch: the main figures side by side. Super Admin only (every other role sees only their branch). */
export const branchReports: ReportDef[] = [
  {
    key: "branches-summary", title: "All branches summary", module: "All branches", perm: "reports.fees", roles: ["SUPER_ADMIN"],
    description: "Students, fee collection and dues, pending uniform orders, stationery stock value and bus seats for every branch side by side.",
    filters: ["dateRange"],
    async run(f) {
      const branches = await db.branch.findMany({ orderBy: { name: "asc" } });
      const paid = dateWhere(f);
      const t = today();
      const rows = await Promise.all(branches.map(async (b) => {
        const [students, collected, dues, overdue, uniforms, stock, buses, filled] = await Promise.all([
          db.student.count({ where: { branchId: b.id, status: "ACTIVE" } }),
          db.payment.aggregate({ where: { branchId: b.id, status: "SUCCESS", purpose: "FEE", ...(paid ? { paidAt: paid } : {}) }, _sum: { amount: true, refundedAmount: true } }),
          db.studentFee.aggregate({ where: { student: { branchId: b.id, status: "ACTIVE" }, status: { in: ["PENDING", "PARTIAL"] } }, _sum: { balance: true } }),
          db.studentFee.aggregate({ where: { student: { branchId: b.id, status: "ACTIVE" }, status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: t } }, _sum: { balance: true } }),
          db.uniformOrder.count({ where: { branchId: b.id, status: { in: ["ORDERED", "PAID", "READY"] } } }),
          stockValue(b.id),
          db.bus.aggregate({ where: { branchId: b.id, isActive: true }, _sum: { capacity: true } }),
          db.transportAllocation.count({ where: { status: "ACTIVE", bus: { branchId: b.id, isActive: true } } }),
        ]);
        const seats = buses._sum.capacity ?? 0;
        return {
          branch: `${b.name} (${b.code})`, students,
          collected: round2(toNum(collected._sum.amount) - toNum(collected._sum.refundedAmount)),
          dues: round2(toNum(dues._sum.balance)), overdue: round2(toNum(overdue._sum.balance)),
          uniformsPending: uniforms, stockValue: round2(stock), seats, filled,
          occupancy: seats ? round2((filled / seats) * 100) : 0,
        };
      }));
      const sum = (k: "students" | "collected" | "dues" | "overdue" | "uniformsPending" | "stockValue" | "seats" | "filled") => round2(rows.reduce((s, r) => s + r[k], 0));
      const seats = sum("seats"), filled = sum("filled");
      return {
        columns: [
          { key: "branch", label: "Branch" }, { key: "students", label: "Students", format: "number" },
          { key: "collected", label: "Fees collected (net)", format: "money" }, { key: "dues", label: "Pending dues", format: "money" }, { key: "overdue", label: "Overdue", format: "money" },
          { key: "uniformsPending", label: "Uniform orders open", format: "number" }, { key: "stockValue", label: "Stationery stock value", format: "money" },
          { key: "seats", label: "Bus seats", format: "number" }, { key: "filled", label: "Seats filled", format: "number" }, { key: "occupancy", label: "% filled", format: "number" },
        ],
        rows,
        totals: { branch: "All branches", students: sum("students"), collected: sum("collected"), dues: sum("dues"), overdue: sum("overdue"), uniformsPending: sum("uniformsPending"), stockValue: sum("stockValue"), seats, filled, occupancy: seats ? round2((filled / seats) * 100) : 0 },
        chart: rows.length > 1 ? { type: "bar", x: "branch", y: ["collected", "dues"] } : undefined,
        note: "Fees collected is for the chosen dates (all dates when none are chosen); the other figures are as of today.",
      };
    },
  },
];
