/**
 * One-off: dumps every table of a seeded PostgreSQL database to data/demo-data.json — the mock-data snapshot the
 * JSON data engine (src/lib/json-db) starts from. Only needed again if the demo seed changes.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/export-json.ts
 */
import { Prisma, PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

async function main() {
  const pg = new PrismaClient();
  const tables: Record<string, unknown[]> = {};
  let total = 0;
  for (const m of Prisma.dmmf.datamodel.models) {
    const rows = await (pg as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[lowerFirst(m.name)].findMany();
    tables[m.name] = rows;
    total += rows.length;
  }
  await pg.$disconnect();

  // Drop runtime noise: simulated GPS (the simulator regenerates it), and keep only the newest audit entries.
  type Row = Record<string, unknown>;
  const simTrips = new Set((tables.BusTrip as Row[]).filter((t) => t.startedById === "gps-simulator").map((t) => t.id));
  tables.BusTrip = (tables.BusTrip as Row[]).filter((t) => !simTrips.has(t.id));
  tables.TripStopEvent = (tables.TripStopEvent as Row[]).filter((e) => !simTrips.has(e.tripId));
  tables.BusLocation = [];
  const nearStop = (r: Row) => typeof r.title === "string" && / is near /.test(r.title);
  tables.Notification = (tables.Notification as Row[]).filter((n) => !nearStop(n));
  tables.MessageLog = (tables.MessageLog as Row[]).filter((m) => !(m.template === "BUS_NEAR_STOP"));
  tables.AuditLog = (tables.AuditLog as Row[]).sort((a, b) => String(b.createdAt ?? b.at).localeCompare(String(a.createdAt ?? a.at))).slice(0, 1500);
  for (const t of ["AutomationRun", "Session", "OtpCode", "RateLimit"]) tables[t] = (tables[t] ?? []).filter(() => t === "AutomationRun");
  total = Object.values(tables).reduce((s, r) => s + r.length, 0);
  const out = path.resolve("data/demo-data.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Decimal → string, BigInt → string, Date → ISO string. The engine converts them back using the schema.
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), tables }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  fs.writeFileSync(out, json);
  console.log(`${total} rows from ${Object.keys(tables).length} tables → ${out} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
