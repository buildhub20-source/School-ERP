"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "./cn";

/**
 * GET filter form: every input change updates the URL (debounced for text). Put <Input name=…>/<Select name=…> inside.
 */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      const v = params.get(el.name);
      if (el.type === "checkbox") el.checked = v === "1";
      else if (v !== null && el.value !== v) el.value = v;
    }
  }, [params]);

  const apply = () => {
    const form = ref.current;
    if (!form) return;
    const sp = new URLSearchParams();
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      if (el.type === "checkbox") { if (el.checked) sp.set(el.name, "1"); }
      else if (el.value) sp.set(el.name, el.value);
    }
    router.replace(`${pathname}?${sp.toString()}`);
  };

  return (
    <form ref={ref} className={cn("no-print flex flex-wrap items-center gap-2", className)}
      onSubmit={(e) => { e.preventDefault(); apply(); }}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(apply, t.type === "text" || t.type === "search" ? 350 : 0);
      }}>
      {children}
    </form>
  );
}

export function SearchField({ name = "q", placeholder = "Search…", className }: { name?: string; placeholder?: string; className?: string }) {
  const params = useSearchParams();
  const [v, setV] = useState(params.get(name) ?? "");
  return (
    <div className={cn("relative min-w-48 flex-1 sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input type="search" name={name} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-full border border-line bg-canvas pl-10 pr-4 text-ink placeholder:text-muted/80 transition-colors hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-300/30 focus:outline-none" />
    </div>
  );
}

export function FilterSelect({ name, label, options, className }: { name: string; label: string; options: { value: string; label: string }[]; className?: string }) {
  const params = useSearchParams();
  return (
    <select name={name} defaultValue={params.get(name) ?? ""} aria-label={label}
      className={cn("h-10 rounded-full border border-line bg-canvas px-4 pr-9 text-sm text-ink transition-colors hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-300/30 focus:outline-none", className)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function FilterDate({ name, label }: { name: string; label: string }) {
  const params = useSearchParams();
  return (
    <label className="relative inline-flex items-center">
      <span className="pointer-events-none absolute left-4 text-xs font-medium text-muted">{label}</span>
      <input type="date" name={name} defaultValue={params.get(name) ?? ""} aria-label={label}
        className="h-10 rounded-full border border-line bg-canvas pl-14 pr-4 text-sm text-ink transition-colors hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-300/30 focus:outline-none" />
    </label>
  );
}
