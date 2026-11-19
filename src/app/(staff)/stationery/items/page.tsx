import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CATEGORIES, UNITS, itemWhere, stockState } from "@/server/stationery/core";
import { supplierOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, LinkButton, StatusBadge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { money, toNum } from "@/lib/format";
import { QrCode, Upload } from "lucide-react";
import { ItemFormButton } from "./item-form";

export const metadata = { title: "Stationery items" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const where = await itemWhere(user.branchId, { q: sp(s, "q"), category: sp(s, "category"), supplierId: sp(s, "supplierId"), stock: sp(s, "stock"), inactive: sp(s, "inactive") === "1" });
  const [total, items, suppliers, cats] = await Promise.all([
    db.stationeryItem.count({ where }),
    db.stationeryItem.findMany({ where, include: { preferredSupplier: { select: { name: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }], skip, take }),
    supplierOptions(user.branchId),
    db.stationeryItem.findMany({ where: { branchId: user.branchId }, distinct: ["category"], select: { category: true } }),
  ]);
  const categories = [...new Set([...CATEGORIES, ...cats.map((c) => c.category)])];
  const manage = hasPerm(user, "stationery.manage");
  const qs = new URLSearchParams(Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "page")).toString();
  return (
    <>
      <PageHeader title="Items & stock" description={`${total} item${total === 1 ? "" : "s"}`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Items" }]}
        actions={<>
          <LinkButton href={`/api/stationery/labels?${qs}`} target="_blank"><QrCode className="size-4" />QR labels</LinkButton>
          {manage && <LinkButton href="/stationery/import"><Upload className="size-4" />Import</LinkButton>}
          {manage && <ItemFormButton suppliers={suppliers} categories={categories} units={UNITS} />}
        </>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name or code" />
            <FilterSelect name="category" label="All categories" options={categories.map((c) => ({ value: c, label: c }))} />
            <FilterSelect name="stock" label="Any stock" options={[{ value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }]} />
            <FilterSelect name="supplierId" label="Any supplier" options={suppliers.map((x) => ({ value: x.id, label: x.name }))} />
            <FilterSelect name="inactive" label="Active" options={[{ value: "1", label: "Inactive" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Item</TH><TH>Code</TH><TH>Category</TH><TH align="right">Stock</TH><TH align="right">Reorder at</TH><TH align="right">Unit cost</TH><TH align="right">Value</TH><TH>Usual supplier</TH></tr></THead>
          <TBody>
            {items.length === 0 && <EmptyRow colSpan={8} />}
            {items.map((i) => {
              const st = stockState(i);
              return (
                <TR key={i.id} highlight={st === "OUT" ? "red" : st === "LOW" ? "yellow" : undefined}>
                  <TD><Link href={`/stationery/items/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.name}</Link></TD>
                  <TD className="font-mono text-xs">{i.code}</TD>
                  <TD>{i.category}</TD>
                  <TD align="right"><span className="mr-2">{i.currentStock} {i.unit}</span><StatusBadge status={st === "OUT" ? "LOW" : st} label={st === "OUT" ? "Out" : st === "LOW" ? "Low" : "OK"} /></TD>
                  <TD align="right">{i.reorderLevel}</TD>
                  <TD align="right">{money(i.unitCost)}</TD>
                  <TD align="right">{money(i.currentStock * toNum(i.unitCost))}</TD>
                  <TD>{i.preferredSupplier?.name ?? "—"}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/items" />
      </Card>
    </>
  );
}
