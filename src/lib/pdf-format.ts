import { toNum } from "./format";
/** PDFs use "Rs." because the built-in PDF fonts have no rupee glyph. */
export function pdfMoney(v: unknown): string {
  const n = toNum(v as number);
  return "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function pdfDate(d: Date | string | null | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
