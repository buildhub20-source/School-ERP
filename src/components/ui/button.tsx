import Link from "next/link";
import { cn } from "./cn";

const variants = {
  primary: "bg-brand-300 text-on-brand hover:bg-brand-400 active:bg-brand-500 shadow-sm disabled:opacity-50",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-slate-300 disabled:text-muted",
  danger: "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 disabled:opacity-50",
  success: "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  link: "text-brand-700 underline-offset-4 hover:underline px-0 py-0",
};
const sizes = { sm: "h-8 px-3.5 text-[13px] gap-1.5", md: "h-10 px-5 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] whitespace-nowrap disabled:cursor-not-allowed disabled:active:scale-100",
    variants[variant], variant !== "link" && sizes[size], variant === "primary" && "btn-primary", className,
  );
}

export function Button({ variant, size, className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={loading || props.disabled} {...props}>
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size, className, children, ...rest }: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: React.ReactNode; target?: string; prefetch?: boolean }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
