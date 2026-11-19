"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";
import { Button, type ButtonVariant } from "./button";
import type { ActionResult } from "@/lib/action";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerAction<T> = (input: any) => Promise<ActionResult<T>>;

/** Hook to call a server action with toast feedback and router refresh. */
export function useAction<T>(action: ServerAction<T>, opts: { successMessage?: string | ((data: T) => string); onSuccess?: (data: T) => void; refresh?: boolean } = {}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = (input: FormData | Record<string, unknown>) =>
    new Promise<ActionResult<T>>((resolve) => {
      start(async () => {
        const res = await action(input);
        if (res.ok) {
          setError(null);
          setFields({});
          // "@result" (usable from server components) shows the action's own message: a returned string or data.message.
          const fromResult = () => (typeof res.data === "string" ? res.data : ((res.data as { message?: string } | null)?.message ?? "Done"));
          const msg = opts.successMessage === "@result" ? fromResult() : typeof opts.successMessage === "function" ? opts.successMessage(res.data) : opts.successMessage;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
          if (opts.refresh !== false) router.refresh();
        } else {
          setError(res.error);
          setFields(res.fields ?? {});
          toast.error(res.error);
        }
        resolve(res);
      });
    });
  return { run, pending, error, fields };
}

/**
 * A <form> that submits to a server action created with defineAction.
 * Inputs use normal `name` attributes; names ending in [] become arrays.
 */
export function ActionForm<T>({ action, children, submitLabel = "Save", submitVariant = "primary", successMessage = "Saved", onSuccess, redirectTo, resetOnSuccess, className, hideSubmit, extra, cancel }: {
  action: ServerAction<T>;
  children: React.ReactNode;
  submitLabel?: string;
  submitVariant?: ButtonVariant;
  successMessage?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  redirectTo?: string | ((data: T) => string);
  resetOnSuccess?: boolean;
  className?: string;
  hideSubmit?: boolean;
  extra?: Record<string, string | number | boolean | undefined>;
  cancel?: React.ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const { run, pending, error } = useAction(action, {
    successMessage,
    onSuccess: (d) => {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(d);
      if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(d) : redirectTo);
    },
  });
  return (
    <form
      ref={ref}
      className={className ?? "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (extra) for (const [k, v] of Object.entries(extra)) if (v !== undefined) fd.set(k, String(v));
        run(fd);
      }}
    >
      {children}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p>}
      {!hideSubmit && (
        <div className="flex justify-end gap-2 pt-1">
          {cancel}
          <Button type="submit" variant={submitVariant} loading={pending}>{submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
