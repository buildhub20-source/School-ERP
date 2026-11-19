import { fmtDate, fmtDateTime, money, number } from "../format";
import { pdfDate, pdfMoney } from "../pdf-format";
import type { Column } from "./types";

export function formatCell(col: Column, v: unknown, target: "ui" | "pdf" = "ui"): string {
  if (v === null || v === undefined || v === "") return target === "pdf" ? "" : "—";
  switch (col.format) {
    case "money": return target === "pdf" ? pdfMoney(v) : money(v as number);
    case "number": return number(v as number);
    case "date": return target === "pdf" ? pdfDate(v as Date) : fmtDate(v as Date);
    case "datetime": return fmtDateTime(v as Date);
    default: return String(v);
  }
}
