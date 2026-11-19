import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type AttentionItem = { level: "red" | "amber" | "blue"; label: string; detail?: string; value: React.ReactNode; href: string };

const ORDER = { red: 0, amber: 1, blue: 2 };
const LIGHT = { red: "bg-rose-500 shadow-[0_0_0_4px] shadow-rose-500/20", amber: "bg-amber-500 shadow-[0_0_0_4px] shadow-amber-500/20", blue: "bg-sky-500 shadow-[0_0_0_4px] shadow-sky-500/20" };
const WORD = { red: "Act now", amber: "Soon", blue: "Follow up" };

/** The morning list: what needs action today, most urgent first, each row opening the list where it is done. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const sorted = [...items].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const urgent = items.filter((i) => i.level === "red").length;
  return (
    <section aria-labelledby="attention-title" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
        <h2 id="attention-title" className="text-[15px] font-semibold text-ink">Needs attention today</h2>
        {items.length > 0 && (
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink tabular-nums">{items.length}</span> item{items.length === 1 ? "" : "s"}
            {urgent > 0 && <> · <span className="font-semibold text-rose-700 tabular-nums">{urgent}</span> to act on now</>}
          </p>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
          <CheckCircle2 className="size-5 text-emerald-600" /> All clear. Nothing is overdue or waiting for you today.
        </div>
      ) : (
        // Two columns on wide screens, filled top to bottom (left column first) so the list still reads in rank order.
        <ul className="grid grid-cols-1 divide-y divide-line/70 lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-[repeat(var(--rows),auto)] lg:divide-y-0"
          style={{ "--rows": Math.ceil(sorted.length / 2) } as React.CSSProperties}>
          {sorted.map((i, n) => {
            const rows = Math.ceil(sorted.length / 2);
            return (
            <li key={i.label} className={cn("lg:border-line/70", n < rows && "lg:border-r", n !== 0 && n !== rows && "lg:border-t")}>
              <Link href={i.href} className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-2/70 sm:px-5">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", LIGHT[i.level])} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 text-sm font-medium text-ink">{i.label}</span>
                    <span className={cn("shrink-0 text-[11px] font-medium", i.level === "red" ? "text-rose-700" : i.level === "amber" ? "text-amber-700" : "text-sky-700")}>{WORD[i.level]}</span>
                  </span>
                  {i.detail && <span className="mt-0.5 block truncate text-xs text-muted">{i.detail}</span>}
                </span>
                <span className="shrink-0 text-base font-semibold text-ink tabular-nums">{i.value}</span>
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
