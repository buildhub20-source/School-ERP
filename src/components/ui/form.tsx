import { cn } from "./cn";

const base = "block w-full rounded-xl border border-line bg-canvas px-3.5 py-2 text-ink placeholder:text-muted/80 transition-colors hover:border-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-300/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-rose-400";

/** React 19: `ref` is an ordinary prop and is passed through to the <input>. */
export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(base, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(base, "min-h-20", className)} {...props} />;
}

export function Select({ className, children, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  return (
    <select className={cn(base, "h-10 pr-8", className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-ink", className)}>
      <input type="checkbox" className="size-4 rounded border-line accent-brand-500" {...props} />
      {label}
    </label>
  );
}

export function Field({ label, hint, error, required, className, children, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; error?: string; required?: boolean; className?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cn("grid grid-cols-1 gap-4", c, className)}>{children}</div>;
}
