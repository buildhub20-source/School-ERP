"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dict";
import { NotificationBell } from "./topbar";
import { IdleLogout } from "./idle-logout";
import { ThemeToggle } from "./theme-toggle";
import { logout } from "@/app/(auth)/actions";

export type PortalNav = { href: string; key: DictKey; icon: string };

function Icon({ name, className }: { name: string; className?: string }) {
  const C = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name] ?? Icons.Circle;
  return <C className={className} />;
}

/** Mobile-first shell for the parent and driver apps: top bar + bottom tab bar on phones, side tabs on desktop. */
export function PortalShell({ nav, title, userName, idleMinutes, notificationsHref, children }: { nav: PortalNav[]; title: string; userName: string; idleMinutes: number; notificationsHref: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const active = (href: string) => pathname === href || (href.split("/").length > 2 && pathname.startsWith(href));
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-ink"><Icons.School className="size-[18px]" strokeWidth={1.75} /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{title}</p><p className="truncate text-xs text-muted">{userName}</p></div>
          <ThemeToggle className="hidden min-[400px]:flex" />
          <NotificationBell href={notificationsHref} />
          <Link href={nav.find((n) => n.href.endsWith("/settings"))?.href ?? "#"} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Settings"><Icons.Settings className="size-5" /></Link>
          <form action={logout}><button className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label={t("common.signOut")}><Icons.LogOut className="size-5" /></button></form>
        </div>
        <nav className="mx-auto hidden max-w-5xl px-4 pb-3 md:block"><div className="inline-flex gap-0.5 rounded-full border border-line bg-surface-2 p-1">
          {nav.filter((n) => !n.href.endsWith("/settings")).map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-150", active(n.href) ? "bg-brand-300 text-on-brand" : "text-muted hover:text-ink")}>
              <Icon name={n.icon} className="size-4" />{t(n.key)}
            </Link>
          ))}
        </div></nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-surface/95 backdrop-blur-md md:hidden" style={{ gridTemplateColumns: `repeat(${nav.filter((n) => !n.href.endsWith("/settings")).length}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {nav.filter((n) => !n.href.endsWith("/settings")).map((n) => (
          <Link key={n.href} href={n.href} className={cn("flex flex-col items-center justify-start gap-1 py-2 text-[11px] font-medium", active(n.href) ? "text-brand-700" : "text-muted")}>
            <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors duration-150", active(n.href) && "bg-brand-300 text-on-brand")}><Icon name={n.icon} className="size-[18px]" /></span><span className="line-clamp-2 max-w-full px-0.5 text-center leading-tight [overflow-wrap:anywhere]">{t(n.key)}</span>
          </Link>
        ))}
      </nav>
      <IdleLogout minutes={idleMinutes} />
      <RegisterSW />
    </div>
  );
}

function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
