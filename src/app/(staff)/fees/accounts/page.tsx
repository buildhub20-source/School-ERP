import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { classOptions } from "@/server/lookups";
import { requireFeeScope } from "@/server/fees/access";
import { accountList } from "@/server/fees/queries";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fullName, money } from "@/lib/format";

export const metadata = { title: "Student fee accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["fees.view", "transport.fees.view"]);
  const scope = requireFeeScope(user);
  const s = await searchParams;
  const pg = pageParams(s);
  const classes = await classOptions(user.branchId);
  const { total, rows } = await accountList(user.branchId, scope, { q: sp(s, "q"), classId: sp(s, "classId"), sectionId: sp(s, "sectionId"), dues: sp(s, "dues"), status: sp(s, "status") }, pg);
  const selected = classes.find((c) => c.id === sp(s, "classId"));
  return (
    <>
      <PageHeader title={scope === "transport" ? "Transport fee accounts" : "Student fee accounts"} description={scope === "transport" ? "Only transport fees are shown for your role." : `${total} students`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Accounts" }]} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name, admission no or parent mobile" />
            <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            {selected && <FilterSelect name="sectionId" label="All sections" options={selected.sections.map((x) => ({ value: x.id, label: x.name }))} />}
            <FilterSelect name="dues" label="Any balance" options={[{ value: "due", label: "Has dues" }, { value: "overdue", label: "Overdue" }, { value: "credit", label: "In credit" }]} />
            <FilterSelect name="status" label="Active" options={[{ value: "LEFT", label: "Left" }, { value: "GRADUATED", label: "Graduated" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Class</TH><TH align="right">Payable</TH><TH align="right">Paid</TH><TH align="right">Balance</TH><TH align="right">Overdue</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6} />}
            {rows.map((r) => (
              <TR key={r.student.id} highlight={r.overdue > 0 ? "red" : undefined}>
                <TD><Link href={`/fees/accounts/${r.student.id}`} className="font-medium text-slate-900 hover:text-brand-700">{fullName(r.student)}</Link><span className="block font-mono text-xs text-slate-500">{r.student.admissionNo}</span></TD>
                <TD>{r.student.schoolClass.name}{r.student.section ? ` - ${r.student.section.name}` : ""}</TD>
                <TD align="right">{money(r.net)}</TD><TD align="right">{money(r.paid)}</TD>
                <TD align="right">{r.balance < 0 ? <Badge tone="purple">Credit {money(-r.balance)}</Badge> : money(r.balance)}</TD>
                <TD align="right" className={r.overdue > 0 ? "font-medium text-rose-700" : ""}>{r.overdue > 0 ? money(r.overdue) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={pg.page} pageSize={pg.pageSize} total={total} searchParams={s} basePath="/fees/accounts" />
      </Card>
    </>
  );
}
