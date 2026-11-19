import "server-only";
import fs from "node:fs";
import { db } from "@/lib/db";
import { createPdf, pdfDate, qrPng } from "@/lib/pdf";
import { getSetting } from "@/lib/settings";
import { uploadPath } from "@/lib/uploads";
import { absoluteUrl } from "@/lib/messaging/notify";
import { fullName } from "@/lib/format";
import { AppError } from "@/lib/errors";

export type IdCardSelection = { studentIds?: string[]; sectionId?: string; classId?: string };

const W = 243; // CR80 card: 85.6 × 54 mm
const H = 153;
const GAP = 12;

function photo(url: string | null): string | null {
  if (!url) return null;
  const p = uploadPath(url);
  if (!p || !/\.(jpe?g|png)$/i.test(p) || !fs.existsSync(p)) return null; // pdfkit embeds JPEG/PNG only
  return p;
}

/** ID card sheet (A4, 2 cards per row) with photo, class, blood group, bus route and a verification QR code. Records an IdCardIssue per student. */
export async function buildIdCards(branchId: string, sel: IdCardSelection, userId?: string) {
  const where = sel.studentIds?.length ? { id: { in: sel.studentIds } } : sel.sectionId ? { sectionId: sel.sectionId } : sel.classId ? { classId: sel.classId } : null;
  if (!where) throw new AppError("Choose students, a section or a class.");
  const students = await db.student.findMany({
    where: { ...where, branchId, status: "ACTIVE" },
    include: { schoolClass: true, section: true, allocations: { where: { status: "ACTIVE" }, include: { route: true, bus: true, stop: true }, orderBy: { startDate: "desc" }, take: 1 } },
    orderBy: [{ schoolClass: { grade: "asc" } }, { section: { name: "asc" } }, { firstName: "asc" }],
  });
  if (!students.length) throw new AppError("No active students found for this selection.");
  const [school, year] = await Promise.all([getSetting("school", branchId), db.academicYear.findFirst({ where: { isCurrent: true } })]);
  const { doc, finish } = await createPdf({ title: "Student ID cards", subtitle: `${students.length} card${students.length === 1 ? "" : "s"} · ${year?.name ?? ""} · cut along the borders`, branchId, letterhead: false });

  const left = doc.page.margins.left + (doc.page.width - doc.page.margins.left - doc.page.margins.right - (2 * W + GAP)) / 2;
  let y = doc.y + 4;
  let col = 0;
  for (const s of students) {
    if (y + H > doc.page.height - 50) { doc.addPage(); y = doc.page.margins.top; col = 0; }
    const x = left + col * (W + GAP);
    // Card frame + header band
    doc.save();
    doc.roundedRect(x, y, W, H, 8).lineWidth(0.8).strokeColor("#94a3b8").stroke();
    doc.roundedRect(x, y, W, 30, 8).fill("#3730a3");
    doc.rect(x, y + 20, W, 10).fill("#3730a3");
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(school.name, x + 8, y + 6, { width: W - 16, align: "center", lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(6).fillColor("#e0e7ff").text(school.address || "STUDENT IDENTITY CARD", x + 8, y + 18, { width: W - 16, align: "center", lineBreak: false, ellipsis: true });

    // Photo
    const px = x + 8, py = y + 38, pw = 56, ph = 68;
    const p = photo(s.photoUrl);
    let drawn = false;
    if (p) { try { doc.image(p, px, py, { fit: [pw, ph], align: "center", valign: "center" }); drawn = true; } catch { drawn = false; } }
    if (!drawn) {
      doc.rect(px, py, pw, ph).fill("#e2e8f0");
      doc.font("Helvetica-Bold").fontSize(22).fillColor("#64748b").text(s.firstName.charAt(0).toUpperCase(), px, py + 22, { width: pw, align: "center" });
    }
    doc.rect(px, py, pw, ph).lineWidth(0.5).strokeColor("#cbd5e1").stroke();

    // Details
    const tx = px + pw + 8, tw = W - (tx - x) - 70;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text(fullName(s), tx, py, { width: tw, lineBreak: false, ellipsis: true });
    const alloc = s.allocations[0];
    const rows: [string, string][] = [
      ["Class", s.section ? `${s.schoolClass.name} - ${s.section.name}` : s.schoolClass.name],
      ["Adm. no", s.admissionNo],
      ["Blood", s.bloodGroup ?? "-"],
      ["DOB", s.dob ? pdfDate(s.dob) : "-"],
      ["Bus", alloc ? `${alloc.route.name}${alloc.bus ? ` (${alloc.bus.busNo})` : ""}` : "Own transport"],
    ];
    let ry = py + 14;
    for (const [k, v] of rows) {
      doc.font("Helvetica").fontSize(6.5).fillColor("#64748b").text(k, tx, ry, { width: 30, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0f172a").text(v, tx + 30, ry, { width: tw - 30, lineBreak: false, ellipsis: true });
      ry += 10.5;
    }
    // QR code
    const qr = await qrPng(absoluteUrl(`/verify/student/${s.id}`), 160);
    doc.image(qr, x + W - 66, py, { width: 58, height: 58 });
    doc.font("Helvetica").fontSize(5).fillColor("#64748b").text("Scan to verify", x + W - 66, py + 60, { width: 58, align: "center" });

    // Footer
    doc.moveTo(x, y + H - 22).lineTo(x + W, y + H - 22).lineWidth(0.4).strokeColor("#e2e8f0").stroke();
    const valid = year ? `Valid till ${pdfDate(year.endDate)}` : "";
    const phone = school.phone ? `School: ${school.phone}` : "";
    doc.font("Helvetica").fontSize(6).fillColor("#475569").text([valid, phone].filter(Boolean).join("   ·   "), x + 8, y + H - 15, { width: W - 16, align: "center", lineBreak: false });

    col = (col + 1) % 2;
    if (col === 0) y += H + GAP;
  }
  const buf = await finish();
  await db.idCardIssue.createMany({ data: students.map((s) => ({ studentId: s.id, printedById: userId })) });
  return { buf, count: students.length };
}
