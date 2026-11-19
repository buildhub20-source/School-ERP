import { db } from "@/lib/db";
import { pdfResponse } from "@/lib/excel";
import { isoDate } from "@/lib/format";
import { statementPdf } from "@/server/fees/receipts";
import { feeDocAccess } from "../../_access";

/** Fee statement PDF. Transport-only staff get transport lines only. */
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const access = await feeDocAccess(studentId);
  if (!access.ok) return new Response(access.status === 401 ? "Unauthorized" : access.status === 404 ? "Not found" : "Forbidden", { status: access.status });
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { admissionNo: true } });
  const buf = await statementPdf(studentId, access.scope);
  return pdfResponse(buf, `fee-statement-${s.admissionNo}-${isoDate()}.pdf`);
}
