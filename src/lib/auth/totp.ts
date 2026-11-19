import crypto from "node:crypto";

// RFC 6238 TOTP (30s, 6 digits, SHA-1) — compatible with Google Authenticator, Microsoft Authenticator, Authy.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpNow(secret: string, at = Date.now()): string {
  return hotp(base32Decode(secret), Math.floor(at / 30000));
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  return verifyTotpStep(secret, token, window) !== null;
}

/** The 30-second time-step the code belongs to, or null if it is wrong. Used to refuse a code that was already used. */
export function verifyTotpStep(secret: string, token: string, window = 1): number | null {
  const t = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return null;
  const counter = Math.floor(Date.now() / 30000);
  const key = base32Decode(secret);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(key, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return counter + i;
  }
  return null;
}

export function totpUri(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
