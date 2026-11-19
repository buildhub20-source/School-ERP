import Link from "next/link";
import type { Prisma, UniformOrderStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge, LinkButton, Tabs } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, FilterDate } from "@/components/ui/client";
import { fmtDate, fullName, money, round2, toNum } from "@/lib/format";
import { Plus } from "lucide-react";

export const metadata = { title: "Uniform orders" };

const TABS = [
  { key: "OPEN", label: "Open" }, { key: "ORDERED", label: "Ordered" }, { key: "PAID", label: "Paid" }, { key: "READY", label: "Ready" },
  { key: "DELIVERED", label: "Delivered" }, { key: "CANCELLED", label: "Cancelled" }, { key: "ALL", label: "All" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const status = sp(s, "status") ?? "OPEN";
  const q = sp(s, "q");
  const classes = await classOptions(user.branchId);
  const base: Prisma.UniformOrderWhereInput = {
    branchId: user.branchId,
    ...(q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { student: { admissionNo: { contains: q, mode: "insensitive" } } }, { student: { firstName: { contains: q, mode: "insensitive" } } }, { student: { lastName: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(sp(s, "classId") ? { student: { classId: sp(s, "classId") } } : {}),
    ...(sp(s, "type") ? { isPreOrder: sp(s, "type") === "pre" } : {}),
    ...(sp(s, "via") ? { placedVia: sp(s, "via") } : {}),
    ...(sp(s, "from") || sp(s, "to") ? { createdAt: { ...(sp(s, "from") ? { gte: new Date(sp(s, "from") + "T00:00:00+05:30") } : {}), ...(sp(s, "to") ? { lte: new Date(sp(s, "to") + "T23:59:59.999+05:30") } : {}) } } : {}),
  };
  const statusWhere = (k: string): Prisma.UniformOrderWhereInput => (k === "ALL" ? {} : k === "OPEN" ? { status: { in: ["ORDERED", "PAID", "READY"] } } : { status: k as UniformOrderStatus });
  const where = { ...base, ...statusWhere(status) };
  const [total, orders, counts] = await Promise.all([
    db.uniformOrder.count({ where }),
    db.uniformOrder.findMany({ where, include: { student: { include: { schoolClass: true, section: true } }, _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    db.uniformOrder.groupBy({ by: ["status"], where: base, _count: true }),
  ]);
  const cnt = (k: string) => counts.filter((c) => k === "ALL" || (k === "OPEN" ? ["ORDERED", "PAID", "READY"].includes(c.status) : c.status === k)).reduce((a, c) => a + c._count, 0);
  const qs = (k: string) => { const p = new URLSearchParams(Object.entries(s).filter(([key, v]) => typeof v === "string" && key !== "page" && key !== "status")); p.set("status", k); return `/uniforms/orders?${p}`; };
  return (
    <>
      <PageHeader title="Uniform orders" breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Orders" }]}
        actions={hasPerm(user, "uniforms.orders") && <LinkButton href="/uniforms/orders/new" variant="primary"><Plus className="size-4" />New order</LinkButton>} />
      <Tabs tabs={TABS.map((t) => ({ href: qs(t.key), label: t.label, count: cnt(t.key) }))} active={qs(status)} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <input type="hidden" name="status" value={status} />
            <SearchField placeholder="Order no, student or admission no" />
            <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <FilterSelect name="type" label="Orders & pre-orders" options={[{ value: "pre", label: "Pre-orders" }, { value: "order", label: "Orders" }]} />
            <FilterSelect name="via" label="Counter & parent" options={[{ value: "COUNTER", label: "Counter" }, { value: "PARENT", label: "Parent portal" }]} />
            <FilterDate name="from" label="From" />
            <FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Order</TH><TH>Student</TH><TH>Class</TH><TH align="right">Items</TH><TH align="right">Total</TH><TH align="right">Balance</TH><TH>Status</TH></tr></THead>
          <TBody>
            {!orders.length && <EmptyRow colSpan={7} />}
            {orders.map((o) => {
              const bal = round2(toNum(o.total) - toNum(o.paidAmount));
              return (
                <TR key={o.id}>
                  <TD><Link href={`/uniforms/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.orderNo}</Link><span className="block text-xs text-slate-500">{fmtDate(o.createdAt)} · {o.placedVia === "PARENT" ? "Parent" : "Counter"}</span></TD>
                  <TD>{fullName(o.student)}<span className="block font-mono text-xs text-slate-500">{o.student.admissionNo}</span></TD>
                  <TD>{o.student.schoolClass.name}{o.student.section ? ` - ${o.student.section.name}` : ""}</TD>
                  <TD align="right">{o._count.lines}</TD>
                  <TD align="right">{money(o.total)}</TD>
                  <TD align="right" className={bal > 0 ? "text-rose-700" : bal < 0 ? "text-amber-700" : ""}>{bal === 0 ? "—" : money(bal)}</TD>
                  <TD><StatusBadge status={o.status} />{o.isPreOrder && <Badge tone="purple" className="ml-1">Pre-order</Badge>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/uniforms/orders" />
      </Card>
    </>
  );
}
