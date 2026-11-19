import "server-only";
import fs from "node:fs";
import path from "node:path";
import type PDFDocument from "pdfkit";

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Tamil text in PDFs. The built-in PDF fonts (Helvetica) have no Tamil letters, and the Tamil font (Noto Sans Tamil,
 * assets/fonts, SIL Open Font License) has no English letters. So any text containing Tamil is split into runs:
 * Tamil runs use Noto Sans Tamil (shaped by fontkit, so conjuncts and vowel signs join correctly), everything else keeps
 * the font that was selected. Text without Tamil is drawn exactly as before.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSansTamil-Regular.ttf");
const BOLD = path.join(FONT_DIR, "NotoSansTamil-Bold.ttf");

const TAMIL_CHAR = /[஀-௿‌‍]/;
const HAS_TAMIL = /[஀-௿]/;

export const hasTamil = (s: string) => HAS_TAMIL.test(s);

/** Split into alternating Tamil / other runs. Spaces stay with the run they are in. */
export function tamilRuns(s: string): { tamil: boolean; text: string }[] {
  const runs: { tamil: boolean; text: string }[] = [];
  for (const ch of s) {
    const isTamil = TAMIL_CHAR.test(ch) || (ch === " " && runs.length > 0 && runs[runs.length - 1].tamil);
    const last = runs[runs.length - 1];
    if (last && last.tamil === isTamil) last.text += ch;
    else runs.push({ tamil: isTamil, text: ch });
  }
  return runs;
}

let available: boolean | null = null;
function fontsAvailable() {
  if (available === null) available = fs.existsSync(REGULAR) && fs.existsSync(BOLD);
  return available;
}

/** Patch a document's text measuring/drawing so Tamil renders. Safe to call once per document. */
export function enableTamil(doc: Doc) {
  if (!fontsAvailable()) return;
  doc.registerFont("Tamil", REGULAR);
  doc.registerFont("Tamil-Bold", BOLD);

  const d = doc as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origFont = d.font.bind(doc);
  const origText = d.text.bind(doc);
  const origHeight = d.heightOfString.bind(doc);
  const origWidth = d.widthOfString.bind(doc);
  let current = "Helvetica";
  const tamilFor = (base: string) => (/bold/i.test(base) ? "Tamil-Bold" : "Tamil");

  d.font = (name: unknown, ...rest: unknown[]) => {
    if (typeof name === "string") current = name;
    return origFont(name, ...rest);
  };

  // Measuring. pdfkit also calls these itself while laying out a run (word by word), so they must leave the active font
  // exactly as they found it, and measure normally when the active font is already the Tamil one.
  const state = doc as unknown as { _font: { name: string } };
  const tamilActive = () => state._font?.name?.startsWith("NotoSansTamil");
  const measure = <T,>(fn: () => T): T => {
    const saved = state._font;
    try { return fn(); } finally { state._font = saved; }
  };
  // Tamil glyphs are taller than Latin ones, so heights are measured in the Tamil font (a safe overestimate for row heights).
  d.heightOfString = (text: unknown, opts?: unknown) => {
    const s = text == null ? "" : String(text);
    if (!hasTamil(s) || tamilActive()) return origHeight(text, opts);
    return measure(() => { origFont(tamilFor(current)); return origHeight(s, opts); });
  };
  d.widthOfString = (text: unknown, opts?: unknown) => {
    const s = text == null ? "" : String(text);
    if (!hasTamil(s) || tamilActive()) return origWidth(text, opts);
    return measure(() => {
      let w = 0;
      for (const r of tamilRuns(s)) {
        origFont(r.tamil ? tamilFor(current) : current);
        w += origWidth(r.text, opts) as number;
      }
      return w;
    });
  };

  d.text = (text: unknown, x?: unknown, y?: unknown, options?: unknown) => {
    const s = text == null ? "" : String(text);
    if (!hasTamil(s)) return origText(text, x, y, options);
    let opts: Record<string, unknown>;
    if (x !== null && typeof x === "object") { opts = x as Record<string, unknown>; x = undefined; y = undefined; }
    else opts = (options as Record<string, unknown>) ?? {};
    const base = current;
    const runs = tamilRuns(s);
    // pdfkit aligns each continued run separately, so a right/centre-aligned mixed line would overlap. When the line fits,
    // place it ourselves: work out the start x from the total width and draw the runs left-aligned from there.
    const align = opts.align as string | undefined;
    if (runs.length > 1 && (align === "right" || align === "center")) {
      const page = (doc as unknown as { page: { width: number; margins: { right: number } } }).page;
      const startX = typeof x === "number" ? x : doc.x;
      const startY = typeof y === "number" ? y : doc.y;
      const width = typeof opts.width === "number" ? opts.width : page.width - page.margins.right - startX;
      const total = d.widthOfString(s, opts) as number;
      if (total <= width) {
        const offset = align === "right" ? width - total : (width - total) / 2;
        const lineOpts = { ...opts, align: "left", width: total + 1, lineBreak: false };
        runs.forEach((r, i) => {
          origFont(r.tamil ? tamilFor(base) : base);
          const o = { ...lineOpts, continued: i < runs.length - 1 };
          if (i === 0) origText(r.text, startX + offset, startY, o);
          else origText(r.text, o);
        });
        origFont(base);
        doc.x = startX;
        // Leave room for the (taller) Tamil glyphs before whatever comes next.
        doc.y = Math.max(doc.y, startY + (measure(() => { origFont(tamilFor(base)); return doc.currentLineHeight(true); }) as number));
        return doc;
      }
    }
    runs.forEach((r, i) => {
      origFont(r.tamil ? tamilFor(base) : base);
      const o = { ...opts, continued: i === runs.length - 1 ? opts.continued : true };
      if (i === 0 && x !== undefined) origText(r.text, x, y, o);
      else origText(r.text, o);
    });
    origFont(base);
    return doc;
  };
}
