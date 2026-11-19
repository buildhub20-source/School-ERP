import "server-only";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { db } from "@/lib/db";
import { getStore, WORKING_FILE } from "@/lib/json-db/store";
import { notifyPermission } from "@/lib/messaging/notify";

/** Backup files: database dumps and uploaded-files archives, optionally encrypted (".enc"). */
export const BACKUP_FILE = /^(backup-[\w-]+\.(?:sql|json)\.gz|uploads-[\w-]+\.tar\.gz)(\.enc)?$/;

export function backupDir() {
  const dir = path.resolve(process.cwd(), process.env.BACKUP_DIR || "./backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const stampNow = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string; shell?: boolean } = {}): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], env: opts.env ?? process.env, cwd: opts.cwd, shell: opts.shell });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Save the JSON data file to backups/backup-YYYYMMDD-HHMM.json.gz (JSON mode: there is no database to pg_dump).
 * Restore: stop the app, gunzip it over .poc/data.json, start again.
 */
async function dumpDatabase(stamp: string): Promise<string> {
  getStore().saveNow();
  const fileName = `backup-${stamp}.json.gz`;
  await pipeline(fs.createReadStream(WORKING_FILE), zlib.createGzip(), fs.createWriteStream(path.join(backupDir(), fileName)));
  return fileName;
}

/** Archive the uploads folder (photos, logo, transport documents) to backups/uploads-YYYYMMDD-HHMM.tar.gz. */
async function archiveUploads(stamp: string): Promise<string | null> {
  const uploads = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploads)) return null;
  const fileName = `uploads-${stamp}.tar.gz`;
  const file = path.join(backupDir(), fileName);
  // tar writes to stdout and Node writes the file: GNU tar (e.g. Git for Windows) would read "C:\…" in -f as a remote host.
  const child = spawn("tar", ["-cz", "uploads"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  const exit = new Promise<number>((resolve, reject) => { child.on("error", reject); child.on("close", (c) => resolve(c ?? 1)); });
  await pipeline(child.stdout, fs.createWriteStream(file));
  const code = await exit;
  if (code !== 0) {
    fs.rmSync(file, { force: true });
    throw new Error(`Archiving uploads failed (${code}): ${stderr.slice(0, 300)}`);
  }
  return fileName;
}

/*
 * Optional encryption (BACKUP_ENCRYPTION_KEY = a long passphrase). File format: "SMSBK1" | salt(16) | iv(12) | ciphertext | tag(16),
 * AES-256-GCM with a scrypt key. Decrypt with: npm run backup:decrypt -- <file.enc>
 */
const MAGIC = Buffer.from("SMSBK1");

async function encryptFile(src: string, passphrase: string): Promise<string> {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([cipher.update(await fs.promises.readFile(src)), cipher.final()]);
  const dest = `${src}.enc`;
  await fs.promises.writeFile(dest, Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]));
  await fs.promises.rm(src);
  return dest;
}

export function decryptBackup(src: string, passphrase: string): Buffer {
  const data = fs.readFileSync(src);
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted backup file");
  const salt = data.subarray(6, 22), iv = data.subarray(22, 34), tag = data.subarray(data.length - 16), body = data.subarray(34, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Optional off-site copy: BACKUP_COPY_COMMAND runs once per file with {file} replaced by its full path, e.g.
 * `aws s3 cp {file} s3://my-school-backups/` or `rclone copy {file} gdrive:school-backups`.
 */
async function copyOffsite(file: string): Promise<void> {
  const tpl = process.env.BACKUP_COPY_COMMAND?.trim();
  if (!tpl) return;
  const quoted = `'${file.replace(/'/g, `'\\''`)}'`;
  const r = await run(tpl.includes("{file}") ? tpl.replaceAll("{file}", quoted) : `${tpl} ${quoted}`, [], { shell: true });
  if (r.code !== 0) throw new Error(`Off-site copy failed (${r.code}): ${r.stderr.slice(0, 300)}`);
}

/**
 * Full backup: database dump + uploads archive, each encrypted when BACKUP_ENCRYPTION_KEY is set and copied off-site when
 * BACKUP_COPY_COMMAND is set. Returns the database file name/size (as before) plus every file written.
 */
export async function createBackup(): Promise<{ fileName: string; size: number; files: string[]; offsite: boolean }> {
  const stamp = stampNow();
  const dir = backupDir();
  const made = [await dumpDatabase(stamp)];
  const uploads = await archiveUploads(stamp);
  if (uploads) made.push(uploads);
  const key = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  const files: string[] = [];
  for (const f of made) files.push(path.basename(key ? await encryptFile(path.join(dir, f), key) : path.join(dir, f)));
  for (const f of files) await db.backup.create({ data: { fileName: f, sizeBytes: BigInt(fs.statSync(path.join(dir, f)).size) } });
  let offsite = false;
  if (process.env.BACKUP_COPY_COMMAND?.trim()) {
    for (const f of files) await copyOffsite(path.join(dir, f));
    offsite = true;
  }
  return { fileName: files[0], size: fs.statSync(path.join(dir, files[0])).size, files, offsite };
}

export function pruneBackups() {
  const days = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  const dir = backupDir();
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!BACKUP_FILE.test(f)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p); removed++; }
  }
  return removed;
}

export async function nightlyBackup(): Promise<string> {
  try {
    const { files, offsite } = await createBackup();
    const removed = pruneBackups();
    const sizes = files.map((f) => `${f} (${(fs.statSync(path.join(backupDir(), f)).size / 1024 / 1024).toFixed(2)} MB)`).join(", ");
    return `Saved ${sizes}${offsite ? ", copied off-site" : ""}${removed ? `, removed ${removed} old backup(s)` : ""}`;
  } catch (e) {
    await db.backup.create({ data: { fileName: "-", sizeBytes: BigInt(0), ok: false, error: String(e).slice(0, 500) } });
    await notifyPermission("settings.manage", { title: "Nightly backup failed", body: String(e).slice(0, 300), link: "/settings/backups", category: "SYSTEM", inAppOnly: true });
    throw e;
  }
}
