import Link from "next/link";
import type { PoStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { supplierOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, LinkButton, StatusBadge, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, FilterDate } from "@/components/ui/client";
import { fmtDate, money, toNum } from "@/lib/format";
import { Plus, ShoppingCart } from "lucide-react";

export const metadata = { title: "Purchase orders" };
const STATUSES: PoStatus[] = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const status = STATUSES.find((x) => x === sp(s, "status"));
  const from = sp(s, "from"), to = sp(s, "to");
  const where: Prisma.PurchaseOrderWhereInput = {
    branchId: user.branchId, type: "STATIONERY",
    ...(status ? { status } : sp(s, "open") === "1" ? { status: { in: ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"] } } : {}),
    ...(sp(s, "supplierId") ? { supplierId: sp(s, "supplierId") } : {}),
    ...(sp(s, "auto") === "1" ? { isAutoDraft: true } : {}),
    ...(sp(s, "q") ? { OR: [{ poNumber: { contains: sp(s, "q"), mode: "insensitive" } }, { invoiceNo: { contains: sp(s, "q"), mode: "insensitive" } }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from + "T00:00:00+05:30") } : {}), ...(to ? { lte: new Date(to + "T23:59:59.999+05:30") } : {}) } } : {}),
  };
  const [total, rows, suppliers] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({ where, include: { supplier: { select: { name: true } }, lines: { select: { qtyOrdered: true, qtyReceived: true, unitPrice: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    supplierOptions(user.branchId),
  ]);
  const manage = hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title="Purchase orders" description="Draft → ordered → received. Receiving adds stock and records the supplier's price." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Purchase orders" }]}
        actions={manage && <>
          <LinkButton href="/stationery/purchases/new?quick=1"><ShoppingCart className="size-4" />Record purchase</LinkButton>
          <LinkButton href="/stationery/purchases/new" variant="primary"><Plus className="size-4" />New order</LinkButton>
        </>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="PO or invoice number" />
            <FilterSelect name="status" label="Any status" options={STATUSES.map((x) => ({ value: x, label: x.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} />
            <FilterSelect name="supplierId" label="All suppliers" options={suppliers.map((x) => ({ value: x.id, label: x.name }))} />
            <FilterSelect name="auto" label="All orders" options={[{ value: "1", label: "Auto-drafted" }]} />
            <FilterDate name="from" label="From" />
            <FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>PO</TH><TH>Supplier</TH><TH align="right">Lines</TH><TH align="right">Received</TH><TH align="right">Value</TH><TH>Created</TH><TH>Status</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7} />}
            {rows.map((p) => {
              const ord = p.lines.reduce((a, l) => a + l.qtyOrdered, 0);
              const rec = p.lines.reduce((a, l) => a + l.qtyReceived, 0);
              const val = p.lines.reduce((a, l) => a + l.qtyOrdered * toNum(l.unitPrice), 0);
              return (
                <TR key={p.id}>
                  <TD><Link href={`/stationery/purchases/${p.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{p.poNumber}</Link>{p.isAutoDraft && <Badge tone="purple" className="ml-2">Auto</Badge>}{p.invoiceNo && <span className="block text-xs text-slate-500">Inv. {p.invoiceNo}</span>}</TD>
                  <TD>{p.supplier.name}</TD>
                  <TD align="right">{p.lines.length}</TD>
                  <TD align="right">{rec} / {ord}</TD>
                  <TD align="right">{money(val)}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(p.createdAt)}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/purchases" />
      </Card>
    </>
  );
}
