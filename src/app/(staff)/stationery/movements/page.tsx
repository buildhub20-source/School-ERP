import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions, departmentOptions, staffOptions } from "@/server/lookups";
import { itemOptions } from "@/server/stationery/lookups";
import { MOVEMENT_LABELS } from "@/server/stationery/core";
import { movementFilterFrom, movementWhere } from "@/server/stationery/movements";
import { PageHeader, Card, Pagination, pageParams, sp, LinkButton } from "@/components/ui";
import { FilterBar, FilterSelect, FilterDate, SearchField } from "@/components/ui/client";
import { Download } from "lucide-react";
import { MovementTable, movementInclude } from "../_components/movement-table";

export const metadata = { title: "Stock movements" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 30);
  const where = movementWhere(user.branchId, movementFilterFrom((k) => sp(s, k)));
  const [total, rows, items, classes, depts, staff] = await Promise.all([
    db.stockMovement.count({ where }),
    db.stockMovement.findMany({ where, include: movementInclude, orderBy: { createdAt: "desc" }, skip, take }),
    itemOptions(user.branchId, true), classOptions(user.branchId), departmentOptions(user.branchId), staffOptions(user.branchId),
  ]);
  const qs = new URLSearchParams(Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "page")).toString();
  return (
    <>
      <PageHeader title="Stock movements" description={`${total} movement${total === 1 ? "" : "s"} — every change with who did it and when.`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Movements" }]}
        actions={<LinkButton href={`/api/stationery/movements?${qs}`}><Download className="size-4" />Excel</LinkButton>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <FilterSelect name="itemId" label="All items" options={items.map((i) => ({ value: i.id, label: i.name }))} />
            <FilterSelect name="type" label="All types" options={Object.entries(MOVEMENT_LABELS).map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="dir" label="In & out" options={[{ value: "in", label: "Stock in" }, { value: "out", label: "Stock out" }]} />
            <FilterSelect name="classId" label="Any class" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <FilterSelect name="departmentId" label="Any department" options={depts.map((d) => ({ value: d.id, label: d.name }))} />
            <FilterSelect name="userId" label="Any staff recipient" options={staff.map((u) => ({ value: u.id, label: u.name }))} />
            <FilterSelect name="byId" label="Recorded by anyone" options={staff.map((u) => ({ value: u.id, label: u.name }))} />
            <SearchField name="student" placeholder="Student name / adm. no" />
            <FilterDate name="from" label="From" />
            <FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <MovementTable rows={rows} />
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/movements" />
      </Card>
    </>
  );
}
