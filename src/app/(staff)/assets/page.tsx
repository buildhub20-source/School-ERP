import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, QrCode, ScanLine } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, fmtDate, money, today, toNum } from "@/lib/format";
import { ASSET_CATEGORIES, STATUS_LABEL, assetsDashboard, depreciation } from "@/server/assets/service";
import { PageHeader, Card, StatCard, StatStrip, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, LinkButton } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm } from "@/components/ui/client";
import { saveAssetAction } from "./actions";
import { AssetFields } from "./_components/asset-fields";
import { Boxes, IndianRupee, Wrench, ShieldCheck } from "lucide-react";

export const metadata = { title: "Asset register" };

const STATUS_BADGE: Record<string, string> = { IN_USE: "ACTIVE", IN_STORE: "ENDED", UNDER_REPAIR: "IN_PROGRESS", LOST: "EXPIRED", DISPOSED: "CANCELLED" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("assets.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q"), category = sp(s, "category"), status = sp(s, "status"), warranty = sp(s, "warranty"), location = sp(s, "location");
  const t = today();
  const where: Prisma.AssetWhereInput = {
    branchId: user.branchId,
    ...(status === "ALL" ? {} : status ? { status: status as "IN_USE" } : { status: { not: "DISPOSED" } }),
    ...(category ? { category } : {}),
    ...(location ? { location } : {}),
    ...(warranty === "soon" ? { warrantyUntil: { gte: t, lte: addDays(t, 30) } } : warranty === "expired" ? { warrantyUntil: { lt: t } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { equals: q.trim().toUpperCase() } }, { serialNo: { contains: q, mode: "insensitive" } }, { assignedTo: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, assets, d, locations] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({ where, orderBy: { code: "asc" }, skip, take }),
    assetsDashboard(user.branchId),
    db.asset.findMany({ where: { branchId: user.branchId, location: { not: null } }, distinct: ["location"], select: { location: true }, orderBy: { location: "asc" } }),
  ]);
  const canManage = hasPerm(user, "assets.manage");
  const labelQs = new URLSearchParams(Object.entries({ q, category, status, location }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Asset register" description="Everything the school owns, where it is, what it is worth today."
        actions={<>
          <LinkButton href={`/api/assets/labels?${labelQs}`} target="_blank"><QrCode className="size-4" />Print labels</LinkButton>
          {canManage && <LinkButton href="/assets/verify"><ScanLine className="size-4" />Verify</LinkButton>}
          {canManage && <ModalForm trigger="Add asset" icon={<Plus className="size-4" />} title="Add asset" size="lg" action={saveAssetAction} successMessage="@result"><AssetFields /></ModalForm>}
        </>} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Assets" value={d.count} icon={<Boxes />} />
        <StatCard label="Book value" value={money(d.bookValue)} hint={`Cost ${money(d.cost)}`} icon={<IndianRupee />} />
        <StatCard label="Under repair" value={d.underRepair} href="/assets?status=UNDER_REPAIR" icon={<Wrench />} />
        <StatCard label="Not verified in a year" value={d.notVerified} hint={d.lost ? `${d.lost} marked lost` : undefined} href="/assets/verify" icon={<ShieldCheck />} />
      </div>
      <div className="mt-3 sm:mt-4"><StatStrip items={[{ label: "Warranties ending in 30 days", value: d.warrantyExpiring, href: "/assets?warranty=soon" }]} /></div>
      <Card className="mt-6">
        <div className="border-b border-line p-3">
          <FilterBar>
            <SearchField placeholder="Name, code, serial no or person" />
            <FilterSelect name="category" label="All categories" options={ASSET_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <FilterSelect name="location" label="All locations" options={locations.map((l) => ({ value: l.location!, label: l.location! }))} />
            <FilterSelect name="status" label="Not disposed" options={[...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })), { value: "ALL", label: "All, including disposed" }]} />
            <FilterSelect name="warranty" label="Any warranty" options={[{ value: "soon", label: "Ending in 30 days" }, { value: "expired", label: "Expired" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Code</TH><TH>Asset</TH><TH>Location</TH><TH>Status</TH><TH align="right">Cost</TH><TH align="right">Book value</TH><TH>Warranty</TH></tr></THead>
          <TBody>
            {assets.length === 0 && <EmptyRow colSpan={7} message={q || category || status || location || warranty ? "No assets match these filters." : "No assets yet. Use “Add asset” to start the register."} />}
            {assets.map((a) => (
              <TR key={a.id}>
                <TD className="font-mono text-xs font-medium text-ink">{a.code}</TD>
                <TD><Link href={`/assets/${a.id}`} className="font-medium text-ink hover:text-brand-700">{a.name}</Link><span className="block text-xs text-muted">{a.category}{a.assignedTo ? ` · ${a.assignedTo}` : ""}</span></TD>
                <TD>{a.location ?? "—"}</TD>
                <TD><StatusBadge status={STATUS_BADGE[a.status]} label={STATUS_LABEL[a.status]} /></TD>
                <TD align="right">{money(toNum(a.cost))}</TD>
                <TD align="right">{a.status === "DISPOSED" ? "—" : money(depreciation(a, t).bookValue)}</TD>
                <TD className="whitespace-nowrap">{a.warrantyUntil ? <span className={a.warrantyUntil < t ? "text-muted" : a.warrantyUntil <= addDays(t, 30) ? "text-amber-700" : ""}>{a.warrantyUntil < t ? "Ended " : ""}{fmtDate(a.warrantyUntil)}</span> : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/assets" />
      </Card>
    </>
  );
}
