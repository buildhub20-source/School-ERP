import { notFound } from "next/navigation";
import { Pencil, QrCode } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, money, today, toNum } from "@/lib/format";
import { STATUS_LABEL, depreciation } from "@/server/assets/service";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, LinkButton, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { assetStatusAction, disposeAssetAction, moveAssetAction, repairAssetAction, saveAssetAction, verifyAssetAction } from "../actions";
import { AssetFields } from "../_components/asset-fields";

export const metadata = { title: "Asset" };

const STATUS_BADGE: Record<string, string> = { IN_USE: "ACTIVE", IN_STORE: "ENDED", UNDER_REPAIR: "IN_PROGRESS", LOST: "EXPIRED", DISPOSED: "CANCELLED" };
const EVENT_LABEL: Record<string, string> = { CREATED: "Added", MOVED: "Moved", REPAIR: "Repair", VERIFIED: "Verified", STATUS: "Status", DISPOSED: "Disposed" };
const CONDITION: Record<string, string> = { NEW: "New", GOOD: "Good", FAIR: "Fair", POOR: "Poor" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("assets.view");
  const { id } = await params;
  const a = await db.asset.findFirst({ where: { id, branchId: user.branchId }, include: { events: { orderBy: { date: "desc" } } } });
  if (!a) notFound();
  const dep = depreciation(a, today());
  const canManage = hasPerm(user, "assets.manage") && a.status !== "DISPOSED";
  const repairs = a.events.filter((e) => e.type === "REPAIR").reduce((s, e) => s + toNum(e.cost), 0);
  return (
    <>
      <PageHeader title={a.name} description={`${a.code} · ${a.category}`} breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: a.code }]}
        actions={<>
          <LinkButton href={`/api/assets/labels?ids=${a.id}`} target="_blank"><QrCode className="size-4" />Label</LinkButton>
          {canManage && <ModalForm trigger="Edit" triggerVariant="secondary" icon={<Pencil className="size-4" />} title={`Edit ${a.code}`} size="lg" action={saveAssetAction} extra={{ id: a.id }} successMessage="@result"><AssetFields asset={a} /></ModalForm>}
          {canManage && (
            <ModalForm trigger="Verify" triggerVariant="primary" title={`Verify ${a.code}`} description="Confirm you have seen this asset. Correct its condition or location if needed." action={verifyAssetAction} extra={{ id: a.id }} successMessage="@result">
              <FormGrid cols={2}>
                <Field label="Condition"><Select name="condition" defaultValue={a.condition}>{Object.entries(CONDITION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                <Field label="Found at"><Input name="location" defaultValue={a.location ?? ""} /></Field>
                <Field label="Notes" className="sm:col-span-2"><Input name="notes" /></Field>
              </FormGrid>
            </ModalForm>
          )}
        </>} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" actions={<StatusBadge status={STATUS_BADGE[a.status]} label={STATUS_LABEL[a.status]} />} />
          <CardBody>
            <DescList cols={3} items={[
              { label: "Location", value: a.location }, { label: "Assigned to", value: a.assignedTo }, { label: "Condition", value: CONDITION[a.condition] },
              { label: "Brand / model", value: [a.brand, a.model].filter(Boolean).join(" ") || null }, { label: "Serial no", value: a.serialNo }, { label: "Supplier", value: [a.supplierName, a.invoiceNo && `Invoice ${a.invoiceNo}`].filter(Boolean).join(" · ") || null },
              { label: "Purchased", value: a.purchaseDate ? fmtDate(a.purchaseDate) : null }, { label: "Warranty until", value: a.warrantyUntil ? fmtDate(a.warrantyUntil) : null }, { label: "Last verified", value: a.lastVerifiedAt ? fmtDateTime(a.lastVerifiedAt) : "Never" },
              ...(a.status === "DISPOSED" ? [{ label: "Disposed", value: `${fmtDate(a.disposedOn)} · ${money(toNum(a.disposalValue))} · ${a.disposalReason}` }] : []),
              ...(a.notes ? [{ label: "Notes", value: a.notes }] : []),
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Value" description="Straight-line depreciation" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Cost", value: money(toNum(a.cost)) },
              { label: "Depreciation per year", value: `${money(dep.annual)} over ${a.usefulLifeYears} year${a.usefulLifeYears === 1 ? "" : "s"}` },
              { label: "Depreciated so far", value: money(dep.accumulated) },
              { label: "Book value today", value: <span className="text-lg font-semibold">{money(a.status === "DISPOSED" ? 0 : dep.bookValue)}</span> },
              { label: "Spent on repairs", value: money(repairs) },
            ]} />
          </CardBody>
        </Card>
      </div>

      {canManage && (
        <Card className="mt-5">
          <CardHeader title="Actions" />
          <CardBody className="flex flex-wrap gap-2">
            <ModalForm trigger="Move / reassign" triggerVariant="secondary" title="Move or reassign" action={moveAssetAction} extra={{ id: a.id }} successMessage="Moved">
              <FormGrid cols={2}>
                <Field label="New location"><Input name="location" defaultValue={a.location ?? ""} /></Field>
                <Field label="Assigned to"><Input name="assignedTo" defaultValue={a.assignedTo ?? ""} /></Field>
                <Field label="Notes" className="sm:col-span-2"><Input name="notes" /></Field>
              </FormGrid>
            </ModalForm>
            <ModalForm trigger={a.status === "UNDER_REPAIR" ? "Back from repair" : "Send for repair"} triggerVariant="secondary" title={a.status === "UNDER_REPAIR" ? "Back from repair" : "Send for repair"} action={repairAssetAction} extra={{ id: a.id, status: a.status === "UNDER_REPAIR" ? "IN_USE" : "UNDER_REPAIR" }} successMessage="Recorded">
              <FormGrid cols={2}>
                <Field label="What was done / the problem" required className="sm:col-span-2"><Textarea name="notes" rows={2} required /></Field>
                <Field label="Cost (₹)"><Input name="cost" type="number" min={0} step="0.01" /></Field>
                <Field label="Condition now"><Select name="condition" placeholder="Unchanged">{Object.entries(CONDITION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              </FormGrid>
            </ModalForm>
            {a.status !== "IN_STORE" && <ActionButton size="md" action={assetStatusAction} args={{ id: a.id, status: "IN_STORE" }} reason="optional" successMessage="Moved to store">Move to store</ActionButton>}
            {a.status !== "IN_USE" && a.status !== "UNDER_REPAIR" && <ActionButton size="md" action={assetStatusAction} args={{ id: a.id, status: "IN_USE" }} successMessage="In use">Mark in use</ActionButton>}
            {a.status !== "LOST" && <ActionButton size="md" action={assetStatusAction} args={{ id: a.id, status: "LOST" }} reason confirm={`Mark ${a.code} as lost?`} successMessage="Marked lost">Mark lost</ActionButton>}
            <ModalForm trigger="Dispose" triggerVariant="danger" title={`Dispose of ${a.code}`} description="Sold, scrapped or written off. The asset stays in the register as disposed." action={disposeAssetAction} extra={{ id: a.id }} successMessage="Disposed" submitLabel="Dispose">
              <FormGrid cols={2}>
                <Field label="Date" required><Input name="date" type="date" defaultValue={isoDate(new Date())} required /></Field>
                <Field label="Sale / scrap value (₹)" required><Input name="value" type="number" min={0} step="0.01" defaultValue={0} required /></Field>
                <Field label="Reason" required className="sm:col-span-2"><Input name="reason" required placeholder="e.g. Sold to scrap dealer, beyond repair" /></Field>
              </FormGrid>
            </ModalForm>
          </CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="History" />
        <Table>
          <THead><tr><TH>When</TH><TH>Event</TH><TH>Details</TH><TH align="right">Cost</TH><TH>By</TH></tr></THead>
          <TBody>
            {a.events.length === 0 && <EmptyRow colSpan={5} />}
            {a.events.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap">{fmtDateTime(e.date)}</TD>
                <TD>{EVENT_LABEL[e.type]}</TD>
                <TD>{[e.fromLocation && e.toLocation && e.fromLocation !== e.toLocation ? `${e.fromLocation} → ${e.toLocation}` : e.toLocation && e.type !== "VERIFIED" ? `At ${e.toLocation}` : null, e.notes].filter(Boolean).join(" · ") || "—"}</TD>
                <TD align="right">{e.cost ? money(toNum(e.cost)) : "—"}</TD>
                <TD>{e.byName ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
