"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { activeSection, type ClientNavSection } from "./sidebar";

/** The current module's pages as a segmented pill bar (Fees: Overview, Collect fee, Student accounts, …). */
export function SectionNav({ nav }: { nav: ClientNavSection[] }) {
  const pathname = usePathname();
  const section = activeSection(nav, pathname);
  const bar = useRef<HTMLDivElement>(null);
  const items = section?.children ?? [];
  // The deepest matching page is the active pill (e.g. /uniforms/orders/new over /uniforms/orders).
  const active = items
    .filter((c) => pathname === c.href || (c.href !== section?.href && pathname.startsWith(c.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? (pathname === section?.href ? section?.href : undefined);
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  if (items.length < 2) return null;
  // From tablet width up, the pills wrap onto a second line so every page stays visible (Transport and Fees have more
  // pages than fit in one row). On phones the bar scrolls sideways instead, with faded edges to show there is more.
  return (
    <div ref={bar} className="no-print overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] md:overflow-visible">
      <nav aria-label="Section" className="inline-flex min-w-max items-center gap-0.5 rounded-[20px] border border-line bg-surface-2 p-1 md:min-w-0 md:flex-wrap">
        {items.map((c) => (
          <Link key={c.href} href={c.href} aria-current={active === c.href ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
              active === c.href ? "bg-[var(--gold-soft)] font-semibold text-[var(--gold-ink)]" : "text-muted hover:text-ink")}>
            {c.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
