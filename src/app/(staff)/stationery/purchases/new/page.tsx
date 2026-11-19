import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { itemOptions, supplierOptions, supplierPriceMap } from "@/server/stationery/lookups";
import { lowStockIds } from "@/server/stationery/core";
import { PageHeader, Card, CardBody, Tabs } from "@/components/ui";
import { PoForm } from "../po-form";

export const metadata = { title: "New purchase" };

export default async function NewPurchase({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.manage");
  const s = await searchParams;
  const quick = s.quick === "1";
  const [items, suppliers, prices] = await Promise.all([itemOptions(user.branchId), supplierOptions(user.branchId), supplierPriceMap(user.branchId)]);
  // ?low=1 prefills every low-stock item (optionally for one supplier)
  let initialLines: { itemId: string; qty: number; unitPrice: number }[] | undefined;
  if (s.low === "1") {
    const low = await db.stationeryItem.findMany({ where: { id: { in: await lowStockIds(user.branchId) }, ...(s.supplierId ? { preferredSupplierId: s.supplierId } : {}) } });
    initialLines = low.map((i) => ({ itemId: i.id, qty: i.reorderQty > 0 ? i.reorderQty : Math.max(i.reorderLevel * 2 - i.currentStock, 1), unitPrice: (s.supplierId && prices[s.supplierId]?.[i.id]) || toNum(i.unitCost) }));
  }
  return (
    <>
      <PageHeader title={quick ? "Record a purchase" : "New purchase order"} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Purchase orders", href: "/stationery/purchases" }, { label: quick ? "Record purchase" : "New" }]}
        description={quick ? "Goods already received: creates the order, receives it and adds stock in one step." : "Saved as a draft. Mark it ordered when sent to the supplier, then receive the goods."} />
      <Tabs active={quick ? "/stationery/purchases/new?quick=1" : "/stationery/purchases/new"} tabs={[{ href: "/stationery/purchases/new", label: "Purchase order" }, { href: "/stationery/purchases/new?quick=1", label: "Record received purchase" }]} />
      {suppliers.length === 0
        ? <Card><CardBody><p className="text-sm text-slate-600">Add a supplier first on the <a className="text-brand-700 hover:underline" href="/stationery/suppliers">Suppliers</a> page.</p></CardBody></Card>
        : <Card><CardBody><PoForm items={items} suppliers={suppliers} prices={prices} quick={quick} defaultSupplierId={s.supplierId} initialLines={initialLines} /></CardBody></Card>}
    </>
  );
}
