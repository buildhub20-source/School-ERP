import fs from "node:fs/promises";
import path from "node:path";
import { getUser, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { uploadPath } from "@/lib/uploads";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", svg: "image/svg+xml" };

/** Serves uploaded files. Everything except uploads/public/* requires a signed-in user. */
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  // Each segment must be a plain name: no "..", ".", empty parts or encoded slashes (e.g. public/..%2Fstudents/…),
  // otherwise "public/../<folder>" would skip the login check below.
  if (!parts.length || parts.some((s) => !s || s === "." || s === ".." || /[\\/\0]/.test(s))) return new Response("Not found", { status: 404 });
  const url = "/uploads/" + parts.join("/");
  if (parts[0] !== "public") {
    const user = await getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });
    if (!(await mayView(user, url, parts[0]))) return new Response("Not found", { status: 404 });
  }
  const file = uploadPath(url);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    return new Response(new Uint8Array(data), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/**
 * Staff may open uploaded files. Parents may only open their own children's photos; drivers/attendants have no
 * uploaded files to view (transport documents and other students' photos stay private).
 */
async function mayView(user: SessionUser, url: string, folder: string): Promise<boolean> {
  // Staff certificates and ID proofs: HR only.
  if (folder === "staff-docs") return user.permissions.includes("hr.view") || user.permissions.includes("hr.manage");
  const isParent = user.permissions.includes("parent.portal");
  const isDriver = user.permissions.includes("driver.portal");
  if (!isParent && !isDriver) return true;
  if (isParent && folder === "students") {
    const own = await db.student.count({ where: { photoUrl: url, guardians: { some: { guardian: { userId: user.id } } } } });
    return own > 0;
  }
  return false;
}
