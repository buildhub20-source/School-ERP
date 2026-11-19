import { describe, expect, it } from "vitest";
import path from "node:path";
import { tamilRuns, hasTamil } from "@/lib/pdf-tamil";
import { uploadPath } from "@/lib/uploads";
import { createPdf, pdfTable } from "@/lib/pdf";
import { db } from "@/lib/db";
import { sendExternal } from "@/lib/messaging/notify";
import { handleWebhook } from "@/server/fees/payments";

describe("Tamil in PDFs", () => {
  it("splits mixed text into Tamil and other runs", () => {
    expect(hasTamil("Fee receipt")).toBe(false);
    expect(hasTamil("கட்டணம்")).toBe(true);
    expect(tamilRuns("Bus fee பேருந்து கட்டணம் Rs. 500")).toEqual([
      { tamil: false, text: "Bus fee " },
      { tamil: true, text: "பேருந்து கட்டணம் " },
      { tamil: false, text: "Rs. 500" },
    ]);
  });

  it("embeds the Tamil font only when Tamil text is printed", async () => {
    const tamil = await createPdf({ title: "கட்டண ரசீது / Fee receipt", letterhead: false });
    tamil.doc.font("Helvetica-Bold").text("மொத்தம்: Rs. 1,000.00", { align: "right" });
    pdfTable(tamil.doc, [{ key: "a", label: "கட்டணம்" }, { key: "b", label: "Amount", align: "right", width: 80 }], [{ a: "கல்விக் கட்டணம் Term 1", b: "1,000.00" }]);
    const withTamil = (await tamil.finish()).toString("latin1");
    expect(withTamil).toMatch(/NotoSansTamil-Regular/);
    expect(withTamil).toMatch(/NotoSansTamil-Bold/);

    const english = await createPdf({ title: "Fee receipt", letterhead: false });
    english.doc.text("Total: Rs. 1,000.00");
    expect((await english.finish()).toString("latin1")).not.toMatch(/NotoSansTamil/);
  });
});

describe("uploads", () => {
  it("only resolves paths inside the uploads folder", () => {
    const root = path.join(process.cwd(), "uploads");
    expect(uploadPath("/uploads/students/a.jpg")).toBe(path.join(root, "students", "a.jpg"));
    expect(uploadPath("/uploads/../.env")).toBeNull();
    expect(uploadPath("/uploads/../uploads-other/x.jpg")).toBeNull();
    expect(uploadPath("/etc/passwd")).toBeNull();
  });

  it("does not serve non-public files through a public/.. path without login", async () => {
    const { GET } = await import("@/app/uploads/[...path]/route");
    const res = await GET(new Request("http://x/uploads/public/..%2F.gitkeep"), { params: Promise.resolve({ path: ["public", "../.gitkeep"] }) });
    expect(res.status).toBe(404);
    const res2 = await GET(new Request("http://x/uploads/public/../.gitkeep"), { params: Promise.resolve({ path: ["public", "..", ".gitkeep"] }) });
    expect(res2.status).toBe(404);
  });
});

describe("message outbox", () => {
  it("stores login OTPs masked", async () => {
    const phone = `97${String(Date.now()).slice(-8)}`;
    try {
      await sendExternal("SMS", phone, { body: "482913 is your OTP to sign in to Demo School.", category: "OTP", template: "OTP", vars: ["482913", "Demo School"] });
      const log = await db.messageLog.findFirstOrThrow({ where: { to: phone } });
      expect(log.body).not.toContain("482913");
      expect(log.body).toContain("is your OTP");
    } finally {
      await db.messageLog.deleteMany({ where: { to: phone } });
    }
  });
});

describe("payment webhook", () => {
  it("ignores events for unknown orders", async () => {
    expect(await handleWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: `order_unknown_${Date.now()}`, amount: 100 } } } })).toBe("unknown order");
  });
});

describe("sign-in rate limit (database)", () => {
  it("counts hits per key across calls and blocks over the limit", async () => {
    const { hitRateLimit } = await import("@/lib/auth/rate-limit-db");
    const key = `test:${Date.now()}`;
    try {
      expect((await hitRateLimit(key, 2, 60000)).ok).toBe(true);
      expect((await hitRateLimit(key, 2, 60000)).ok).toBe(true);
      const third = await hitRateLimit(key, 2, 60000);
      expect(third.ok).toBe(false);
      expect(third.retryAfter).toBeGreaterThan(0);
    } finally {
      await db.rateLimit.deleteMany({ where: { key } });
    }
  });
});

describe("two-step codes", () => {
  it("reports the time-step of a valid code so it can be refused the second time", async () => {
    const { generateTotpSecret, totpNow, verifyTotpStep } = await import("@/lib/auth/totp");
    const secret = generateTotpSecret();
    const step = verifyTotpStep(secret, totpNow(secret));
    expect(step).toBe(Math.floor(Date.now() / 30000));
    expect(verifyTotpStep(secret, "000000") === null || verifyTotpStep(secret, "000000") !== step).toBe(true);
  });
});

describe("outbox and retries", () => {
  it("records the recipient's branch and retries failed messages (never OTPs)", async () => {
    const { retryFailedMessages } = await import("@/server/system/message-retry");
    const user = await db.user.findFirstOrThrow({ where: { phone: { not: null } } });
    const phone = `98${String(Date.now()).slice(-8)}`;
    try {
      await sendExternal("SMS", phone, { body: "Fee due", category: "FEES", userId: user.id, template: "FEE_REMINDER", vars: ["Fee due", "Pay now", ""] });
      const log = await db.messageLog.findFirstOrThrow({ where: { to: phone } });
      expect(log.branchId).toBe(user.branchId);
      expect(log.template).toBe("FEE_REMINDER");
      // Pretend the provider failed, plus a failed OTP that must not be retried.
      await db.messageLog.update({ where: { id: log.id }, data: { status: "FAILED", error: "timeout" } });
      const otp = await db.messageLog.create({ data: { channel: "SMS", to: phone, body: "•••••• is your OTP", category: "OTP", status: "FAILED" } });
      const summary = await retryFailedMessages({});
      expect(summary).toMatch(/Retried/);
      const after = await db.messageLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(after.attempts).toBe(2);
      expect(after.status).toBe("SANDBOX"); // no SMS keys here: the retry reaches the provider layer again
      expect((await db.messageLog.findUniqueOrThrow({ where: { id: otp.id } })).attempts).toBe(1);
    } finally {
      await db.messageLog.deleteMany({ where: { to: phone } });
    }
  });
});

describe("backups", () => {
  it("backs up the database and uploads, encrypts them and copies them off-site", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const { createBackup, decryptBackup } = await import("@/server/system/backup");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-backup-"));
    const offsite = fs.mkdtempSync(path.join(os.tmpdir(), "sms-offsite-"));
    const saved = { BACKUP_DIR: process.env.BACKUP_DIR, BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY, BACKUP_COPY_COMMAND: process.env.BACKUP_COPY_COMMAND };
    Object.assign(process.env, { BACKUP_DIR: dir, BACKUP_ENCRYPTION_KEY: "test passphrase", BACKUP_COPY_COMMAND: `cp {file} ${offsite}/` });
    try {
      const r = await createBackup();
      expect(r.files.map((f) => f.replace(/\d{8}-\d{4}/, "X"))).toEqual(["backup-X.json.gz.enc", "uploads-X.tar.gz.enc"]);
      expect(r.offsite).toBe(true);
      expect(fs.readdirSync(offsite).sort()).toEqual([...r.files].sort());
      const dump = decryptBackup(path.join(dir, r.files[0]), "test passphrase");
      const zlib = await import("node:zlib");
      expect(JSON.parse(zlib.gunzipSync(dump).toString("utf8")).tables.Student.length).toBeGreaterThan(0);
      const tarGz = decryptBackup(path.join(dir, r.files[1]), "test passphrase");
      // piped in: GNU tar on Windows reads "C:\…" in -f as a remote host
      expect(execSync("tar -tz", { input: tarGz }).toString()).toContain("uploads/");
      expect(() => decryptBackup(path.join(dir, r.files[0]), "wrong passphrase")).toThrow();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      await db.backup.deleteMany({ where: { fileName: { in: fs.readdirSync(dir) } } });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(offsite, { recursive: true, force: true });
    }
  });
});

describe("all-branches report", () => {
  it("is only available to the Super Admin", async () => {
    const { getReport, canSeeReport } = await import("@/lib/reports/registry");
    const def = getReport("branches-summary")!;
    const base = { id: "x", name: "x", email: null, phone: null, roleName: "x", permissions: ["reports.fees"], branchId: "b", homeBranchId: "b", language: "en", mustChangePassword: false, twoFactorEnabled: false, sessionId: "s", idleMinutes: 30 };
    expect(canSeeReport({ ...base, roleKey: "SUPER_ADMIN" }, def)).toBe(true);
    expect(canSeeReport({ ...base, roleKey: "SCHOOL_ADMIN" }, def)).toBe(false);
    expect(canSeeReport({ ...base, roleKey: "ACCOUNTANT" }, def)).toBe(false);
  });
});

describe("demo login code", () => {
  it("works only on a local demo without an SMS provider", async () => {
    const { demoOtp } = await import("@/lib/auth/otp");
    const saved = { DEMO_OTP: process.env.DEMO_OTP, APP_URL: process.env.APP_URL, MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY };
    try {
      Object.assign(process.env, { DEMO_OTP: "123456", APP_URL: "http://localhost:3000", MSG91_AUTH_KEY: "" });
      expect(demoOtp()).toBe("123456");
      process.env.APP_URL = "https://school.example.in";
      expect(demoOtp()).toBeNull();
      Object.assign(process.env, { APP_URL: "http://localhost:3000", MSG91_AUTH_KEY: "key" });
      expect(demoOtp()).toBeNull();
      Object.assign(process.env, { MSG91_AUTH_KEY: "", DEMO_OTP: "12ab" });
      expect(demoOtp()).toBeNull();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
