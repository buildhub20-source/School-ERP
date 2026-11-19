import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Pagination, pageParams } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/format";
import { CircularForm, EventForm } from "./circular-forms";
import { deleteCircular, deleteEvent, sendCircularNow } from "./actions";

export const metadata = { title: "Circulars & events" };

const AUD: Record<string, string> = { ALL_PARENTS: "All parents", ALL_STAFF: "All staff", EVERYONE: "Everyone", CLASSES: "Selected classes" };

export default async function CircularsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("circulars.manage");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 20);
  const [classes, total, circulars, events] = await Promise.all([
    db.schoolClass.findMany({ where: { branchId: user.branchId }, orderBy: { grade: "asc" }, select: { id: true, name: true } }),
    db.circular.count({ where: { branchId: user.branchId } }),
    db.circular.findMany({ where: { branchId: user.branchId }, orderBy: { createdAt: "desc" }, skip, take }),
    db.schoolEvent.findMany({ where: { branchId: user.branchId, date: { gte: today() } }, orderBy: { date: "asc" } }),
  ]);
  const classMap = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Circulars & events" description="Send circulars to parents and staff. Holidays and events are announced automatically before the date; birthdays get greetings every morning." actions={<CircularForm classes={classes} />} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Circulars" />
          <Table>
            <THead><tr><TH>Circular</TH><TH>Audience</TH><TH>Sent</TH><TH /></tr></THead>
            <TBody>
              {circulars.length === 0 && <EmptyRow colSpan={4} message="No circulars yet." />}
              {circulars.map((c) => (
                <TR key={c.id}>
                  <TD className="max-w-md"><p className="font-medium text-slate-900">{c.title} <Badge tone={c.type === "HOLIDAY" ? "yellow" : c.type === "EVENT" ? "blue" : c.type === "GREETING" ? "purple" : "gray"}>{c.type.toLowerCase()}</Badge></p><p className="line-clamp-2 whitespace-pre-line text-xs text-slate-500">{c.body}</p></TD>
                  <TD className="text-xs">{AUD[c.audience]}{c.audience === "CLASSES" && <span className="block text-slate-500">{c.classIds.map((id) => classMap[id]).filter(Boolean).join(", ")}</span>}</TD>
                  <TD className="text-xs">{c.sentAt ? fmtDateTime(c.sentAt) : <Badge tone="yellow">Draft</Badge>}</TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <ActionButton action={sendCircularNow} args={{ id: c.id }} variant={c.sentAt ? "ghost" : "primary"} confirm={c.sentAt ? "Send this circular again?" : "Send this circular now?"} successMessage="Circular sent">{c.sentAt ? "Resend" : "Send"}</ActionButton>
                      {!c.sentAt && <ActionButton action={deleteCircular} args={{ id: c.id }} variant="ghost" confirm="Delete this draft?" successMessage="Deleted">Delete</ActionButton>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/circulars" />
        </Card>
        <Card>
          <CardHeader title="Upcoming holidays & events" actions={<EventForm />} />
          <div className="divide-y divide-slate-100">
            {events.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No upcoming events.</p>}
            {events.map((e) => (
              <div key={e.id} className="px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{e.title} <Badge tone={e.type === "HOLIDAY" ? "yellow" : "blue"}>{e.type.toLowerCase()}</Badge></p>
                    <p className="text-xs text-slate-500">{fmtDate(e.date)}{e.endDate ? ` – ${fmtDate(e.endDate)}` : ""} · {AUD[e.audience]} · {e.notifiedAt ? "announced" : `announce ${e.notifyDaysBefore} day(s) before`}</p>
                  </div>
                  <div className="flex gap-1">
                    <EventForm initial={{ id: e.id, title: e.title, description: e.description ?? "", date: isoDate(e.date), endDate: e.endDate ? isoDate(e.endDate) : "", type: e.type, audience: e.audience, notifyDaysBefore: e.notifyDaysBefore }} />
                    <ActionButton action={deleteEvent} args={{ id: e.id }} variant="ghost" confirm="Delete this event?" successMessage="Deleted">Delete</ActionButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
