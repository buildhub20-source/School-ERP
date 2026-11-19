import Link from "next/link";
import { buttonClass } from "./button";

export function Pagination({ page, pageSize, total, searchParams, basePath }: { page: number; pageSize: number; total: number; searchParams: Record<string, string | string[] | undefined>; basePath: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-muted sm:px-5">
      <span className="tabular-nums">{from}–{to} of {total}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={href(page - 1)}>Previous</Link> : <span className={buttonClass("secondary", "sm", "opacity-50 pointer-events-none")}>Previous</span>}
        {page < pages ? <Link className={buttonClass("secondary", "sm")} href={href(page + 1)}>Next</Link> : <span className={buttonClass("secondary", "sm", "opacity-50 pointer-events-none")}>Next</span>}
      </div>
    </div>
  );
}

export function pageParams(sp: Record<string, string | string[] | undefined>, pageSize = 25) {
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function sp(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}
