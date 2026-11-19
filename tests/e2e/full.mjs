import crypto from "node:crypto";
// Full browser end-to-end pass with the local Chrome (playwright-core).
// Run: npx tsx tests/e2e/full.mjs [baseUrl]   (server must be running, e.g. npm run poc → http://localhost:3100)
// Expected figures are read (read-only) from the server's JSON data file .poc/data.json through the same JSON data engine.
import { chromium } from "playwright-core";
import { createJsonClient } from "../../src/lib/json-db/client.ts";
import fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? (process.platform === "win32" ? `${process.env.TEMP}\sms-e2e` : "/tmp/sms-e2e");
fs.mkdirSync(OUT, { recursive: true });
const db = createJsonClient();
const results = [];
const check = (name, pass, info = "") => { results.push({ name, pass, info }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${info && !pass ? " — " + info : ""}`); };

// Staff page list from the navigation config
const navSrc = fs.readFileSync("src/components/layout/nav.ts", "utf8");
const navPaths = [...new Set([...navSrc.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]))].filter((p) => !p.startsWith("/teacher") && p !== "/my-hr");

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
].find((p) => fs.existsSync(p)), headless: true });

async function newSession(viewport = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|tile\.openstreetmap/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  return { ctx, page, errors };
}

async function staffLogin(login, password, viewport) {
  const s = await newSession(viewport);
  await s.page.goto(`${BASE}/login`, { timeout: 180000 });
  await s.page.fill('input[name="login"]', login);
  await s.page.fill('input[name="password"]', password);
  await Promise.all([s.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), s.page.click('button[type="submit"]')]);
  return s;
}

async function otpLogin(phone) {
  const s = await newSession({ width: 390, height: 844 });
  await s.page.goto(`${BASE}/login`, { timeout: 180000 });
  await s.page.click("text=Parent / driver login");
  await s.page.fill('input[name="phone"]', phone);
  await s.page.click('button[type="submit"]');
  // The POC accepts the fixed demo code (DEMO_OTP, 123456): the data lives in the server's memory, so the test cannot insert its own OTP row.
  await s.page.waitForSelector('input[name="code"]', { timeout: 60000 });
  await s.page.fill('input[name="code"]', process.env.DEMO_OTP ?? "123456");
  await Promise.all([s.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), s.page.click('button[type="submit"]')]);
  return s;
}

async function visit(s, path, label, opts = {}) {
  s.errors.length = 0;
  let status;
  try {
    const res = await s.page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 180000 });
    status = res?.status();
  } catch (e) { status = String(e).slice(0, 80); }
  const finalPath = new URL(s.page.url()).pathname;
  await s.page.waitForLoadState("networkidle").catch(() => {});
  const body = await s.page.evaluate(() => document.body.innerText).catch(async () => { await s.page.waitForTimeout(1500); return s.page.evaluate(() => document.body.innerText).catch(() => ""); });
  const broken = /Application error|Unhandled Runtime Error|Something went wrong loading this page|^404$|Page not found/m.test(body);
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
  // On overflow, name the widest element sticking out (not inside a scroll container) so the failure says what to fix.
  const culprit = opts.phone && overflow > 4 ? await s.page.evaluate(() => {
    const W = window.innerWidth; let worst = null, right = 0;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect(); if (r.right <= W + 1 || r.right <= right) continue;
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { if (/(auto|hidden|scroll|clip)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= W + 1) { clipped = true; break; } p = p.parentElement; }
      if (!clipped) { worst = el; right = r.right; }
    }
    return worst ? `${worst.tagName.toLowerCase()}.${String(worst.className).slice(0, 80)} "${(worst.textContent || "").trim().slice(0, 40)}"` : "";
  }).catch(() => "") : "";
  if (opts.expectForbidden) {
    check(`${label} blocked from ${path}`, finalPath === "/forbidden" || finalPath === "/login" || finalPath.startsWith("/parent") || finalPath.startsWith("/driver") || status === 403 || status === 404, `ended at ${finalPath} (${status})`);
    return;
  }
  const pass = status === 200 && !broken && s.errors.length === 0 && finalPath !== "/forbidden" && !(opts.phone && overflow > 4);
  check(`${label} ${path}`, pass, `${status} → ${finalPath}${broken ? " [page error]" : ""}${s.errors.length ? " js: " + s.errors[0] : ""}${opts.phone && overflow > 4 ? ` [horizontal overflow ${overflow}px: ${culprit}]` : ""}`);
  if (opts.shot) await s.page.screenshot({ path: `${OUT}/${opts.shot}.png` });
}

async function navLabels(s) {
  await s.page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
  return s.page.$$eval('aside nav[aria-label="Main"] a', (els) => els.map((e) => e.textContent.trim()));
}

// ── 1. Super Admin: every page in the menu + detail pages ──
const branch = await db.branch.findUniqueOrThrow({ where: { code: "MAIN" } });
const ids = {
  student: (await db.student.findFirst({ where: { branchId: branch.id, status: "ACTIVE", allocations: { some: { status: "ACTIVE" } } } }))?.id,
  item: (await db.stationeryItem.findFirst({ where: { branchId: branch.id } }))?.id,
  request: (await db.stationeryRequest.findFirst({ where: { branchId: branch.id } }))?.id,
  po: (await db.purchaseOrder.findFirst({ where: { branchId: branch.id, type: "STATIONERY" } }))?.id,
  supplier: (await db.supplier.findFirst({ where: { branchId: branch.id } }))?.id,
  audit: (await db.stockAudit.findFirst({ where: { branchId: branch.id } }))?.id,
  uItem: (await db.uniformItem.findFirst({ where: { branchId: branch.id } }))?.id,
  order: (await db.uniformOrder.findFirst({ where: { branchId: branch.id } }))?.id,
  uPo: (await db.purchaseOrder.findFirst({ where: { branchId: branch.id, type: "UNIFORM" } }))?.id,
  payment: (await db.payment.findFirst({ where: { branchId: branch.id, status: "SUCCESS", purpose: "FEE" } })),
  bus: (await db.bus.findFirst({ where: { branchId: branch.id } }))?.id,
  route: (await db.route.findFirst({ where: { branchId: branch.id } }))?.id,
  staff: (await db.staffProfile.findFirst({ where: { branchId: branch.id, isActive: true } }))?.id,
};
const details = [
  `/students/${ids.student}`, `/students/${ids.student}/edit`, `/stationery/items/${ids.item}`, `/stationery/requests/${ids.request}`, `/stationery/purchases/${ids.po}`,
  `/stationery/suppliers/${ids.supplier}`, `/stationery/audits/${ids.audit}`, `/uniforms/items/${ids.uItem}`, `/uniforms/orders/${ids.order}`, `/uniforms/purchases/${ids.uPo}`,
  `/fees/accounts/${ids.student}`, `/fees/payments/${ids.payment?.id}`, `/fees/import`, `/uniforms/import`, `/stationery/import`, `/transport/buses/${ids.bus}`, `/transport/routes/${ids.route}`,
  `/hr/staff/${ids.staff}`, "/reports/hr-attendance", "/reports/hr-leave",
  "/reports/students-strength", "/analytics", "/account",
];
const admin = await staffLogin("superadmin@school.test", "Admin@12345");
check("Super Admin signs in and lands on the dashboard", new URL(admin.page.url()).pathname === "/dashboard", admin.page.url());
for (const p of [...navPaths, ...details].filter((p) => !p.includes("undefined"))) await visit(admin, p, "super admin", { shot: p === "/dashboard" ? "dashboard" : undefined });

// Downloads
for (const [p, type] of [[`/api/fees/receipts/${ids.payment?.id}`, "application/pdf"], [`/api/fees/statement/${ids.student}`, "application/pdf"], [`/api/uniforms/id-cards?studentIds=${ids.student}`, "application/pdf"], ["/api/reports/students-strength?format=xlsx", "spreadsheet"], ["/api/stationery/movements", "spreadsheet"]]) {
  const r = await admin.page.request.get(`${BASE}${p}`, { timeout: 180000 });
  check(`download ${p.split("?")[0]}`, r.status() === 200 && (r.headers()["content-type"] ?? "").includes(type), `${r.status()} ${r.headers()["content-type"]}`);
}
// Public receipt verification
const v = await (await browser.newContext()).newPage();
await v.goto(`${BASE}/verify/receipt/${ids.payment?.verifyToken}`, { timeout: 180000 });
check("public receipt QR verification page", (await v.content()).includes(ids.payment?.receiptNo ?? "@@"), v.url());

// ── 2. Dashboard numbers shown on screen = database ──
await admin.page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 180000 });
const tile = async (label) => (await admin.page.locator(`a:has(p:text-is("${label}")) [data-stat-value]`).first().textContent()).trim();
const activeStudents = await db.student.count({ where: { branchId: branch.id, status: "ACTIVE" } });
check("dashboard: active students = DB", (await tile("Active students")).replace(/,/g, "") === String(activeStudents), `${await tile("Active students")} vs ${activeStudents}`);
const seats = await db.bus.aggregate({ where: { branchId: branch.id, isActive: true }, _sum: { capacity: true } });
const filled = await db.transportAllocation.count({ where: { status: "ACTIVE", bus: { branchId: branch.id, isActive: true } } });
check("dashboard: bus seats = DB", (await tile("Bus seats filled")) === `${filled} / ${seats._sum.capacity}`, `${await tile("Bus seats filled")} vs ${filled} / ${seats._sum.capacity}`);
const lowItems = await db.stationeryItem.findMany({ where: { branchId: branch.id, isActive: true }, select: { currentStock: true, reorderLevel: true } });
const low = [{ n: lowItems.filter((i) => i.currentStock <= i.reorderLevel).length }];
check("dashboard: low-stock alerts = DB", (await tile("Low-stock alerts")) === String(low[0].n), `${await tile("Low-stock alerts")} vs ${low[0].n}`);
const open = await db.uniformOrder.count({ where: { branchId: branch.id, status: { in: ["ORDERED", "PAID", "READY"] } } });
check("dashboard: open uniform orders = DB", (await tile("Uniform orders open")) === String(open), `${await tile("Uniform orders open")} vs ${open}`);
const pend = await db.studentFee.aggregate({ where: { student: { branchId: branch.id, status: "ACTIVE" }, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } }, _sum: { balance: true } });
const shownPending = Number((await tile("Pending dues")).replace(/[^\d.]/g, ""));
check("dashboard: pending dues = DB", Math.abs(shownPending - Number(pend._sum.balance)) < 1, `${shownPending} vs ${pend._sum.balance}`);

// ── 3. Each staff role sees only its modules, and is blocked elsewhere ──
const roles = [
  { login: "admin@school.test", name: "School Admin", sees: ["Dashboard", "My leave & attendance", "Approvals", "Students", "Attendance", "Stationery", "Uniforms", "Fees", "Transport", "HR", "Library", "Assets", "Hostel", "Reports", "Analytics", "Circulars & events", "Message outbox"], blocked: ["/settings", "/settings/roles", "/settings/users", "/audit"] },
  { login: "accounts@school.test", name: "Accountant", sees: ["Dashboard", "My leave & attendance", "Students", "Fees", "Reports", "Analytics"], blocked: ["/stationery", "/uniforms", "/transport/buses", "/settings", "/approvals", "/hr", "/hr/staff"] },
  { login: "store@school.test", name: "Store Manager", sees: ["Dashboard", "My leave & attendance", "Students", "Stationery", "Uniforms", "Assets", "Reports", "Analytics"], blocked: ["/fees", "/fees/accounts", "/fees/payments", "/transport", "/settings"] },
  { login: "transport@school.test", name: "Transport Manager", sees: ["Dashboard", "My leave & attendance", "Students", "Fees", "Transport", "Reports", "Analytics"], blocked: ["/stationery", "/uniforms", "/fees/collect", "/fees/payments", "/settings"] },
  { login: "anitha@school.test", name: "Teacher", sees: ["My requests", "My class", "Class attendance", "My leave & attendance"], blocked: ["/dashboard", "/attendance", "/students", "/stationery/items", "/fees", "/transport", "/settings", "/hr", "/hr/leave"] },
  { login: "hr@school.test", name: "HR Manager", sees: ["Dashboard", "My leave & attendance", "HR", "Reports"], blocked: ["/students", "/fees", "/settings", "/approvals", "/hostel"] },
];
for (const r of roles) {
  const s = await staffLogin(r.login, "Staff@12345");
  const labels = await navLabels(s);
  const missing = r.sees.filter((x) => !labels.includes(x));
  const extra = labels.filter((x) => !r.sees.includes(x));
  check(`${r.name}: menu shows exactly the permitted modules`, missing.length === 0 && extra.length === 0, `missing [${missing}] extra [${extra}] (got ${labels})`);
  for (const p of r.blocked) await visit(s, p, r.name, { expectForbidden: true });
  await s.ctx.close();
}
// Accountant (fees.view) vs Transport Manager (transport fees only) on a fee account
{
  const tm = await staffLogin("transport@school.test", "Staff@12345");
  await tm.page.goto(`${BASE}/fees/accounts/${ids.student}`, { waitUntil: "networkidle", timeout: 180000 });
  const txt = await tm.page.evaluate(() => document.body.innerText);
  check("Transport Manager sees only transport fee lines", txt.includes("Transport") && !/Tuition Fee/.test(txt), "tuition visible");
  const r = await tm.page.request.get(`${BASE}/api/fees/receipts/${ids.payment?.id}`);
  check("Transport Manager cannot open a tuition receipt", r.status() === 403 || r.status() === 404, String(r.status()));
  await tm.ctx.close();
}

// Teacher workflow through the UI: new stationery request
{
  const t = await staffLogin("anitha@school.test", "Staff@12345");
  await visit(t, "/teacher", "teacher");
  await visit(t, "/teacher/class", "teacher");
  await visit(t, "/my-hr", "teacher", { phone: true });
  const myHr = await t.page.evaluate(() => document.body.innerText);
  check("teacher sees their leave balance and attendance", /Leave balance/.test(myHr) && /Casual leave/.test(myHr) && /My attendance/.test(myHr), myHr.slice(0, 200));
  await t.ctx.close();
}

// ── 4. Parent portal (phone width) ──
const parent = await otpLogin("9840000002");
check("parent signs in with OTP and lands on the parent home", new URL(parent.page.url()).pathname === "/parent", parent.page.url());
for (const p of ["/parent", "/parent/fees", "/parent/uniforms", "/parent/uniforms/new", "/parent/bus", "/parent/circulars", "/parent/settings", "/parent/notifications"]) await visit(parent, p, "parent (phone)", { phone: true, shot: p === "/parent" ? "parent-home" : undefined });
const guardian = await db.guardian.findUniqueOrThrow({ where: { phone: "9840000002" }, include: { students: true } });
const mine = guardian.students.map((s) => s.studentId);
const myKids = await db.student.findMany({ where: { id: { in: mine } } });
const home = await parent.page.goto(`${BASE}/parent`).then(() => parent.page.evaluate(() => document.body.innerText));
check("parent home lists their children", myKids.every((k) => home.includes(k.firstName)), myKids.map((k) => k.firstName).join(","));
const other = await db.student.findFirstOrThrow({ where: { id: { notIn: mine }, status: "ACTIVE", allocations: { some: { status: "ACTIVE" } } } });
for (const p of [`/api/transport/parent/${other.id}`, `/api/fees/statement/${other.id}`, `/api/uniforms/id-cards?studentIds=${other.id}`]) {
  const r = await parent.page.request.get(`${BASE}${p}`);
  check(`parent cannot read another family's data ${p.split("/").slice(0, 4).join("/")}`, [401, 403, 404].includes(r.status()), String(r.status()));
}
for (const p of ["/dashboard", "/students", "/fees/accounts"]) await visit(parent, p, "parent", { expectForbidden: true });

// ── 5. Driver app ──
const driverStaff = await db.transportStaff.findFirstOrThrow({ where: { type: "DRIVER", userId: { not: null } }, include: { user: true } });
const driver = await otpLogin(driverStaff.user.phone);
check("driver signs in with OTP and lands on the driver app", new URL(driver.page.url()).pathname.startsWith("/driver"), driver.page.url());
for (const p of ["/driver", "/driver/attendance", "/driver/emergency", "/driver/settings"]) await visit(driver, p, "driver (phone)", { phone: true, shot: p === "/driver" ? "driver-home" : undefined });
for (const p of ["/dashboard", "/transport/buses", "/parent"]) await visit(driver, p, "driver", { expectForbidden: true });

// ── 6. Phone layout for staff ──
const phoneAdmin = await staffLogin("admin@school.test", "Staff@12345", { width: 375, height: 812 });
for (const p of ["/dashboard", "/students", "/stationery/requests", "/uniforms/stock", "/fees/defaulters", "/transport/allocations"]) await visit(phoneAdmin, p, "school admin (phone)", { phone: true, shot: p === "/dashboard" ? "dashboard-phone" : undefined });

await browser.close();
await db.$disconnect();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
if (failed.length) { console.log("\nFailures:"); for (const f of failed) console.log(` - ${f.name}: ${f.info}`); }
process.exit(failed.length ? 1 : 0);
