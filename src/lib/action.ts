import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AppError } from "./errors";
import { runWithContext } from "./context";
import { clientIp, requireUserOrThrow, type SessionUser } from "./auth/session";
import type { Permission } from "./permissions";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fields?: Record<string, string> };

export type ActionCtx = { user: SessionUser; branchId: string; ip?: string };

/** Turn FormData or a plain object into a plain object. Keys ending in [] become arrays. Empty strings become undefined. */
export function toObject(input: unknown): Record<string, unknown> {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of input.entries()) {
      if (k.startsWith("$ACTION")) continue;
      const value = typeof v === "string" ? (v === "" ? undefined : v) : v;
      if (k.endsWith("[]")) {
        const key = k.slice(0, -2);
        (out[key] = (out[key] as unknown[]) ?? []);
        if (value !== undefined) (out[key] as unknown[]).push(value);
      } else out[k] = value;
    }
    return out;
  }
  return (input ?? {}) as Record<string, unknown>;
}

/**
 * Wrap a server action with: authentication, permission check, zod validation,
 * audit context (who/where), user-friendly errors and optional path revalidation.
 */
export function defineAction<S extends z.ZodType, R>(
  opts: { perm?: Permission | Permission[]; schema: S; revalidate?: string | string[]; /** own-account actions allowed before a forced password change / 2-step setup */ selfService?: boolean },
  fn: (input: z.infer<S>, ctx: ActionCtx) => Promise<R>,
) {
  return async (raw: unknown): Promise<ActionResult<R>> => {
    try {
      const user = await requireUserOrThrow(opts.perm, { selfService: opts.selfService });
      const parsed = opts.schema.safeParse(toObject(raw));
      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) fields[issue.path.join(".")] ??= issue.message;
        const first = parsed.error.issues[0];
        return { ok: false, error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input", fields };
      }
      const ip = await clientIp();
      const data = await runWithContext({ userId: user.id, userName: user.name, branchId: user.branchId, ip }, () =>
        fn(parsed.data, { user, branchId: user.branchId, ip }),
      );
      for (const p of ([] as string[]).concat(opts.revalidate ?? [])) revalidatePath(p, "layout");
      return { ok: true, data };
    } catch (e) {
      if (e instanceof AppError) return { ok: false, error: e.message, fields: e.fields };
      const err = e as { code?: string; meta?: { target?: string[] } };
      if (err?.code === "P2002") return { ok: false, error: `A record with this ${err.meta?.target?.join(", ") ?? "value"} already exists.` };
      if (err?.code === "P2003") return { ok: false, error: "This record is linked to other records and cannot be changed or removed." };
      if (err?.code === "P2025") return { ok: false, error: "The record was not found. It may have been removed." };
      console.error("[action] unexpected error", e);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}

// Common zod helpers for form inputs
export const zs = {
  id: z.string().min(1),
  str: (max = 200) => z.string().trim().min(1, "Required").max(max),
  optStr: (max = 500) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined)),
  int: (min = 0) => z.coerce.number().int().min(min),
  optInt: () => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number().int().optional()),
  money: () => z.coerce.number().min(0).max(100_000_000).transform((n) => Math.round(n * 100) / 100),
  optMoney: () => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number().min(0).optional()),
  date: () => z.coerce.date(),
  optDate: () => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.date().optional()),
  bool: () => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean()),
  phone: () => z.string().trim().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).refine((s) => /^\d{10}$/.test(s), "Enter a 10-digit mobile number"),
  optPhone: () => z.string().trim().optional().transform((s) => (s ? s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") : undefined)).refine((s) => !s || /^\d{10}$/.test(s), "Enter a 10-digit mobile number"),
  email: () => z.string().trim().toLowerCase().email(),
  optEmail: () => z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  json: <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), schema),
};
