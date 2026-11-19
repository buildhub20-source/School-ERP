import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge, StatusBadge } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { CATEGORY_LABELS, GENDER_LABELS, MOVEMENT_LABELS } from "@/server/uniforms/labels";
import { fmtDateTime, money, toNum } from "@/lib/format";
import { openDemand } from "@/server/uniforms/queries";
import { ItemModal, VariantModal, AdjustStockModal } from "../../_components/forms";

export const metadata = { title: "Uniform item" };

export default async function ItemDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const { id } = await params;
  const s = await searchParams;
  const item = await db.uniformItem.findFirst({ where: { id, branchId: user.branchId }, include: { variants: { orderBy: { sizeOrder: "asc" }, include: { prices: { orderBy: { effectiveDate: "desc" }, take: 1, include: { supplier: true } } } } } });
  if (!item) notFound();
  const { page, pageSize, skip, take } = pageParams(s);
  const mWhere = { variant: { itemId: item.id }, ...(sp(s, "variantId") ? { variantId: sp(s, "variantId") } : {}) };
  const [mTotal, movements, demand] = await Promise.all([
    db.uniformMovement.count({ where: mWhere }),
    db.uniformMovement.findMany({ where: mWhere, include: { variant: true }, orderBy: { createdAt: "desc" }, skip, take }),
    openDemand(user.branchId),
  ]);
  const users = await db.user.findMany({ where: { id: { in: movements.map((m) => m.createdById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const orderIds = movements.map((m) => m.orderId).filter(Boolean) as string[];
  const canManage = hasPerm(user, "uniforms.manage");
  return (
    <>
      <PageHeader title={item.name} breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Items", href: "/uniforms/items" }, { label: item.name }]}
        description={<>{CATEGORY_LABELS[item.category]} · {GENDER_LABELS[item.gender]} {!item.isActive && <Badge tone="gray">Inactive</Badge>}</>}
        actions={canManage && <ItemModal item={{ id: item.id, name: item.name, category: item.category, gender: item.gender, description: item.description, isActive: item.isActive }} />} />
      {item.description && <Card className="mb-5"><CardBody><DescList items={[{ label: "Description", value: item.description }]} /></CardBody></Card>}
      <Card className="mb-5">
        <CardHeader title="Sizes" description="Price, stock and reorder level per size" actions={canManage && <VariantModal itemId={item.id} />} />
        <Table>
          <THead><tr><TH>Size</TH><TH>SKU</TH><TH align="right">Price</TH><TH align="right">Stock</TH><TH align="right">Reorder at</TH><TH align="right">Open demand</TH><TH>Last cost</TH><TH>Status</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {!item.variants.length && <EmptyRow colSpan={9} message="No sizes yet." />}
            {item.variants.map((v) => {
              const d = demand.get(v.id) ?? 0;
              const hl = v.stock <= 0 ? "red" : v.stock < d || (v.reorderLevel > 0 && v.stock <= v.reorderLevel) ? "yellow" : undefined;
              return (
                <TR key={v.id} highlight={v.isActive ? hl : undefined}>
                  <TD className="font-medium">{v.size}</TD>
                  <TD className="font-mono text-xs">{v.sku ?? "—"}</TD>
                  <TD align="right">{money(v.price)}</TD>
                  <TD align="right" className="font-semibold">{v.stock}</TD>
                  <TD align="right">{v.reorderLevel}</TD>
                  <TD align="right">{d}</TD>
                  <TD>{v.prices[0] ? <>{money(v.prices[0].price)}<span className="block text-xs text-slate-500">{v.prices[0].supplier.name}</span></> : "—"}</TD>
                  <TD>{v.isActive ? <StatusBadge status="ACTIVE" /> : <Badge>Inactive</Badge>}</TD>
                  {canManage && <TD align="right"><div className="flex justify-end gap-1"><AdjustStockModal variantId={v.id} label={`${item.name} ${v.size}`} stock={v.stock} /><VariantModal itemId={item.id} variant={{ id: v.id, size: v.size, sizeOrder: v.sizeOrder, price: toNum(v.price), reorderLevel: v.reorderLevel, sku: v.sku, isActive: v.isActive }} /></div></TD>}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Stock movements" description="Every change to stock, with who did it and when" />
        <div className="border-b border-slate-100 p-3">
          <FilterBar><FilterSelect name="variantId" label="All sizes" options={item.variants.map((v) => ({ value: v.id, label: v.size }))} /></FilterBar>
        </div>
        <Table>
          <THead><tr><TH>When</TH><TH>Size</TH><TH>Type</TH><TH align="right">Qty</TH><TH align="right">Balance</TH><TH>Reference</TH><TH>By</TH></tr></THead>
          <TBody>
            {!movements.length && <EmptyRow colSpan={7} message="No movements yet." />}
            {movements.map((m) => (
              <TR key={m.id}>
                <TD className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</TD>
                <TD>{m.variant.size}</TD>
                <TD>{MOVEMENT_LABELS[m.type] ?? m.type}</TD>
                <TD align="right" className={m.qty < 0 ? "text-rose-700" : "text-emerald-700"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TD>
                <TD align="right">{m.balanceAfter}</TD>
                <TD className="text-xs">
                  {m.orderId && orderIds.includes(m.orderId) ? <Link href={`/uniforms/orders/${m.orderId}`} className="text-brand-700 hover:underline">{m.note ?? "Order"}</Link>
                    : m.poId ? <Link href={`/uniforms/purchases/${m.poId}`} className="text-brand-700 hover:underline">{m.note ?? "Purchase"}</Link> : m.note ?? "—"}
                </TD>
                <TD className="text-xs">{users.find((u) => u.id === m.createdById)?.name ?? "System"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={mTotal} searchParams={s} basePath={`/uniforms/items/${item.id}`} />
      </Card>
    </>
  );
}
