import Link from "next/link";
import { cn } from "./cn";

/** Link-based tabs. `active` is the href (or key) of the current tab. */
export function Tabs({ tabs, active }: { tabs: { href: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="no-print mb-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav className="inline-flex min-w-max gap-0.5 rounded-full border border-line bg-surface-2 p-1">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active === t.href ? "page" : undefined}
            className={cn("inline-flex items-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150", active === t.href ? "bg-brand-300 text-on-brand" : "text-muted hover:text-ink")}>
            {t.label}
            {t.count !== undefined && <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", active === t.href ? "bg-black/10" : "bg-slate-100 text-slate-600")}>{t.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
