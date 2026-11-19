import type { Permission } from "../permissions";
import type { SessionUser } from "../auth/session";

export type FilterKey = "dateRange" | "class" | "section" | "item" | "uniformItem" | "route" | "bus" | "term" | "mode" | "supplier" | "teacher" | "year" | "status";

export type ReportFilters = {
  from?: Date;
  to?: Date;
  classId?: string;
  sectionId?: string;
  itemId?: string;
  uniformItemId?: string;
  routeId?: string;
  busId?: string;
  termId?: string;
  mode?: string;
  supplierId?: string;
  teacherId?: string;
  yearId?: string;
  status?: string;
  groupBy?: string;
};

export type Column = { key: string; label: string; format?: "money" | "number" | "date" | "datetime" | "text"; align?: "left" | "right" };

export type ReportResult = {
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  /** Optional chart: x = column key for labels, y = column keys for values */
  chart?: { type: "bar" | "line"; x: string; y: string[] };
  note?: string;
};

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  module: "Stationery" | "Uniforms" | "Fees" | "Transport" | "Students" | "Library" | "Assets" | "Hostel" | "HR" | "All branches";
  perm: Permission;
  /** Limit the report to these roles (in addition to `perm`), e.g. cross-branch figures for the Super Admin only. */
  roles?: string[];
  filters: FilterKey[];
  /** Options for a "group by" selector, e.g. [{value:"month",label:"Month"}] */
  groupBy?: { value: string; label: string }[];
  /** Choices for the "status" filter: `label` is what an empty selection means (e.g. "Any status"). */
  statusFilter?: { label: string; options: { value: string; label: string }[] };
  /** Fields hidden from users without these permissions are the report's responsibility. */
  run: (filters: ReportFilters, ctx: { user: SessionUser; branchId: string }) => Promise<ReportResult>;
};
