import Link from "next/link";
import type { DocType, Prisma } from "@prisma/client";
import { Plus, RefreshCw, Paperclip } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation } from "@/lib/automations/config";
import { addDays, fmtDate, fmtDateTime, isoDate, today } from "@/lib/format";
import { DOC_LABELS, DOC_TYPES, daysUntil, docStatus } from "@/server/transport/helpers";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Field, FormGrid, Input, Select } from "@/components/ui";
import { FilterBar, FilterSelect, ModalForm } from "@/components/ui/client";
import { addDocumentAction, renewDocumentAction } from "../actions";

export const metadata = { title: "Transport documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const branchId = user.branchId;
  const daysBefore = Number((await automation("transport.docExpiry")).config.daysBefore ?? 30) || 30;
  const t = today();
  const status = sp(s, "status");
  const type = sp(s, "type");
  const busId = sp(s, "busId");
  const history = sp(s, "history") === "1";
  const expiry: Prisma.DateTimeFilter | undefined =
    status === "EXPIRED" ? { lt: t } : status === "EXPIRING" ? { gte: t, lte: addDays(t, daysBefore) } : status === "VALID" ? { gt: addDays(t, daysBefore) } : status === "ATTENTION" ? { lte: addDays(t, daysBefore) } : undefined;
  const where: Prisma.TransportDocumentWhereInput = {
    AND: [
      { OR: [{ bus: { branchId } }, { staff: { branchId } }] },
      ...(busId ? [{ OR: [{ busId }, { staff: { OR: [{ drivesBus: { id: busId } }, { attendsBus: { id: busId } }] } }] }] : []),
    ],
    ...(history ? {} : { isCurrent: true }),
    ...(type && (DOC_TYPES as readonly string[]).includes(type) ? { type: type as DocType } : {}),
    ...(expiry ? { expiryDate: expiry } : {}),
  };
  const [total, docs, buses, staff] = await Promise.all([
    db.transportDocument.count({ where }),
    db.transportDocument.findMany({ where, include: { bus: true, staff: { include: { drivesBus: true } } }, orderBy: [{ isCurrent: "desc" }, { expiryDate: "asc" }], skip, take }),
    db.bus.findMany({ where: { branchId }, orderBy: { busNo: "asc" } }),
    db.transportStaff.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const canManage = hasPerm(user, "transport.manage");
  return (
    <>
      <PageHeader title="Documents" description={`Insurance, fitness, permit, pollution and driver licences · alerts start ${daysBefore} days before expiry`}
        breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Documents" }]}
        actions={canManage && (
          <ModalForm trigger="Add document" icon={<Plus className="size-4" />} title="Add document" action={addDocumentAction} successMessage="Document added">
            <FormGrid>
              <Field label="Type" required><Select name="type" defaultValue="INSURANCE">{DOC_TYPES.map((d) => <option key={d} value={d}>{DOC_LABELS[d]}</option>)}</Select></Field>
              <Field label="Number"><Input name="number" /></Field>
              <Field label="Bus" hint="For bus documents"><Select name="busId" placeholder="— Choose bus —">{buses.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.busNo} · {b.registrationNo}</option>)}</Select></Field>
              <Field label="Driver / attendant" hint="For a driver licence"><Select name="staffId" placeholder="— Choose person —">{staff.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type === "DRIVER" ? "Driver" : "Attendant"})</option>)}</Select></Field>
              <Field label="Issue date"><Input type="date" name="issueDate" /></Field>
              <Field label="Expiry date" required><Input type="date" name="expiryDate" required /></Field>
            </FormGrid>
            <Field label="Scan / photo" hint="PDF, JPG, PNG or WEBP, up to 5 MB"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="h-auto py-1.5" /></Field>
          </ModalForm>
        )} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <FilterSelect name="status" label="Any status" options={[{ value: "ATTENTION", label: "Expiring or expired" }, { value: "EXPIRING", label: "Expiring soon" }, { value: "EXPIRED", label: "Expired" }, { value: "VALID", label: "Valid" }]} />
            <FilterSelect name="type" label="All types" options={DOC_TYPES.map((d) => ({ value: d, label: DOC_LABELS[d] }))} />
            <FilterSelect name="busId" label="All buses" options={buses.map((b) => ({ value: b.id, label: b.busNo }))} />
            <label className="flex h-9 items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="history" className="size-4 rounded border-slate-300" />Include renewed</label>
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Bus / person</TH><TH>Document</TH><TH>Number</TH><TH>Issued</TH><TH>Expires</TH><TH>Status</TH><TH>Last alert</TH><TH /></tr></THead>
          <TBody>
            {docs.length === 0 && <EmptyRow colSpan={8} />}
            {docs.map((d) => {
              const st = docStatus(d.expiryDate, t, daysBefore);
              const left = daysUntil(d.expiryDate, t);
              return (
                <TR key={d.id} highlight={!d.isCurrent ? undefined : st === "EXPIRED" ? "red" : st === "EXPIRING" ? "yellow" : undefined} className={d.isCurrent ? "" : "opacity-60"}>
                  <TD>{d.bus ? <Link href={`/transport/buses/${d.bus.id}`} className="font-medium hover:text-brand-700">{d.bus.busNo}</Link> : <span className="font-medium">{d.staff?.name}</span>}
                    <span className="block text-xs text-slate-500">{d.bus?.registrationNo ?? (d.staff?.drivesBus ? `Driver, ${d.staff.drivesBus.busNo}` : d.staff?.type === "DRIVER" ? "Driver" : "")}</span></TD>
                  <TD>{DOC_LABELS[d.type]}</TD>
                  <TD className="font-mono text-xs">{d.number ?? "—"}</TD>
                  <TD>{fmtDate(d.issueDate)}</TD>
                  <TD>{fmtDate(d.expiryDate)}{d.isCurrent && <span className="block text-xs text-slate-500">{left < 0 ? `${-left} days ago` : `in ${left} days`}</span>}</TD>
                  <TD>{d.isCurrent ? <StatusBadge status={st} /> : <StatusBadge status="ENDED" label="Renewed" />}</TD>
                  <TD className="text-xs text-slate-500">{d.lastAlertAt ? fmtDateTime(d.lastAlertAt) : "—"}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-slate-500 hover:bg-slate-100" title="View file"><Paperclip className="size-4" /></a>}
                      {canManage && d.isCurrent && (
                        <ModalForm trigger="Renew" triggerVariant={st === "VALID" ? "secondary" : "primary"} triggerSize="sm" icon={<RefreshCw className="size-3.5" />} title={`Renew ${DOC_LABELS[d.type]} — ${d.bus?.busNo ?? d.staff?.name}`} description="The renewed document becomes current; this one is kept as history." action={renewDocumentAction} extra={{ id: d.id }} successMessage="Document renewed">
                          <FormGrid>
                            <Field label="New number"><Input name="number" defaultValue={d.number ?? ""} /></Field>
                            <Field label="Issue date"><Input type="date" name="issueDate" defaultValue={isoDate()} /></Field>
                            <Field label="New expiry date" required><Input type="date" name="expiryDate" required min={isoDate(addDays(d.expiryDate, 1))} /></Field>
                          </FormGrid>
                          <Field label="Scan / photo"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="h-auto py-1.5" /></Field>
                        </ModalForm>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/documents" />
      </Card>
    </>
  );
}
