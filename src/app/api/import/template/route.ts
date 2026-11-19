import { requireUserOrThrow } from "@/lib/auth/session";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { STUDENT_TEMPLATE } from "@/server/students/import";
import { IMPORT_TEMPLATES } from "@/server/import-templates";

/** Download an Excel template for bulk import: ?type=students|stationery|uniforms|fees */
export async function GET(req: Request) {
  try { await requireUserOrThrow(); } catch { return new Response("Unauthorized", { status: 401 }); }
  const type = new URL(req.url).searchParams.get("type") ?? "students";
  const tpl = type === "students" ? { columns: STUDENT_TEMPLATE, sample: [{ firstName: "Arun", lastName: "Kumar", gender: "M", dob: "14/06/2016", class: "Class 5", section: "A", fatherName: "Kumar R", fatherPhone: "9876543210", motherName: "Lakshmi K", motherPhone: "9876501234", admissionDate: "01/06/2026" }] } : IMPORT_TEMPLATES[type];
  if (!tpl) return new Response("Unknown template", { status: 404 });
  const buf = await buildWorkbook([{ name: "Data", columns: tpl.columns.map((c) => ({ key: c.key, header: c.header, width: 18 })), rows: tpl.sample }]);
  return xlsxResponse(buf, `${type}-import-template.xlsx`);
}
