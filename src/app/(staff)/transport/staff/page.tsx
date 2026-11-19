import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Pencil, Smartphone } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation } from "@/lib/automations/config";
import { fmtDate, fmtDateTime, today } from "@/lib/format";
import { docStatus } from "@/server/transport/helpers";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge, Checkbox } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm, ActionButton } from "@/components/ui/client";
import { saveStaffAction, staffLoginAction } from "../actions";
import { StaffFields } from "../_components/fields";

export const metadata = { title: "Drivers & attendants" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const type = sp(s, "type");
  const status = sp(s, "status") ?? "ACTIVE";
  const where: Prisma.TransportStaffWhereInput = {
    branchId: user.branchId,
    ...(type === "DRIVER" || type === "ATTENDANT" ? { type } : {}),
    ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { licenseNo: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, staff, cfg] = await Promise.all([
    db.transportStaff.count({ where }),
    db.transportStaff.findMany({ where, include: { drivesBus: true, attendsBus: true, user: true, documents: { where: { isCurrent: true, type: "DRIVER_LICENCE" } } }, orderBy: [{ type: "asc" }, { name: "asc" }], skip, take }),
    automation("transport.docExpiry"),
  ]);
  const canManage = hasPerm(user, "transport.manage");
  const t = today();
  return (
    <>
      <PageHeader title="Drivers & attendants" description={`${total} staff`} breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Staff" }]}
        actions={canManage && <ModalForm trigger="Add staff" icon={<Plus className="size-4" />} title="Add driver / attendant" action={saveStaffAction} successMessage="Staff added"><StaffFields /></ModalForm>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name, mobile or licence no" />
            <FilterSelect name="type" label="Drivers & attendants" options={[{ value: "DRIVER", label: "Drivers" }, { value: "ATTENDANT", label: "Attendants" }]} />
            <FilterSelect name="status" label="Active" options={[{ value: "INACTIVE", label: "Inactive" }, { value: "ALL", label: "All" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Name</TH><TH>Role</TH><TH>Mobile</TH><TH>Licence</TH><TH>Bus</TH><TH>App login</TH><TH>Status</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {staff.length === 0 && <EmptyRow colSpan={8} />}
            {staff.map((p) => {
              const bus = p.drivesBus ?? p.attendsBus;
              const lic = p.documents[0];
              const st = lic ? docStatus(lic.expiryDate, t, Number(cfg.config.daysBefore ?? 30)) : null;
              const loginOn = !!p.user?.isActive;
              return (
                <TR key={p.id}>
                  <TD className="font-medium text-slate-900">{p.name}{p.address && <span className="block text-xs font-normal text-slate-500">{p.address}</span>}</TD>
                  <TD><Badge tone={p.type === "DRIVER" ? "indigo" : "blue"}>{p.type === "DRIVER" ? "Driver" : "Attendant"}</Badge></TD>
                  <TD><a href={`tel:${p.phone}`} className="text-brand-700">{p.phone}</a></TD>
                  <TD>{p.licenseNo ?? "—"}{lic && <span className="block text-xs text-slate-500">expires {fmtDate(lic.expiryDate)} {st && st !== "VALID" && <StatusBadge status={st} />}</span>}</TD>
                  <TD>{bus ? <Link href={`/transport/buses/${bus.id}`} className="hover:text-brand-700">{bus.busNo}</Link> : <span className="text-slate-400">—</span>}</TD>
                  <TD>{loginOn ? <><Badge tone="green">Enabled</Badge><span className="block text-xs text-slate-500">{p.user?.lastLoginAt ? `last ${fmtDateTime(p.user.lastLoginAt)}` : "never signed in"}</span></> : <Badge>Off</Badge>}</TD>
                  <TD><StatusBadge status={p.isActive ? "ACTIVE" : "ENDED"} label={p.isActive ? "Active" : "Inactive"} /></TD>
                  {canManage && (
                    <TD>
                      <div className="flex flex-wrap gap-1.5">
                        <ModalForm trigger="" triggerVariant="ghost" triggerSize="sm" icon={<Pencil className="size-4" />} title={`Edit ${p.name}`} action={saveStaffAction} successMessage="Staff updated">
                          <StaffFields staff={p} />
                          <input type="hidden" name="isActive" value="false" />
                          <Checkbox name="isActive" value="true" label="Active" defaultChecked={p.isActive} />
                        </ModalForm>
                        {p.isActive && (loginOn
                          ? <ActionButton action={staffLoginAction} args={{ id: p.id, enable: false }} confirm={`Disable app login for ${p.name}?`} successMessage="App login disabled">Disable login</ActionButton>
                          : <ActionButton action={staffLoginAction} args={{ id: p.id, enable: true }} successMessage={`App login enabled — ${p.name} can sign in with OTP on ${p.phone}`}><Smartphone className="size-3.5" />Enable app login</ActionButton>)}
                      </div>
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/staff" />
      </Card>
      <p className="mt-3 text-xs text-slate-500">Licence expiry dates are tracked under <Link href="/transport/documents?type=DRIVER_LICENCE" className="text-brand-700 hover:underline">Documents → Driver licence</Link>.</p>
    </>
  );
}
