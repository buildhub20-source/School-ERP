/**
 * Standalone automation worker. Use it when the web server runs with RUN_SCHEDULER=false
 * (for example when several web instances run behind a load balancer). Run: npm run worker
 */
import cron from "node-cron";
import { runDueAutomations } from "../src/lib/automations/runner";

const tick = () => runDueAutomations().then((r) => console.log(new Date().toISOString(), r)).catch((e) => console.error(e));
cron.schedule("*/5 * * * *", tick);
console.log("Automation worker started (checks every 5 minutes).");
tick();
