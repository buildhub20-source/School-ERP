import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "./cn";

type Tone = "indigo" | "green" | "red" | "yellow" | "blue" | "gray";

/**
 * Figure tile: label, value, supporting line. Icons stay neutral: gold is reserved for actions and selection, and state
 * is always said in words (the hint), never by an icon's colour. `tone` is accepted for compatibility.
 */
export function StatCard({ label, value, hint, href, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; icon?: React.ReactNode; tone?: Tone }) {
  const body = (
    <div className={cn("group relative flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5", href && "transition-colors duration-150 hover:border-slate-300")}>
      <div className="flex items-center gap-2.5">
        {icon && <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted [&>svg]:size-4">{icon}</span>}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted">{label}</p>
        {href && <ArrowUpRight className="size-4 shrink-0 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden />}
      </div>
      <div className="min-w-0">
        <p data-stat-value className="truncate text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl">{body}</Link> : body;
}

/** Secondary figures as one compact strip (same label / value / hint / link as a tile, without the tile). */
export function StatStrip({ items }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] lg:grid-cols-4">
      {items.map((it, n) => {
        const inner = (
          <>
            <p className="truncate text-xs font-medium text-muted">{it.label}</p>
            <p data-stat-value className="mt-1 truncate text-lg font-semibold text-ink tabular-nums">{it.value}</p>
            {it.hint && <p className="mt-0.5 truncate text-xs text-muted">{it.hint}</p>}
          </>
        );
        const cls = cn("block min-w-0 px-4 py-3.5 sm:px-5", n % 2 === 1 && "border-l border-line", n >= 2 && "border-t border-line lg:border-t-0", n >= 1 && "lg:border-l", it.href && "transition-colors duration-150 hover:bg-surface-2/70");
        return it.href ? <Link key={it.label} href={it.href} className={cls}>{inner}</Link> : <div key={it.label} className={cls}>{inner}</div>;
      })}
    </div>
  );
}
