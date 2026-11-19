"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "./cn";

type Toast = { id: number; kind: "success" | "error" | "info"; message: string };
const Ctx = createContext<{ push: (kind: Toast["kind"], message: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-2xl border bg-surface px-4 py-3 text-sm shadow-2xl", t.kind === "error" ? "border-rose-200" : t.kind === "success" ? "border-emerald-200" : "border-line")}>
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : t.kind === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" /> : <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />}
            <p className="flex-1 text-ink">{t.message}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-muted hover:text-ink" aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const { push } = useContext(Ctx);
  return { success: (m: string) => push("success", m), error: (m: string) => push("error", m), info: (m: string) => push("info", m) };
}
