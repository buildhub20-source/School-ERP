import fs from "node:fs";
import path from "node:path";
import { requireUserOrThrow } from "@/lib/auth/session";
import { backupDir, BACKUP_FILE } from "@/server/system/backup";
import { db } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  let user;
  try { user = await requireUserOrThrow("settings.manage"); } catch { return new Response("Forbidden", { status: 403 }); }
  const { file } = await params;
  if (!BACKUP_FILE.test(file)) return new Response("Not found", { status: 404 });
  const p = path.join(backupDir(), file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  await db.auditLog.create({ data: { userId: user.id, userName: user.name, action: "DOWNLOAD", entity: "Backup", entityId: file } });
  return new Response(new Uint8Array(fs.readFileSync(p)), { headers: { "content-type": file.endsWith(".enc") ? "application/octet-stream" : "application/gzip", "content-disposition": `attachment; filename="${file}"` } });
}
