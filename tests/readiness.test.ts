import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { notifyUsers } from "@/lib/messaging/notify";
import { smsTemplateId } from "@/lib/messaging/providers";
import { saveUpload } from "@/lib/uploads";
import { rateLimit } from "@/lib/rate-limit";
import { dataRetention } from "@/server/system/retention";
import { uniq } from "./helpers";

describe("messages in the parent's language", () => {
  it("sends the Tamil version to a Tamil-preferring user and English otherwise", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "PARENT" } });
    const branch = await db.branch.findUniqueOrThrow({ where: { code: "MAIN" } });
    const phone = `96${String(Date.now()).slice(-8)}`;
    const ta = await db.user.create({ data: { name: uniq("TA"), phone, roleId: role.id, branchId: branch.id, language: "ta", preferredChannel: "SMS" } });
    const en = await db.user.create({ data: { name: uniq("EN"), phone: `95${String(Date.now()).slice(-8)}`, roleId: role.id, branchId: branch.id, language: "en", preferredChannel: "SMS" } });
    try {
      await notifyUsers([ta.id, en.id], { title: "Fee due", body: "Pay now", ta: { title: "கட்டணம்", body: "இப்போது செலுத்துங்கள்" }, template: "FEE_REMINDER", category: "TEST" });
      const nTa = await db.notification.findFirstOrThrow({ where: { userId: ta.id } });
      const nEn = await db.notification.findFirstOrThrow({ where: { userId: en.id } });
      expect(nTa.title).toBe("கட்டணம்");
      expect(nEn.title).toBe("Fee due");
      const sms = await db.messageLog.findFirstOrThrow({ where: { userId: ta.id, channel: "SMS" } });
      expect(sms.body).toContain("இப்போது செலுத்துங்கள்");
    } finally {
      await db.messageLog.deleteMany({ where: { userId: { in: [ta.id, en.id] } } });
      await db.user.deleteMany({ where: { id: { in: [ta.id, en.id] } } });
    }
  });

  it("picks the DLT template per message type, language and fallback", () => {
    process.env.MSG91_TEMPLATES = JSON.stringify({ OTP: "t-otp", FEE_REMINDER_TA: "t-fee-ta", GENERAL: "t-gen" });
    expect(smsTemplateId("OTP")).toBe("t-otp");
    expect(smsTemplateId("FEE_REMINDER", "ta")).toBe("t-fee-ta");
    expect(smsTemplateId("BUS_BOARDING")).toBe("t-gen");
    delete process.env.MSG91_TEMPLATES;
  });
});

describe("uploads are checked by content", () => {
  it("rejects a script renamed as an image and accepts a real PNG", async () => {
    const fake = new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    await expect(saveUpload(fake, "test")).rejects.toThrow(/does not match/);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
    const url = await saveUpload(new File([png], "ok.png", { type: "image/png" }), "test");
    expect(url).toMatch(/^\/uploads\/test\/.+\.png$/);
    (await import("node:fs")).rmSync((await import("node:path")).join(process.cwd(), "uploads", "test"), { recursive: true, force: true });
  });
});

describe("sign-in rate limit", () => {
  it("blocks after the limit within the window", () => {
    const key = uniq("ip");
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60000).ok).toBe(true);
    expect(rateLimit(key, 3, 60000).ok).toBe(false);
  });
});

describe("data retention", () => {
  it("removes old GPS points but keeps recent ones and never touches business records", async () => {
    const bus = await db.bus.findFirstOrThrow();
    const old = await db.busLocation.create({ data: { busId: bus.id, lat: 13, lng: 80, recordedAt: new Date(Date.now() - 200 * 86400000) } });
    const fresh = await db.busLocation.create({ data: { busId: bus.id, lat: 13, lng: 80 } });
    const payments = await db.payment.count();
    const summary = await dataRetention({ gpsDays: 90, messagesDays: 0, notificationsDays: 0, auditDays: 0 });
    expect(summary).toMatch(/GPS points/);
    expect(await db.busLocation.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.busLocation.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.payment.count()).toBe(payments);
    await db.busLocation.delete({ where: { id: fresh.id } });
  });
});

describe("fee approvals need a second person", () => {
  it("refuses approving your own concession request", async () => {
    const { requestConcession, decideConcession } = await import("@/server/fees/service");
    const u = await db.user.findUniqueOrThrow({ where: { email: "admin@school.test" }, include: { role: true } });
    const user = { id: u.id, name: u.name, email: u.email, phone: u.phone, roleKey: u.role.key, roleName: u.role.name, permissions: u.role.permissions, branchId: u.branchId, homeBranchId: u.branchId, language: "en", mustChangePassword: false, twoFactorEnabled: false, sessionId: "t", idleMinutes: 30 };
    const student = await db.student.findFirstOrThrow({ where: { branchId: u.branchId, status: "ACTIVE" } });
    const c = await requestConcession(user, u.branchId, { studentId: student.id, type: "MERIT", mode: "PERCENT", value: 5, reason: "readiness test" });
    try {
      await expect(decideConcession(user, u.branchId, { id: c.id, approve: true })).rejects.toThrow(/cannot approve/);
    } finally {
      await db.concession.delete({ where: { id: c.id } });
    }
  });
});
