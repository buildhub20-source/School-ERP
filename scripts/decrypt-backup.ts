/**
 * Decrypt an encrypted backup (.enc) made with BACKUP_ENCRYPTION_KEY.
 * Usage: npm run backup:decrypt -- backups/backup-20261108-0100.sql.gz.enc   (writes the file without ".enc")
 * The passphrase is read from BACKUP_ENCRYPTION_KEY (environment or .env).
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
import { decryptBackup } from "../src/server/system/backup";

loadEnvConfig(process.cwd());
const file = process.argv[2];
const key = process.env.BACKUP_ENCRYPTION_KEY?.trim();
if (!file || !file.endsWith(".enc")) { console.error("Usage: npm run backup:decrypt -- <backup file ending in .enc>"); process.exit(1); }
if (!key) { console.error("Set BACKUP_ENCRYPTION_KEY to the passphrase used when the backup was made."); process.exit(1); }
const out = file.slice(0, -4);
fs.writeFileSync(out, decryptBackup(file, key));
console.log(`Decrypted to ${out}`);
