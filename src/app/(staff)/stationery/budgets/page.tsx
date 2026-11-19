import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { classOptions, departmentOptions } from "@/server/lookups";
import { budgetStatus, spendBy } from "@/server/stationery/operations";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, StatCard, Pagination, pageParams, sp } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { money, round2 } from "@/lib/format";
import { BudgetFormButton, DeleteBudgetButton } from "./budget-forms";

export const metadata = { title: "Stationery budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const years = await db.academicYear.findMany({ orderBy: { startDate: "desc" } });
  const year = years.find((y) => y.id === sp(s, "yearId")) ?? years.find((y) => y.isCurrent) ?? years[0];
  if (!year) return <PageHeader title="Budgets" description="Add an academic year in Settings first." />;
  const [all, classes, departments] = await Promise.all([budgetStatus(user.branchId, year.id), classOptions(user.branchId), departmentOptions(user.branchId)]);
  const kind = sp(s, "kind");
  const filtered = all.filter((b) => (!kind || b.kind === kind) && (sp(s, "state") !== "over" || b.over) && (sp(s, "state") !== "near" || (!b.over && b.pct >= 80)));
  const { page, pageSize, skip } = pageParams(s);
  const rows = filtered.slice(skip, skip + pageSize);
  // Spend by classes/departments that have no budget, so unbudgeted spend is visible too.
  const { byClass, byDept } = await spendBy(user.branchId, year.startDate, new Date(year.endDate.getTime() + 86400000 - 1));
  const unbudgeted = [
    ...[...byClass.entries()].filter(([id]) => !all.some((b) => b.classId === id)).map(([id, v]) => ({ name: classes.find((c) => c.id === id)?.name ?? "—", v })),
    ...[...byDept.entries()].filter(([id]) => !all.some((b) => b.departmentId === id)).map(([id, v]) => ({ name: departments.find((d) => d.id === id)?.name ?? "—", v })),
  ].filter((x) => x.v > 0);
  const totLimit = all.reduce((a, b) => a + b.limit, 0);
  const totSpent = all.reduce((a, b) => a + b.spent, 0);
  const manage = hasPerm(user, "stationery.manage");
  const clsOpts = classes.map((c) => ({ id: c.id, name: c.name }));
  const deptOpts = departments.map((d) => ({ id: d.id, name: d.name }));
  return (
    <>
      <PageHeader title="Class & department budgets" description={`Academic year ${year.name}. Spend = issued quantity × unit cost, less returns.`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Budgets" }]}
        actions={manage && <BudgetFormButton yearId={year.id} yearName={year.name} classes={clsOpts} departments={deptOpts} />} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total budget" value={money(totLimit)} />
        <StatCard label="Spent" value={money(totSpent)} hint={totLimit ? `${Math.round((totSpent / totLimit) * 100)}% used` : undefined} tone="blue" />
        <StatCard label="Over budget" value={all.filter((b) => b.over).length} tone={all.some((b) => b.over) ? "red" : "gray"} />
      </div>
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <FilterSelect name="yearId" label={`Year ${year.name}`} options={years.filter((y) => y.id !== year.id).map((y) => ({ value: y.id, label: y.name }))} />
            <FilterSelect name="kind" label="Classes & departments" options={[{ value: "Class", label: "Classes" }, { value: "Department", label: "Departments" }]} />
            <FilterSelect name="state" label="Any status" options={[{ value: "over", label: "Over budget" }, { value: "near", label: "80% or more used" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Class / department</TH><TH align="right">Limit</TH><TH align="right">Spent</TH><TH align="right">Remaining</TH><TH className="min-w-40">Used</TH>{manage && <TH />}</tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={manage ? 6 : 5} message="No budgets set for this year." />}
            {rows.map((b) => (
              <TR key={b.id} highlight={b.over ? "red" : b.pct >= 80 ? "yellow" : undefined}>
                <TD className="font-medium text-slate-900">{b.name} <span className="text-xs font-normal text-slate-500">{b.kind}</span></TD>
                <TD align="right">{money(b.limit)}</TD>
                <TD align="right">{money(b.spent)}</TD>
                <TD align="right" className={b.over ? "font-semibold text-rose-700" : ""}>{b.over ? `−${money(-b.remaining)}` : money(b.remaining)}</TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${b.over ? "bg-rose-500" : b.pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, b.pct)}%` }} /></div>
                    <span className="w-12 text-right text-xs tabular-nums">{b.pct}%</span>
                    {b.over && <Badge tone="red">Over</Badge>}
                  </div>
                </TD>
                {manage && <TD align="right" className="whitespace-nowrap"><BudgetFormButton yearId={year.id} yearName={year.name} classes={clsOpts} departments={deptOpts} budget={{ id: b.id, target: b.classId ? `c:${b.classId}` : `d:${b.departmentId}`, amount: b.limit, name: b.name }} /><DeleteBudgetButton id={b.id} /></TD>}
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} searchParams={s} basePath="/stationery/budgets" />
      </Card>
      {unbudgeted.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Spend without a budget" description="Issues charged to classes or departments that have no budget this year." />
          <Table>
            <THead><tr><TH>Class / department</TH><TH align="right">Spent</TH></tr></THead>
            <TBody>{unbudgeted.map((u) => <TR key={u.name}><TD>{u.name}</TD><TD align="right">{money(round2(u.v))}</TD></TR>)}</TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
