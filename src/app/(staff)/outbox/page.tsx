import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Badge, Pagination, pageParams, sp } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { integrationStatus } from "@/lib/messaging/providers";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Message outbox" };

export default async function OutboxPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("outbox.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 50);
  // Messages of the active branch. The Super Admin also sees system messages whose branch is unknown.
  const branchScope: Prisma.MessageLogWhereInput = user.roleKey === "SUPER_ADMIN" ? { OR: [{ branchId: user.branchId }, { branchId: null }] } : { branchId: user.branchId };
  const where: Prisma.MessageLogWhereInput = {
    AND: [branchScope],
    ...(sp(s, "channel") ? { channel: sp(s, "channel") as "SMS" } : {}),
    ...(sp(s, "status") ? { status: sp(s, "status") as "SENT" } : {}),
    ...(sp(s, "category") ? { category: sp(s, "category") } : {}),
    ...(sp(s, "q") ? { OR: [{ to: { contains: sp(s, "q") } }, { body: { contains: sp(s, "q"), mode: "insensitive" } }] } : {}),
  };
  const [total, msgs, cats] = await Promise.all([
    db.messageLog.count({ where }),
    db.messageLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.messageLog.findMany({ where: branchScope, distinct: ["category"], select: { category: true } }),
  ]);
  const st = integrationStatus();
  return (
    <>
      <PageHeader title="Message outbox" description="Every SMS, WhatsApp, email and push message the system sent or tried to send." />
      {(!st.sms || !st.email || !st.whatsapp) && (
        <p className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-800">
          Sandbox mode for {[!st.sms && "SMS", !st.whatsapp && "WhatsApp", !st.email && "email"].filter(Boolean).join(", ")}: those messages are recorded here instead of being delivered. Add provider keys in Settings → Integrations to go live.
        </p>
      )}
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Recipient or text" />
            <FilterSelect name="channel" label="All channels" options={["SMS", "WHATSAPP", "EMAIL", "PUSH"].map((c) => ({ value: c, label: c }))} />
            <FilterSelect name="status" label="Any status" options={["SENT", "SANDBOX", "FAILED", "QUEUED"].map((c) => ({ value: c, label: c }))} />
            <FilterSelect name="category" label="All types" options={cats.map((c) => ({ value: c.category, label: c.category }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>When</TH><TH>Channel</TH><TH>To</TH><TH>Message</TH><TH>Status</TH></tr></THead>
          <TBody>
            {msgs.length === 0 && <EmptyRow colSpan={5} />}
            {msgs.map((m) => (
              <TR key={m.id}>
                <TD className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</TD>
                <TD><Badge>{m.channel}</Badge><span className="mt-1 block text-[11px] text-slate-400">{m.category}</span></TD>
                <TD className="text-sm">{m.to}</TD>
                <TD className="max-w-md">{m.subject && <p className="text-sm font-medium">{m.subject}</p>}<p className="line-clamp-3 whitespace-pre-line text-xs text-slate-600">{m.body}</p>{m.error && <p className="text-xs text-rose-600">{m.error}</p>}</TD>
                <TD><StatusBadge status={m.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/outbox" />
      </Card>
    </>
  );
}
