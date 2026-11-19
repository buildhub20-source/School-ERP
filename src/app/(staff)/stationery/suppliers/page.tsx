import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { priceComparison } from "@/server/stationery/service";
import { itemOptions, supplierOptions } from "@/server/stationery/lookups";
import { CATEGORIES } from "@/server/stationery/core";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge, Tabs } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { money, fmtDate, isoDate } from "@/lib/format";
import { SupplierFormButton, QuoteButton } from "./supplier-forms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const view = s.view === "compare" ? "compare" : "list";
  const manage = hasPerm(user, "stationery.manage");
  const [allItems, allSuppliers] = await Promise.all([itemOptions(user.branchId), supplierOptions(user.branchId)]);
  const header = <PageHeader title="Suppliers" description="Contacts, price history and purchase orders." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Suppliers" }]}
    actions={manage && <><QuoteButton suppliers={allSuppliers} items={allItems} today={isoDate()} /><SupplierFormButton /></>} />;
  const tabNav = <Tabs active={view === "compare" ? "/stationery/suppliers?view=compare" : "/stationery/suppliers"} tabs={[{ href: "/stationery/suppliers", label: "Suppliers" }, { href: "/stationery/suppliers?view=compare", label: "Compare prices" }]} />;

  if (view === "compare") {
    const { page, pageSize, skip, take } = pageParams(s, 20);
    const where: Prisma.StationeryItemWhereInput = { branchId: user.branchId, isActive: true, prices: { some: {} }, ...(sp(s, "category") ? { category: sp(s, "category") } : {}), ...(sp(s, "q") ? { name: { contains: sp(s, "q"), mode: "insensitive" } } : {}) };
    const [total, items] = await Promise.all([db.stationeryItem.count({ where }), db.stationeryItem.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], skip, take })]);
    const { latest, suppliers } = await priceComparison(user.branchId, items.map((i) => i.id));
    const cols = [...suppliers.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return (
      <>
        {header}{tabNav}
        <Card>
          <CardHeader title="Latest price per supplier" description="Lowest price for each item is highlighted. Prices come from quotes and received purchase orders." />
          <div className="border-b border-slate-100 p-3">
            <FilterBar>
              <input type="hidden" name="view" value="compare" />
              <SearchField placeholder="Item name" />
              <FilterSelect name="category" label="All categories" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            </FilterBar>
          </div>
          <Table>
            <THead><tr><TH>Item</TH>{cols.map(([id, name]) => <TH key={id} align="right">{name}</TH>)}<TH align="right">Saving</TH></tr></THead>
            <TBody>
              {items.length === 0 && <EmptyRow colSpan={cols.length + 2} message="No prices recorded yet. Record a quote or receive a purchase order." />}
              {items.map((i) => {
                const m = latest.get(i.id);
                const vals = cols.map(([sid]) => m?.get(sid)?.price).filter((v): v is number => v !== undefined);
                const min = vals.length ? Math.min(...vals) : undefined;
                const max = vals.length ? Math.max(...vals) : undefined;
                return (
                  <TR key={i.id}>
                    <TD><Link href={`/stationery/items/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.name}</Link><span className="block text-xs text-slate-500">{i.category} · per {i.unit}</span></TD>
                    {cols.map(([sid]) => {
                      const p = m?.get(sid);
                      const best = p && vals.length > 1 && p.price === min;
                      return <TD key={sid} align="right" className={best ? "bg-emerald-50 font-semibold text-emerald-800" : ""}>{p ? <>{money(p.price)}<span className="block text-[11px] font-normal text-slate-400">{fmtDate(p.date)}</span></> : "—"}</TD>;
                    })}
                    <TD align="right">{min !== undefined && max !== undefined && max > min ? <Badge tone="green">{money(max - min)}</Badge> : "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/suppliers" />
        </Card>
      </>
    );
  }

  const { page, pageSize, skip, take } = pageParams(s);
  const where: Prisma.SupplierWhereInput = {
    branchId: user.branchId, supplies: { has: "STATIONERY" }, isActive: sp(s, "inactive") === "1" ? false : true,
    ...(sp(s, "q") ? { OR: [{ name: { contains: sp(s, "q"), mode: "insensitive" } }, { contactPerson: { contains: sp(s, "q"), mode: "insensitive" } }, { phone: { contains: sp(s, "q") } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.supplier.count({ where }),
    db.supplier.findMany({ where, include: { _count: { select: { preferredFor: true, purchaseOrders: { where: { type: "STATIONERY" } } } } }, orderBy: { name: "asc" }, skip, take }),
  ]);
  return (
    <>
      {header}{tabNav}
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name, contact or phone" />
            <FilterSelect name="inactive" label="Active" options={[{ value: "1", label: "Inactive" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Supplier</TH><TH>Contact</TH><TH>Phone / email</TH><TH align="right">Usual supplier for</TH><TH align="right">Orders</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((x) => (
              <TR key={x.id}>
                <TD><Link href={`/stationery/suppliers/${x.id}`} className="font-medium text-slate-900 hover:text-brand-700">{x.name}</Link>{x.gstin && <span className="block font-mono text-xs text-slate-500">{x.gstin}</span>}</TD>
                <TD>{x.contactPerson ?? "—"}</TD>
                <TD>{x.phone ?? "—"}{x.email && <span className="block text-xs text-slate-500">{x.email}</span>}</TD>
                <TD align="right">{x._count.preferredFor} items</TD>
                <TD align="right">{x._count.purchaseOrders}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/suppliers" />
      </Card>
    </>
  );
}
