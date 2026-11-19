import { Check, X } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/components/ui/cn";

type O = { status: string; createdAt: Date; paidAt: Date | null; readyAt: Date | null; deliveredAt: Date | null; cancelledAt: Date | null };

/** Ordered → Paid → Ready → Delivered (server component; used by staff and parent pages). */
type StepKey = "ORDERED" | "PAID" | "READY" | "DELIVERED" | "CANCELLED";

/** `labels` translates the step names (parent app); English is the default. */
export function OrderTimeline({ order, compact, labels }: { order: O; compact?: boolean; labels?: Partial<Record<StepKey, string>> }) {
  const steps = [
    { key: "ORDERED", label: labels?.ORDERED ?? "Ordered", at: order.createdAt },
    { key: "PAID", label: labels?.PAID ?? "Paid", at: order.paidAt },
    { key: "READY", label: labels?.READY ?? "Ready for pickup", at: order.readyAt },
    { key: "DELIVERED", label: labels?.DELIVERED ?? "Delivered", at: order.deliveredAt },
  ];
  const order_ = ["ORDERED", "PAID", "READY", "DELIVERED"];
  const reached = order.status === "CANCELLED" ? steps.filter((s) => s.at).length - 1 : order_.indexOf(order.status);
  return (
    <ol className={cn(compact ? "flex flex-wrap items-center gap-x-1 gap-y-2" : "space-y-3")}>
      {steps.map((s, i) => {
        const done = i <= reached;
        return (
          <li key={s.key} className={cn("flex items-center gap-2", compact && "text-xs")}>
            <span className={cn("grid shrink-0 place-items-center rounded-full", compact ? "size-5" : "size-7", done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400")}>
              {done ? <Check className={compact ? "size-3" : "size-4"} /> : <span className="text-xs">{i + 1}</span>}
            </span>
            <span className={cn(done ? "font-medium text-slate-900" : "text-slate-500")}>{s.label}
              {!compact && done && s.at && <span className="block text-xs font-normal text-slate-500">{fmtDateTime(s.at)}</span>}
            </span>
            {compact && i < steps.length - 1 && <span className={cn("mx-1 h-px w-4", i < reached ? "bg-emerald-500" : "bg-slate-200")} />}
          </li>
        );
      })}
      {order.status === "CANCELLED" && (
        <li className={cn("flex items-center gap-2 text-rose-700", compact && "text-xs")}>
          <span className={cn("grid shrink-0 place-items-center rounded-full bg-rose-600 text-white", compact ? "size-5" : "size-7")}><X className={compact ? "size-3" : "size-4"} /></span>
          <span className="font-medium">{labels?.CANCELLED ?? "Cancelled"}{!compact && order.cancelledAt && <span className="block text-xs font-normal">{fmtDateTime(order.cancelledAt)}</span>}</span>
        </li>
      )}
    </ol>
  );
}
