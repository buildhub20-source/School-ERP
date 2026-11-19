import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function PageHeader({ title, description, actions, breadcrumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6 space-y-2 sm:mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              {b.href ? <Link href={b.href} className="hover:text-ink">{b.label}</Link> : <span>{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink [text-wrap:balance] sm:text-[1.75rem] sm:leading-9">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {/* Phones: the primary action spans the row first; the secondary actions share the row below in equal widths. */}
        {actions && <div className="no-print flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>.btn-primary]:order-first max-sm:[&>.btn-primary]:basis-full">{actions}</div>}
      </div>
    </div>
  );
}
