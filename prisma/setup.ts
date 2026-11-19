/**
 * Clean production setup (no demo data): roles, main branch, automation defaults and the first Super Admin.
 * Usage: npm run setup -- --email you@school.in --name "Your Name" --school "School name"
 * The password is asked for (hidden) so it does not end up in the shell history. For scripted installs set
 * SETUP_PASSWORD in the environment instead. (--password still works but is visible in history and process lists.)
 */
import readline from "node:readline";
import { db } from "@/lib/db";
import { DEFAULT_ROLES, ROLE_KEYS } from "@/lib/permissions";
import { syncRoles } from "@/lib/role-sync";
import { hashPassword, checkPasswordStrength } from "@/lib/auth/password";
import { saveSetting } from "@/lib/settings";
import { AUTOMATIONS } from "@/lib/automations/catalog";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** Read a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => { if (!prompted) { out.output.write(s); prompted = true; } };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function readPassword(): Promise<string | undefined> {
  const fromArg = arg("password");
  if (fromArg) { console.warn("Note: --password is visible in your shell history. Next time leave it out and type it when asked."); return fromArg; }
  if (process.env.SETUP_PASSWORD) return process.env.SETUP_PASSWORD;
  if (!process.stdin.isTTY) return undefined;
  const p1 = await askHidden("Password for the Super Admin: ");
  const p2 = await askHidden("Type it again: ");
  if (p1 !== p2) throw new Error("The two passwords do not match.");
  return p1;
}

async function main() {
  const email = arg("email")?.toLowerCase(), name = arg("name") ?? "Super Admin", school = arg("school");
  if (!email) throw new Error("Pass --email (and --name, --school)");
  const password = await readPassword();
  if (!password) throw new Error("No password given: run it in a terminal to be asked, or set SETUP_PASSWORD.");
  const weak = checkPasswordStrength(password);
  if (weak) throw new Error(weak);
  for (const key of ROLE_KEYS) {
    const r = DEFAULT_ROLES[key];
    await db.role.upsert({ where: { key }, create: { key, name: r.name, description: r.description, permissions: r.permissions }, update: {} });
  }
  await syncRoles(); // existing roles: grant permissions from newly added modules
  const branch = await db.branch.upsert({ where: { code: "MAIN" }, create: { code: "MAIN", name: "Main Campus" }, update: {} });
  if (school) await saveSetting("school", { name: school });
  await saveSetting("policies", {});
  for (const a of AUTOMATIONS) await db.automationSetting.upsert({ where: { key: a.key }, create: { key: a.key, enabled: true, config: a.defaultConfig as object }, update: {} });
  const role = await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await db.user.upsert({ where: { email }, create: { email, name, branchId: branch.id, roleId: role.id, passwordHash: await hashPassword(password), preferredChannel: "EMAIL" }, update: { passwordHash: await hashPassword(password), roleId: role.id, isActive: true } });
  console.log(`Ready. Sign in as ${email}, then set up Settings → School profile, Years & classes, and Users.`);
}
main().then(() => db.$disconnect()).catch(async (e) => { console.error(e.message ?? e); await db.$disconnect(); process.exit(1); });
