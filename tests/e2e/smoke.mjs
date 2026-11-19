// Browser smoke test with the local Chrome (playwright-core). Run: node tests/e2e/smoke.mjs [baseUrl]
// Signs in through the real login form, exercises forms and checks pages for errors at desktop and phone widths.
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? "/tmp/sms-e2e";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info = "") => { results.push({ name, pass, info }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${info ? " — " + info : ""}`); };

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

async function session(login, password, viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text()); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="login"]', login);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 });
  return { ctx, page, errors };
}

async function visit(s, path, label, shot) {
  s.errors.length = 0;
  const res = await s.page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 180000 }).catch((e) => ({ status: () => String(e) }));
  const status = res?.status?.();
  const body = await s.page.content();
  const broken = /Application error|Unhandled Runtime Error|Something went wrong loading this page|This page could not be found/.test(body);
  const scroll = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${label} ${path}`, status === 200 && !broken && s.errors.length === 0, `${status}${broken ? " page error" : ""}${s.errors.length ? " js: " + s.errors[0].slice(0, 160) : ""}${scroll > 4 ? ` (horizontal overflow ${scroll}px)` : ""}`);
  if (shot) await s.page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });
}

const pages = JSON.parse(process.env.E2E_PAGES ?? "null") ?? [
  "/dashboard", "/students", "/students/new", "/students/import", "/students/promotion", "/approvals", "/reports", "/analytics", "/circulars", "/outbox", "/audit",
  "/settings", "/settings/academic", "/settings/users", "/settings/roles", "/settings/automations", "/settings/policies", "/settings/integrations", "/settings/branches", "/settings/backups", "/account", "/notifications",
];

// Super admin — desktop
const admin = await session("superadmin@school.test", "Admin@12345");
for (const p of pages) await visit(admin, p, "admin", p === "/dashboard" ? "dashboard-desktop" : null);

// Create a student through the real form
await admin.page.goto(`${BASE}/students/new`);
await admin.page.fill('input[name="firstName"]', "E2E");
await admin.page.fill('input[name="lastName"]', "Tester" + Date.now().toString().slice(-4));
await admin.page.selectOption('select[name="gender"]', "FEMALE");
const classVal = await admin.page.$eval('select[name="classId"] option:nth-child(8)', (o) => o.value);
await admin.page.selectOption('select[name="classId"]', classVal);
await admin.page.getByLabel("Guardian 1 name").fill("E2E Parent");
await admin.page.getByLabel("Guardian 1 mobile").fill(`97${String(Date.now()).slice(-8)}`);
await admin.page.click('button[type="submit"]:has-text("Add student")');
await admin.page.waitForURL(/\/students\/c[a-z0-9]+$/, { timeout: 180000 }).then(() => ok("create student via form", true, admin.page.url())).catch(async () => ok("create student via form", false, (await admin.page.textContent("body")).slice(0, 200)));
await admin.page.screenshot({ path: `${OUT}/student-profile.png` });

// Save policies form
await admin.page.goto(`${BASE}/settings/policies`);
await admin.page.click('button[type="submit"]');
await admin.page.waitForSelector("text=Policies saved", { timeout: 20000 }).then(() => ok("save policies", true)).catch(() => ok("save policies", false));

// Phone width
const phone = await session("admin@school.test", "Staff@12345", { width: 375, height: 800 });
for (const p of ["/dashboard", "/students", "/approvals", "/reports"]) await visit(phone, p, "phone admin", p === "/dashboard" ? "dashboard-phone" : null);

// Teacher cannot open settings
const teacher = await session("anitha@school.test", "Staff@12345");
await teacher.page.goto(`${BASE}/settings`);
ok("teacher blocked from settings", teacher.page.url().includes("/forbidden"), teacher.page.url());

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
