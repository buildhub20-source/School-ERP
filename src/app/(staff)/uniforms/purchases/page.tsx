import Link from "next/link";
import type { PoStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fmtDate, money, round2, toNum } from "@/lib/format";
import { SupplierModal } from "../_components/forms";
import { PurchaseModal } from "../_components/purchase-extra";
import { purchaseOptions } from "../_components/purchase-data";

export const metadata = { title: "Uniform purchases" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const where: Prisma.PurchaseOrderWhereInput = {
    branchId: user.branchId, type: "UNIFORM",
    ...(sp(s, "status") ? { status: sp(s, "status") as PoStatus } : {}),
    ...(sp(s, "supplierId") ? { supplierId: sp(s, "supplierId") } : {}),
    ...(q ? { OR: [{ poNumber: { contains: q, mode: "insensitive" } }, { invoiceNo: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, pos, opts] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({ where, include: { supplier: true, lines: true }, orderBy: { createdAt: "desc" }, skip, take }),
    purchaseOptions(user.branchId),
  ]);
  const canManage = hasPerm(user, "uniforms.manage");
  return (
    <>
      <PageHeader title="Uniform purchases" description="Purchase orders to suppliers. Receiving goods adds stock and records the supplier's price." breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Purchases" }]}
        actions={canManage && <>
          <SupplierModal />
          <PurchaseModal label="Quick purchase" variant="secondary" defaultStatus="RECEIVED" suppliers={opts.suppliers} variants={opts.variants} />
          <PurchaseModal label="New purchase order" suppliers={opts.suppliers} variants={opts.variants} />
        </>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="PO or invoice number" />
            <FilterSelect name="status" label="Any status" options={["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].map((x) => ({ value: x, label: x.charAt(0) + x.slice(1).toLowerCase().replace("_", " ") }))} />
            <FilterSelect name="supplierId" label="All suppliers" options={opts.suppliers.map((x) => ({ value: x.id, label: x.name }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>PO</TH><TH>Supplier</TH><TH>Date</TH><TH align="right">Qty ordered</TH><TH align="right">Received</TH><TH align="right">Value</TH><TH>Status</TH></tr></THead>
          <TBody>
            {!pos.length && <EmptyRow colSpan={7} message="No uniform purchases yet." />}
            {pos.map((p) => (
              <TR key={p.id}>
                <TD><Link href={`/uniforms/purchases/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.poNumber}</Link>{p.isAutoDraft && <Badge className="ml-1" tone="purple">From shortfall</Badge>}</TD>
                <TD>{p.supplier.name}</TD>
                <TD>{fmtDate(p.orderedAt ?? p.createdAt)}</TD>
                <TD align="right">{p.lines.reduce((a, l) => a + l.qtyOrdered, 0)}</TD>
                <TD align="right">{p.lines.reduce((a, l) => a + l.qtyReceived, 0)}</TD>
                <TD align="right">{money(round2(p.lines.reduce((a, l) => a + l.qtyOrdered * toNum(l.unitPrice), 0)))}</TD>
                <TD><StatusBadge status={p.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/uniforms/purchases" />
      </Card>
    </>
  );
}
