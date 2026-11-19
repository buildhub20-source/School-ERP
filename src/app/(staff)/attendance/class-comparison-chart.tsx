"use client";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";

export type ClassRow = { sectionId: string; label: string; teacher: string | null; marked: number; absent: number; half: number; late: number; percent: number };

const AXIS = { fontSize: 11, fill: "var(--chart-text)" };
const ROW_PX = 22;

/**
 * Attendance lost per class over the same school days as the daily chart (100 − attendance %, so a half day counts
 * half), worst first, against the school average. Click a class to open its monthly register.
 */
export function ClassComparisonChart({ data, average, month }: { data: ClassRow[]; average: number | null; month: string }) {
  const router = useRouter();
  const rows = data.map((d) => ({ ...d, lost: Math.round((100 - d.percent) * 10) / 10 })).sort((a, b) => b.lost - a.lost || a.label.localeCompare(b.label));
  const avgLost = average === null ? null : Math.round((100 - average) * 10) / 10;
  const open = (r?: { sectionId?: string }) => { if (r?.sectionId) router.push(`/attendance/month?sectionId=${r.sectionId}&month=${month}`); };

  return (
    <div>
      <div className="w-full px-2 pt-2" style={{ height: rows.length * ROW_PX + 48 }} role="img"
        aria-label={`Attendance lost per class, highest first. ${rows.slice(0, 3).map((r) => `${r.label} ${r.lost}%`).join(", ")}${avgLost !== null ? `; school average ${avgLost}%` : ""}`}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" barCategoryGap={4} margin={{ top: 20, right: 24, left: 4, bottom: 4 }}
            onClick={(e) => open(rows[Number(e?.activeTooltipIndex)])} style={{ cursor: "pointer" }}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" orientation="top" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} allowDecimals={false} />
            <YAxis type="category" dataKey="label" tick={AXIS} axisLine={false} tickLine={false} width={88} interval={0} />
            <Tooltip cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }} content={<ClassTooltip average={average} />} />
            {avgLost !== null && (
              <ReferenceLine x={avgLost} stroke="var(--chart-text)" strokeDasharray="4 3"
                label={{ value: `School ${avgLost}%`, position: "insideBottomRight", fontSize: 11, fill: "var(--chart-text)" }} />
            )}
            <Bar dataKey="lost" name="Attendance lost" fill="var(--att-absent)" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="border-t border-line px-5 py-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">View as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-muted"><tr><th className="py-1 text-left font-medium">Class</th><th className="text-right font-medium">Attendance</th><th className="text-right font-medium">Lost</th><th className="text-right font-medium">Absent</th><th className="text-right font-medium">Half day</th><th className="text-right font-medium">Late</th><th className="text-right font-medium">Student-days</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sectionId} className="border-t border-line">
                  <td className="py-1"><a href={`/attendance/month?sectionId=${r.sectionId}&month=${month}`} className="hover:text-brand-700">{r.label}</a></td>
                  <td className="text-right">{r.percent}%</td><td className="text-right">{r.lost}%</td>
                  <td className="text-right">{r.absent}</td><td className="text-right">{r.half}</td><td className="text-right">{r.late}</td><td className="text-right">{r.marked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ClassTooltip({ active, payload, average }: { active?: boolean; payload?: { payload: ClassRow & { lost: number } }[]; average: number | null }) {
  const r = active ? payload?.[0]?.payload : undefined;
  if (!r) return null;
  const diff = average === null ? null : Math.round((r.percent - average) * 10) / 10;
  return (
    <div className="min-w-48 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink shadow-card">
      <div className="font-medium">{r.label}</div>
      <div className="mb-1.5 text-muted">{r.teacher ?? "No class teacher"}</div>
      <div>Attendance <span className="font-semibold">{r.percent}%</span>{diff !== null && <span className="text-muted"> ({diff >= 0 ? "+" : ""}{diff} vs school)</span>}</div>
      <div className="tabular-nums text-muted">{r.absent} absent · {r.half} half day · {r.late} late</div>
      <div className="mt-1.5 text-muted">{r.marked} student-days marked · click for the month</div>
    </div>
  );
}
