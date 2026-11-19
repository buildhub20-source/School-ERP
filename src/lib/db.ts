import { Prisma, PrismaClient } from "@prisma/client";
import { getRequestContext } from "./context";
import { createJsonClient } from "./json-db/client";

/** Models whose writes are not audited (system/high-volume tables or the audit log itself). */
const UNAUDITED = new Set([
  "AuditLog", "Session", "Notification", "MessageLog", "BusLocation", "AutomationRun",
  "Counter", "OtpCode", "PushSubscription", "TripStopEvent", "Backup", "AutomationSetting",
]);
const REDACT = new Set(["passwordHash", "twoFactorSecret", "tokenHash", "codeHash"]);
const WRITE_OPS = new Set(["create", "update", "upsert", "delete", "createMany", "updateMany", "deleteMany", "createManyAndReturn", "updateManyAndReturn"]);

function clean(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value, (k, v) => {
    if (REDACT.has(k)) return "[redacted]";
    if (typeof v === "bigint") return v.toString();
    return v;
  });
  return json === undefined ? undefined : (JSON.parse(json) as Prisma.InputJsonValue);
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function makeClient() {
  // No database: the JSON data engine answers the same Prisma calls from data/demo-data.json (changes saved to .poc/data.json).
  const base = createJsonClient() as unknown as PrismaClient;

  return base.$extends({
    name: "audit-trail",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || UNAUDITED.has(model) || !WRITE_OPS.has(operation)) return query(args);
          const ctx = getRequestContext();
          if (ctx?.skipAudit) return query(args);

          const delegate = (base as unknown as Record<string, { findUnique: (a: unknown) => Promise<unknown> }>)[lowerFirst(model)];
          let before: unknown = undefined;
          const a = args as { where?: unknown; data?: unknown };
          if ((operation === "update" || operation === "delete" || operation === "upsert") && a.where) {
            before = await delegate.findUnique({ where: a.where }).catch(() => undefined);
          }
          const result = await query(args);

          const action =
            operation.startsWith("create") ? "CREATE" :
            operation.startsWith("delete") ? "DELETE" :
            operation === "upsert" ? (before ? "UPDATE" : "CREATE") : "UPDATE";
          const isMany = operation.endsWith("Many") || operation.endsWith("AndReturn");
          const entityId = !isMany ? ((result as { id?: string } | null)?.id ?? (before as { id?: string } | undefined)?.id) : undefined;

          await base.auditLog.create({
            data: {
              userId: ctx?.userId,
              userName: ctx?.userName ?? (ctx?.userId ? undefined : "System"),
              branchId: ctx?.branchId,
              ip: ctx?.ip,
              action: isMany ? `${action}_MANY` : action,
              entity: model,
              entityId: typeof entityId === "string" ? entityId : undefined,
              before: clean(before),
              after: clean(action === "DELETE" ? undefined : isMany ? { where: a.where, data: a.data, count: (result as { count?: number })?.count } : result),
            },
          }).catch((e) => console.error("[audit] failed", e));

          return result;
        },
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedClient };

export const db: ExtendedClient = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Parameters<Parameters<ExtendedClient["$transaction"]>[0]>[0];
export type DbOrTx = ExtendedClient | Tx;
