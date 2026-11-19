"use client";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

// Series colours follow the theme (CSS variables set in globals.css for light and dark).
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const AXIS = { fontSize: 11, fill: "var(--chart-text)" };

export function ReportChart({ type, data, x, y, labels, money }: { type: "bar" | "line"; data: Record<string, unknown>[]; x: string; y: string[]; labels: Record<string, string>; money?: boolean }) {
  const fmt = (v: number) => (money ? `₹${v >= 100000 ? (v / 100000).toFixed(1) + "L" : v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}` : String(v));
  const rows = data.map((r) => ({ ...r, ...Object.fromEntries(y.map((k) => [k, Number(r[k] ?? 0)])) }));
  const common = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis dataKey={x} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={fmt} width={56} />
      <Tooltip cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
        contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink)", fontSize: 12 }}
        labelStyle={{ color: "var(--muted)" }} itemStyle={{ color: "var(--ink)" }}
        formatter={(v) => (money ? `₹${Number(v).toLocaleString("en-IN")}` : Number(v).toLocaleString("en-IN"))} />
      {y.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />}
    </>
  );
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        {type === "line" ? (
          <LineChart data={rows}>{common}{y.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={labels[k] ?? k} stroke={COLORS[i % COLORS.length]} strokeWidth={2.25} dot={false} />)}</LineChart>
        ) : (
          <BarChart data={rows}>{common}{y.map((k, i) => <Bar key={k} dataKey={k} name={labels[k] ?? k} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} maxBarSize={36} />)}</BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
