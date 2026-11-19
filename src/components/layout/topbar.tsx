"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Menu, Search, LogOut, User, Globe, Building2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/components/ui/cn";
import { logout } from "@/app/(auth)/actions";
import { setMyLanguage, switchBranch } from "@/app/(staff)/account/actions";
import { ThemeToggle } from "./theme-toggle";

type SearchHit = { type: string; label: string; sub?: string; href: string };

export function GlobalSearch({ enabled }: { enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).catch(() => null);
      if (r?.ok) { setHits((await r.json()).results); setIdx(0); setOpen(true); }
    }, 200);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, enabled]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); box.current?.querySelector("input")?.focus(); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);
  if (!enabled) return <div className="flex-1" />;
  const go = (h: SearchHit) => { setOpen(false); setQ(""); router.push(h.href); };
  return (
    <div ref={box} className="relative max-w-xl flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} placeholder={t("common.searchPlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter" && hits[idx]) go(hits[idx]);
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-muted transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-300/30" />
      {open && q.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-12 z-50 max-h-96 overflow-y-auto rounded-2xl border border-line bg-surface py-1.5 shadow-2xl">
          {hits.length === 0 ? <p className="px-4 py-3 text-sm text-muted">No matches.</p> : hits.map((h, i) => (
            <button key={h.href + i} onMouseEnter={() => setIdx(i)} onClick={() => go(h)} className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === idx && "bg-surface-2")}>
              <span className="w-16 shrink-0 text-[11px] font-medium uppercase text-muted">{h.type}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{h.label}</span>{h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Notif = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ href = "/notifications" }: { href?: string }) {
  const [data, setData] = useState<{ unread: number; items: Notif[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const load = async () => {
    const r = await fetch("/api/notifications").catch(() => null);
    if (r?.ok) setData(await r.json());
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => { clearInterval(id); document.removeEventListener("mousedown", onDoc); };
  }, []);
  const markAll = async () => { await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) }); load(); };
  const openItem = async (n: Notif) => {
    setOpen(false);
    if (!n.readAt) await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ id: n.id }) });
    load();
    if (n.link) router.push(n.link);
  };
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className="relative grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Notifications">
        <Bell className="size-5" />
        {data.unread > 0 && <span className="absolute -right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-canvas">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {data.unread > 0 && <button onClick={markAll} className="text-xs font-medium text-brand-700 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</p> : data.items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cn("relative block w-full border-b border-line/60 px-4 py-3 text-left transition-colors hover:bg-surface-2", !n.readAt && "bg-surface-2 before:absolute before:left-1.5 before:top-4 before:size-1.5 before:rounded-full before:bg-sky-500")}>
                <p className="text-sm font-medium text-ink">{n.title}</p>
                <p className="line-clamp-2 text-xs text-muted [overflow-wrap:anywhere]">{n.body}</p>
                <p className="mt-0.5 text-[11px] text-muted/80">{new Date(n.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </button>
            ))}
          </div>
          <Link href={href} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-xs font-medium text-brand-700 hover:bg-surface-2">View all</Link>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ name, roleName, lang, branches, branchId }: { name: string; roleName: string; lang: string; branches?: { id: string; name: string }[]; branchId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-label="Account menu" aria-expanded={open} className="flex items-center gap-2.5 rounded-full p-1 transition-colors hover:bg-surface-2 sm:pr-3">
        <span className="grid size-8 place-items-center rounded-full border border-line bg-surface-2 text-sm font-semibold text-ink">{name.charAt(0).toUpperCase()}</span>
        <span className="hidden text-left md:block"><span className="block max-w-36 truncate text-sm font-medium leading-4 text-ink">{name}</span><span className="block max-w-36 truncate text-xs text-muted">{roleName}</span></span>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-2xl">
          <div className="border-b border-line px-4 pb-2.5 pt-1.5 md:hidden"><p className="truncate text-sm font-medium text-ink">{name}</p><p className="truncate text-xs text-muted">{roleName}</p></div>
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-surface-2"><User className="size-4 text-muted" />{t("nav.account")}</Link>
          <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-ink sm:hidden"><span>Theme</span><ThemeToggle /></div>
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-ink"><Globe className="size-4 text-muted" />
            {[{ c: "en", l: "English" }, { c: "ta", l: "தமிழ்" }].map((l) => (
              <button key={l.c} onClick={async () => { await setMyLanguage({ language: l.c }); router.refresh(); }} className={cn("rounded-full px-2.5 py-0.5", lang === l.c ? "bg-brand-300 font-medium text-on-brand" : "text-muted hover:bg-surface-2 hover:text-ink")}>{l.l}</button>
            ))}
          </div>
          {branches && branches.length > 1 && (
            <div className="border-t border-line px-4 py-2">
              <p className="mb-1 flex items-center gap-2 text-xs text-muted"><Building2 className="size-3.5" />Branch</p>
              <select value={branchId} onChange={async (e) => { await switchBranch({ branchId: e.target.value }); router.refresh(); }} className="h-8 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <form action={logout} className="mt-1 border-t border-line pt-1"><button className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="size-4" />{t("common.signOut")}</button></form>
        </div>
      )}
    </div>
  );
}

export function MenuButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink lg:hidden" aria-label="Open menu"><Menu className="size-5" /></button>;
}
