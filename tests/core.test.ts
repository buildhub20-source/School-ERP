import { describe, expect, it } from "vitest";
import { feeBalance, feeStatusFor, splitInstalments } from "@/server/fees/core";
import { checkPasswordStrength } from "@/lib/auth/password";
import { totpNow, verifyTotp, generateTotpSecret } from "@/lib/auth/totp";

describe("fee maths", () => {
  it("balance = amount − concession + late fee + adjustment − paid", () => {
    expect(feeBalance({ amount: 10000, concessionAmount: 1000, lateFeeAmount: 100, adjustmentAmount: -500, paidAmount: 3000 })).toBe(5600);
  });
  it("status follows balance", () => {
    expect(feeStatusFor({ amount: 100, concessionAmount: 0, lateFeeAmount: 0, adjustmentAmount: 0, paidAmount: 0 })).toBe("PENDING");
    expect(feeStatusFor({ amount: 100, concessionAmount: 0, lateFeeAmount: 0, adjustmentAmount: 0, paidAmount: 40 })).toBe("PARTIAL");
    expect(feeStatusFor({ amount: 100, concessionAmount: 0, lateFeeAmount: 0, adjustmentAmount: 0, paidAmount: 100 })).toBe("PAID");
    expect(feeStatusFor({ amount: 100, concessionAmount: 100, lateFeeAmount: 0, adjustmentAmount: 0, paidAmount: 0 })).toBe("WAIVED");
  });
  it("instalments add up exactly", () => {
    const parts = splitInstalments(10000, 3, new Date("2026-06-10"));
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(10000, 2);
    expect(parts).toHaveLength(3);
  });
});

describe("security", () => {
  it("rejects weak passwords", () => {
    expect(checkPasswordStrength("short")).not.toBeNull();
    expect(checkPasswordStrength("alllowercase1!")).not.toBeNull();
    expect(checkPasswordStrength("Str0ng!Passw0rd")).toBeNull();
  });
  it("TOTP round-trips", () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, totpNow(s))).toBe(true);
    expect(verifyTotp(s, "000000")).toBe(totpNow(s) === "000000");
  });
});
