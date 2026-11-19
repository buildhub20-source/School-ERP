import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getReport, canSeeReport } from "@/lib/reports/registry";
import { parseFilters } from "@/lib/reports/parse";
import { formatCell } from "@/lib/reports/format-cell";
import { filterOptions } from "@/server/reports-options";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton } from "@/components/ui";
import { FilterBar, FilterSelect, FilterDate } from "@/components/ui/client";
import { ReportChart } from "@/components/charts/report-chart";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import type { FilterKey } from "@/lib/reports/types";

const LABELS: Record<Exclude<FilterKey, "dateRange">, string> = {
  class: "All classes", section: "All sections", item: "All items", uniformItem: "All uniform items", route: "All routes", bus: "All buses", term: "All terms",
  mode: "All payment modes", supplier: "All suppliers", teacher: "All staff", year: "Current year", status: "Any status",
};
const PARAM: Record<Exclude<FilterKey, "dateRange">, string> = {
  class: "classId", section: "sectionId", item: "itemId", uniformItem: "uniformItemId", route: "routeId", bus: "busId", term: "termId", mode: "mode", supplier: "supplierId", teacher: "teacherId", year: "yearId", status: "status",
};

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string>> }) {
  const { key } = await params;
  const def = getReport(key);
  if (!def) notFound();
  const user = await requireUser(def.perm);
  if (!canSeeReport(user, def)) notFound();
  const s = await searchParams;
  const filters = parseFilters(s);
  const [result, options] = await Promise.all([def.run(filters, { user, branchId: user.branchId }), filterOptions(user.branchId, def.filters)]);
  const qs = new URLSearchParams(Object.entries(s).filter(([, v]) => typeof v === "string" && v)).toString();
  const moneyChart = result.chart ? result.columns.find((c) => c.key === result.chart!.y[0])?.format === "money" : false;
  return (
    <>
      <PageHeader title={def.title} description={def.description} breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: def.module }]}
        actions={<>
          <LinkButton href={`/api/reports/${key}?format=pdf&${qs}`} target="_blank"><FileDown className="size-4" />PDF</LinkButton>
          <LinkButton href={`/api/reports/${key}?format=xlsx&${qs}`}><FileSpreadsheet className="size-4" />Excel</LinkButton>
          <LinkButton href={`/api/reports/${key}?format=pdf&${qs}`} target="_blank" variant="ghost"><Printer className="size-4" />Print</LinkButton>
        </>} />
      <Card className="mb-4 p-3">
        <FilterBar>
          {def.filters.includes("dateRange") && <><FilterDate name="from" label="From" /><FilterDate name="to" label="To" /></>}
          {def.groupBy && <FilterSelect name="groupBy" label={`Group by ${def.groupBy[0].label.toLowerCase()}`} options={def.groupBy.slice(1)} />}
          {def.filters.filter((f): f is Exclude<FilterKey, "dateRange"> => f !== "dateRange" && f !== "status").map((f) => (
            <FilterSelect key={f} name={PARAM[f]} label={LABELS[f]} options={options[f] ?? []} />
          ))}
          {def.filters.includes("status") && def.statusFilter && <FilterSelect name="status" label={def.statusFilter.label} options={def.statusFilter.options} />}
        </FilterBar>
      </Card>
      {result.chart && result.rows.length > 0 && (
        <Card className="mb-4 p-4"><ReportChart type={result.chart.type} data={result.rows} x={result.chart.x} y={result.chart.y} money={moneyChart} labels={Object.fromEntries(result.columns.map((c) => [c.key, c.label]))} /></Card>
      )}
      <Card>
        <Table>
          <THead><tr>{result.columns.map((c) => <TH key={c.key} align={c.align ?? (c.format === "money" || c.format === "number" ? "right" : "left")}>{c.label}</TH>)}</tr></THead>
          <TBody>
            {result.rows.length === 0 && <EmptyRow colSpan={result.columns.length} message="No data for these filters." />}
            {result.rows.map((r, i) => (
              <TR key={i}>{result.columns.map((c) => <TD key={c.key} align={c.align ?? (c.format === "money" || c.format === "number" ? "right" : "left")}>{formatCell(c, r[c.key])}</TD>)}</TR>
            ))}
            {result.totals && result.rows.length > 0 && (
              <tr className="bg-slate-50 font-semibold">{result.columns.map((c) => <TD key={c.key} align={c.align ?? (c.format === "money" || c.format === "number" ? "right" : "left")} className="font-semibold text-slate-900">{result.totals![c.key] !== undefined ? formatCell(c, result.totals![c.key]) : ""}</TD>)}</tr>
            )}
          </TBody>
        </Table>
        {result.note && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{result.note}</p>}
      </Card>
    </>
  );
}
