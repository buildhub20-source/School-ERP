import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AppError } from "./errors";

const ROOT = path.join(process.cwd(), "uploads");
const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Save an uploaded file under uploads/<folder>/ and return its URL (/uploads/<folder>/<file>). Folder "public" is served without login. */
export async function saveUpload(file: File, folder: string, opts: { maxMb?: number; types?: string[] } = {}): Promise<string> {
  const max = (opts.maxMb ?? 5) * 1024 * 1024;
  if (file.size > max) throw new AppError(`File is too large (max ${opts.maxMb ?? 5} MB).`);
  const ext = ALLOWED[file.type];
  if (!ext || (opts.types && !opts.types.includes(file.type))) throw new AppError("Unsupported file type. Use JPG, PNG, WEBP or PDF.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(buf, file.type)) throw new AppError("The file content does not match its type. Upload a real JPG, PNG, WEBP or PDF file.");
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, "");
  const dir = path.join(ROOT, safeFolder);
  await fs.mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await fs.writeFile(path.join(dir, name), buf);
  return `/uploads/${safeFolder}/${name}`;
}

/** Check the file's first bytes (magic number) so a renamed script cannot be uploaded as an image or PDF. */
function matchesSignature(b: Buffer, type: string): boolean {
  if (type === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  if (type === "application/pdf") return b.subarray(0, 5).toString("latin1") === "%PDF-";
  return false;
}

export function uploadPath(url: string): string | null {
  if (!url.startsWith("/uploads/")) return null;
  const p = path.normalize(path.join(process.cwd(), url));
  return p.startsWith(ROOT + path.sep) ? p : null;
}
