import { cn } from "./cn";

const tones = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  indigo: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  yellow: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type Tone = keyof typeof tones;

const dots: Record<Tone, string> = { gray: "bg-slate-400", blue: "bg-sky-500", indigo: "bg-blue-500", green: "bg-emerald-500", yellow: "bg-amber-500", red: "bg-rose-500", purple: "bg-violet-500" };

/** Chip. `dot` adds a small status light (used by StatusBadge): state reads from the word and the dot together. */
export function Badge({ tone = "gray", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: "green", PENDING: "yellow", APPROVED: "green", PARTIALLY_APPROVED: "blue", REJECTED: "red", ISSUED: "indigo", CANCELLED: "gray",
  PAID: "green", PARTIAL: "blue", WAIVED: "purple", OVERDUE: "red", ORDERED: "yellow", READY: "blue", DELIVERED: "green",
  DRAFT: "gray", PARTIALLY_RECEIVED: "blue", RECEIVED: "green", IN_PROGRESS: "yellow", COMPLETED: "green",
  SUCCESS: "green", FAILED: "red", BOUNCED: "red", SENT: "green", SANDBOX: "purple", QUEUED: "yellow",
  LEFT: "gray", GRADUATED: "indigo", ENDED: "gray", OPEN: "yellow", DONE: "green", EXPIRED: "red", EXPIRING: "yellow", VALID: "green",
  LOW: "red", OK: "green",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge dot tone={STATUS_TONES[status] ?? "gray"}>{label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
