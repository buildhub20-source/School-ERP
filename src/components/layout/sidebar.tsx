"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import type { NavGroup } from "./nav";

export type ClientNavSection = { key: DictKey; href: string; icon: string; group: NavGroup; children?: { href: string; label: string }[] };

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[name] ?? Icons.Circle;
  return <C className={className} strokeWidth={1.75} />;
}

/** The section (module) the current page belongs to: its own page or any of its sub-pages. */
export function activeSection(nav: ClientNavSection[], pathname: string) {
  const within = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
  return nav
    .filter((s) => within(s.href) || s.children?.some((c) => within(c.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function Sidebar({ nav, schoolName, logoUrl, open, onClose }: { nav: ClientNavSection[]; schoolName: string; logoUrl?: string; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const current = activeSection(nav, pathname);
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [...new Set(nav.map((s) => s.group))];
  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-line px-5">
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-xl bg-white object-contain p-0.5" />
          : <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-ink"><Icons.School className="size-[18px]" strokeWidth={1.75} /></div>}
        <span className="line-clamp-2 text-sm font-semibold leading-tight text-ink">{schoolName}</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-2" aria-label="Main">
        {groups.map((g) => (
          <div key={g} className="mt-4 first:mt-2">
            {g !== "Overview" && <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/80">{g}</p>}
            <ul className="space-y-0.5">
              {nav.filter((s) => s.group === g).map((s) => {
                const active = current?.href === s.href;
                return (
                  <li key={s.href}>
                    <Link href={s.href} aria-current={active ? "page" : undefined}
                      className={cn("flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-150",
                        active ? "bg-brand-300 text-on-brand" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                      <Icon name={s.icon} className="size-[18px] shrink-0" />
                      <span className="min-w-0 leading-snug">{t(s.key)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-rail lg:block">{content}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-rail shadow-2xl">{content}</aside>
        </div>
      )}
    </>
  );
}
