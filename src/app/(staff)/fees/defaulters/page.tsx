import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { classOptions } from "@/server/lookups";
import { defaulters } from "@/server/fees/queries";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, LinkButton } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fullName, money, fmtDate } from "@/lib/format";
import { DefaulterReminder, DefaulterSelect } from "../fee-forms";

export const metadata = { title: "Defaulters" };

export default async function DefaultersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.view");
  const s = await searchParams;
  const pg = pageParams(s);
  const classes = await classOptions(user.branchId);
  const d = await defaulters(user.branchId, { classId: sp(s, "classId"), sectionId: sp(s, "sectionId"), q: sp(s, "q") }, pg);
  const selected = classes.find((c) => c.id === sp(s, "classId"));
  const canRemind = hasPerm(user, "fees.collect");
  return (
    <>
      <PageHeader title="Defaulters" description={`${d.total} students with dues overdue more than ${d.days} days (due before ${fmtDate(d.cutoff)}) · ${money(d.totalAmount)}`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Defaulters" }]}
        actions={<>{canRemind && <DefaulterReminder ids={d.allIds} label={`Remind all ${d.allIds.length}`} />}{hasPerm(user, "reports.fees") && <LinkButton href={`/reports/fees.defaulters${sp(s, "classId") ? `?classId=${sp(s, "classId")}` : ""}`}>Report / export</LinkButton>}</>} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Student name or admission no" />
            <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            {selected && <FilterSelect name="sectionId" label="All sections" options={selected.sections.map((x) => ({ value: x.id, label: x.name }))} />}
          </FilterBar>
          {canRemind && <DefaulterSelect />}
        </div>
        <Table>
          <THead><tr>{canRemind && <TH></TH>}<TH>Student</TH><TH>Class</TH><TH>Parent</TH><TH>Oldest due</TH><TH align="right">Days</TH><TH align="right">Overdue</TH><TH align="right">Total due</TH><TH></TH></tr></THead>
          <TBody>
            {d.rows.length === 0 && <EmptyRow colSpan={9} message="No defaulters." />}
            {d.rows.map((r) => (
              <TR key={r.student.id} highlight={r.daysOverdue > 60 ? "red" : undefined}>
                {canRemind && <TD><input type="checkbox" name="sel" value={r.student.id} aria-label="Select" /></TD>}
                <TD><Link href={`/fees/accounts/${r.student.id}`} className="font-medium hover:text-brand-700">{fullName(r.student)}</Link><span className="block font-mono text-xs text-slate-500">{r.student.admissionNo}</span></TD>
                <TD>{r.student.schoolClass.name}{r.student.section ? ` - ${r.student.section.name}` : ""}</TD>
                <TD>{r.guardian ? <>{r.guardian.name}<a href={`tel:${r.guardian.phone}`} className="block text-xs text-brand-700">{r.guardian.phone}</a></> : "—"}</TD>
                <TD className="whitespace-nowrap">{fmtDate(r.oldestDue)}</TD>
                <TD align="right">{r.daysOverdue}</TD>
                <TD align="right" className="font-semibold text-rose-700">{money(r.overdue)}</TD>
                <TD align="right">{money(r.totalDue)}</TD>
                <TD align="right">{hasPerm(user, "fees.collect") && <LinkButton href={`/fees/collect?studentId=${r.student.id}`} size="sm">Collect</LinkButton>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={pg.page} pageSize={pg.pageSize} total={d.total} searchParams={s} basePath="/fees/defaulters" />
      </Card>
    </>
  );
}
