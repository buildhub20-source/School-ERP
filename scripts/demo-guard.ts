/**
 * Refuses to run demo-data commands (db:seed, db:reset) against a live site: they create accounts with published
 * passwords (Admin@12345 / Staff@12345) and db:reset wipes the database.
 * A live site is NODE_ENV=production or an https:// APP_URL. Override for a demo/staging server with ALLOW_DEMO_SEED=1.
 */
import { loadEnvConfig } from "@next/env";

export function assertDemoAllowed(what: string) {
  loadEnvConfig(process.cwd());
  const live = process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
  if (live && process.env.ALLOW_DEMO_SEED !== "1") {
    console.error(`Refusing to run ${what}: this looks like a live site (NODE_ENV=production or an https APP_URL).`);
    console.error("Demo data creates accounts with published passwords. For a real school use: npm run setup -- --email … --name … --school …");
    console.error("On a demo/staging server only, set ALLOW_DEMO_SEED=1 to override.");
    process.exit(1);
  }
}

// Run directly (npm run db:reset): node/tsx scripts/demo-guard.ts
if (process.argv[1]?.endsWith("demo-guard.ts")) assertDemoAllowed(process.argv[2] ?? "this command");
