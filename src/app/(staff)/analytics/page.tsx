import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { feesDashboard } from "@/server/fees/dashboard";
import { busOccupancy, stationerySpendByMonth, uniformDemandByYear } from "@/server/system/analytics";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge } from "@/components/ui";
import { ReportChart } from "@/components/charts/report-chart";
import { money } from "@/lib/format";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = await requireUser(["reports.fees", "reports.stationery", "reports.uniforms", "reports.transport"]);
  const b = user.branchId;
  const can = { fees: hasPerm(user, "reports.fees"), st: hasPerm(user, "reports.stationery"), un: hasPerm(user, "reports.uniforms"), tr: hasPerm(user, "reports.transport") };

  const [fees, spend, uniformRows, occupancy] = await Promise.all([
    can.fees ? feesDashboard(b) : null,
    can.st ? stationerySpendByMonth(b) : [],
    can.un ? uniformDemandByYear(b) : [],
    can.tr ? busOccupancy(b) : [],
  ]);

  // Uniform demand forecast: next year's demand = this year's orders × (active students now / students last year), per item.
  const [studentsNow, studentsPrev] = can.un ? await Promise.all([
    db.student.count({ where: { branchId: b, status: "ACTIVE" } }),
    db.enrolment.count({ where: { student: { branchId: b }, academicYear: { isCurrent: false, closedAt: { not: null } } } }),
  ]) : [0, 0];
  const growth = studentsPrev > 0 ? studentsNow / studentsPrev : 1;
  const items = [...new Set(uniformRows.map((r) => r.item))];
  const forecast = items.map((item) => {
    const cur = uniformRows.find((r) => r.item === item && r.isCurrent)?.qty ?? 0;
    const prev = uniformRows.filter((r) => r.item === item && !r.isCurrent).at(-1)?.qty ?? 0;
    const base = cur || prev;
    return { item, prev, cur, forecast: Math.ceil(base * growth) };
  });

  return (
    <>
      <PageHeader title="Analytics" description="Trends across the school: fee collection, stationery spend, uniform demand and bus occupancy." />
      <div className="grid gap-5 lg:grid-cols-2">
        {fees && (
          <Card className="lg:col-span-2">
            <CardHeader title="Fee collection trend" description={`Last 12 months · this year ${money(fees.collectedYear)} · pending ${money(fees.pendingDues)}`} />
            <CardBody><ReportChart type="line" data={fees.trend} x="month" y={["amount"]} labels={{ amount: "Collected" }} money /></CardBody>
          </Card>
        )}
        {can.st && (
          <Card>
            <CardHeader title="Stationery spend, month on month" description="Value of stationery issued (quantity × unit cost)" />
            <CardBody>{spend.length ? <ReportChart type="bar" data={spend} x="month" y={["amount"]} labels={{ amount: "Spend" }} money /> : <p className="py-10 text-center text-sm text-slate-500">No stationery issued in the last 12 months.</p>}</CardBody>
          </Card>
        )}
        {can.tr && (
          <Card>
            <CardHeader title="Bus occupancy" description="Seats filled vs capacity" />
            <CardBody>{occupancy.length ? <ReportChart type="bar" data={occupancy} x="busNo" y={["filled", "capacity"]} labels={{ filled: "Seats filled", capacity: "Capacity" }} /> : <p className="py-10 text-center text-sm text-slate-500">No buses yet.</p>}</CardBody>
          </Card>
        )}
        {can.un && (
          <Card className="lg:col-span-2">
            <CardHeader title="Uniform demand forecast" description={`Next year ≈ this year's orders × student growth (${growth.toFixed(2)}×). See Uniforms → Seasonal planning for size-wise sweater and shoe needs.`} />
            <Table>
              <THead><tr><TH>Item</TH><TH align="right">Previous year</TH><TH align="right">This year</TH><TH align="right">Forecast next year</TH><TH>Trend</TH></tr></THead>
              <TBody>
                {forecast.length === 0 && <EmptyRow colSpan={5} message="No uniform orders yet." />}
                {forecast.map((f) => (
                  <TR key={f.item}>
                    <TD>{f.item}</TD><TD align="right">{f.prev}</TD><TD align="right">{f.cur}</TD><TD align="right" className="font-semibold">{f.forecast}</TD>
                    <TD>{f.prev ? <Badge tone={f.cur >= f.prev ? "green" : "yellow"}>{f.cur >= f.prev ? "+" : ""}{Math.round(((f.cur - f.prev) / f.prev) * 100)}%</Badge> : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
