import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { createPdf, qrPng } from "@/lib/pdf";
import { pdfResponse } from "@/lib/excel";

/** Spine/inside-cover labels for library copies (A4, 3 × 8): QR of the accession number, title and shelf. ?bookId= or ?copyIds=a,b */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("library.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const bookId = p.get("bookId");
  const copyIds = p.get("copyIds")?.split(",").filter(Boolean);
  const copies = await db.libraryCopy.findMany({
    where: { branchId: user.branchId, status: { notIn: ["LOST", "WITHDRAWN"] }, ...(bookId ? { bookId } : copyIds?.length ? { id: { in: copyIds } } : { id: "-" }) },
    include: { book: true }, orderBy: { accessionNo: "asc" }, take: 500,
  });
  if (!copies.length) return new Response("No copies to label.", { status: 404 });
  const school = await getSetting("school", user.branchId);

  const { doc, finish } = await createPdf({ title: "Library labels", subtitle: `${copies.length} label(s) · scan or type the accession number at the issue desk`, letterhead: false, branchId: user.branchId });
  const cols = 3, rows = 8;
  const left = doc.page.margins.left;
  const w = (doc.page.width - left - doc.page.margins.right) / cols;
  let top = doc.y;
  let h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows;
  for (const [n, c] of copies.entries()) {
    if (n > 0 && n % (cols * rows) === 0) {
      doc.addPage();
      top = doc.page.margins.top;
      h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows;
    }
    const idx = n % (cols * rows);
    const x = left + (idx % cols) * w;
    const y = top + Math.floor(idx / cols) * h;
    doc.save().lineWidth(0.4).dash(2, { space: 2 }).strokeColor("#cbd5e1").rect(x + 2, y + 2, w - 4, h - 4).stroke().undash().restore();
    const q = Math.min(h - 14, 60);
    doc.image(await qrPng(c.accessionNo, 200), x + 8, y + (h - q) / 2, { width: q, height: q });
    const tx = x + 14 + q, tw = w - q - 22;
    doc.font("Helvetica").fontSize(6.5).fillColor("#64748b").text(school.name, tx, y + 8, { width: tw, lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(c.book.title, tx, y + 18, { width: tw, height: 20, ellipsis: true });
    doc.font("Courier-Bold").fontSize(11).fillColor("#0f172a").text(c.accessionNo, tx, y + h / 2 + 4, { width: tw, lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text([c.book.category, c.book.shelf].filter(Boolean).join(" · "), tx, y + h / 2 + 17, { width: tw, lineBreak: false, ellipsis: true });
  }
  return pdfResponse(await finish(), `library-labels.pdf`);
}
