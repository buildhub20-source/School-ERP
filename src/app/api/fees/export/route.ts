import { requireUserOrThrow } from "@/lib/auth/session";
import { xlsxResponse } from "@/lib/excel";
import { exportExcel, exportTallyXml } from "@/server/fees/export";

/** GET ?format=xlsx|tally&from=YYYY-MM-DD&to=YYYY-MM-DD[&company&cashLedger&bankLedger] */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("fees.export"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return new Response("Choose a valid date range.", { status: 400 });
  const opts = { from, to, company: p.get("company") ?? undefined, cashLedger: p.get("cashLedger") ?? undefined, bankLedger: p.get("bankLedger") ?? undefined };
  if (p.get("format") === "tally") {
    const xml = await exportTallyXml(user.branchId, opts);
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="tally-receipts-${from}-to-${to}.xml"` } });
  }
  return xlsxResponse(await exportExcel(user.branchId, opts), `fee-receipts-${from}-to-${to}.xlsx`);
}
