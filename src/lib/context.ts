import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  userId?: string;
  userName?: string;
  branchId?: string;
  ip?: string;
  /** Skip audit logging (used by high-volume system writes such as GPS pings). */
  skipAudit?: boolean;
};

// One store per process, shared across hot reloads (the cached Prisma client reads from it).
const g = globalThis as unknown as { __smsContext?: AsyncLocalStorage<RequestContext> };
const storage = (g.__smsContext ??= new AsyncLocalStorage<RequestContext>());

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
