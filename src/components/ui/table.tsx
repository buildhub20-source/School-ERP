import { cn } from "./cn";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="min-w-full divide-y divide-line text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-surface-2/70">{children}</thead>;
}
export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line/70">{children}</tbody>;
}
export function TR({ children, className, highlight }: { children: React.ReactNode; className?: string; highlight?: "red" | "yellow" | "green" }) {
  const h = highlight === "red" ? "bg-rose-50/60" : highlight === "yellow" ? "bg-amber-50/60" : highlight === "green" ? "bg-emerald-50/60" : "";
  return <tr className={cn("transition-colors duration-100 hover:bg-surface-2/60", h, className)}>{children}</tr>;
}
export function TH({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return <th scope="col" className={cn("px-3 py-3 text-xs font-semibold text-muted whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)}>{children}</th>;
}
export function TD({ children, className, align, colSpan }: { children?: React.ReactNode; className?: string; align?: "left" | "right" | "center"; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-3 py-3 text-slate-700 align-top first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5 [&_.block.text-xs]:whitespace-nowrap", align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : "", className)}>{children}</td>;
}
export function EmptyRow({ colSpan, message = "No records found." }: { colSpan: number; message?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center text-sm text-muted">{message}</td>
    </tr>
  );
}
