import cron from "node-cron";
import { runDueAutomations } from "./lib/automations/runner";
import { syncRoles } from "./lib/role-sync";

// New modules bring new permissions and roles: add them to existing installations once, at start-up.
syncRoles().then((r) => { if (r.added || r.createdRoles.length) console.log("[roles] synced", r); }).catch((e) => console.error("[roles] sync failed", e));

const g = globalThis as unknown as { __smsScheduler?: boolean };
if (process.env.RUN_SCHEDULER !== "false" && !g.__smsScheduler) {
  g.__smsScheduler = true;
  // Every 5 minutes: run any daily automation whose configured time has passed today.
  cron.schedule("*/5 * * * *", () => {
    runDueAutomations().then((r) => { if (Object.keys(r).length) console.log("[scheduler]", r); }).catch((e) => console.error("[scheduler] error", e));
  });
  console.log("[scheduler] automation scheduler started");
}

// POC / demo only: simulated bus GPS so the live map and parent bus tracker move without drivers' phones.
if (process.env.MOCK_GPS === "true") {
  import("./server/transport/simulator").then((m) => m.startGpsSimulator()).catch((e) => console.error("[mock-gps] failed to start", e));
}
