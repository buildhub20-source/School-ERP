import bcrypt from "bcryptjs";

export { PASSWORD_RULES } from "./password-rules";

export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-z]/.test(pw)) return "Password needs a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password needs an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs a symbol.";
  return null;
}

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}
