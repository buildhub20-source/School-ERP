"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, activeSection, type ClientNavSection } from "./sidebar";
import { SectionNav } from "./section-nav";
import { GlobalSearch, MenuButton, NotificationBell, UserMenu } from "./topbar";
import { ThemeToggle } from "./theme-toggle";
import { IdleLogout } from "./idle-logout";

export function StaffShell({ nav, schoolName, logoUrl, user, canSearch, branches, children }: {
  nav: ClientNavSection[];
  schoolName: string;
  logoUrl?: string;
  user: { name: string; roleName: string; language: string; idleMinutes: number; branchId: string };
  canSearch: boolean;
  branches?: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const hasSectionNav = (activeSection(nav, pathname)?.children?.length ?? 0) > 1;
  return (
    <div className="min-h-screen">
      <Sidebar nav={nav} schoolName={schoolName} logoUrl={logoUrl} open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-6">
            <MenuButton onClick={() => setOpen(true)} />
            <GlobalSearch enabled={canSearch} />
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <ThemeToggle className="hidden sm:flex" />
              <NotificationBell />
              <UserMenu name={user.name} roleName={user.roleName} lang={user.language} branches={branches} branchId={user.branchId} />
            </div>
          </div>
          {hasSectionNav && <div className="mx-auto max-w-7xl px-3 pb-3 sm:px-6"><SectionNav nav={nav} /></div>}
        </header>
        <main className="print-full mx-auto max-w-7xl px-3 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
      <IdleLogout minutes={user.idleMinutes} />
    </div>
  );
}
