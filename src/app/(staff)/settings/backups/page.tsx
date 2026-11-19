import fs from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { backupDir, BACKUP_FILE } from "@/server/system/backup";
import { SettingsTabs } from "../tabs";
import { backupNow, resetDemoData } from "../actions";

export const metadata = { title: "Backups" };

export default async function BackupsPage() {
  const user = await requireUser("settings.manage");
  const dir = backupDir();
  const files = fs.readdirSync(dir).filter((f) => BACKUP_FILE.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime })).sort((a, b) => b.at.getTime() - a.at.getTime());
  const failures = await db.backup.findMany({ where: { ok: false }, orderBy: { createdAt: "desc" }, take: 5 });
  const auto = await db.automationSetting.findUnique({ where: { key: "all.backup" } });
  return (
    <>
      <PageHeader title="Settings" description={`The database and uploaded files (photos, logo, documents) are backed up every night. Backups older than ${process.env.BACKUP_RETENTION_DAYS || 30} days are removed. ${process.env.BACKUP_COPY_COMMAND ? "Each backup is also copied off-site." : "Set BACKUP_COPY_COMMAND to copy each backup off the server automatically, or copy them regularly."}${process.env.BACKUP_ENCRYPTION_KEY ? " Backups are encrypted." : ""}`} />
      <SettingsTabs user={user} active="/settings/backups" />
      <Card className="mb-4">
        <CardHeader title="Demo data"
          description="This demo runs on mock data kept in a JSON file, not a database. Every change is saved and survives a refresh or restart. Reset brings back the original demo school and signs everyone out."
          actions={<ActionButton action={resetDemoData} args={{}} variant="danger" confirm="Reset all demo data? Every change made since the demo started is thrown away and everyone is signed out." successMessage="Demo data reset">Reset demo data</ActionButton>} />
      </Card>
      <Card>
        <CardHeader title="Backups" description={auto?.lastResult ? `Last automatic run: ${auto.lastResult}` : undefined}
          actions={<ActionButton action={backupNow} args={{}} variant="primary" successMessage="Backup saved">Back up now</ActionButton>} />
        <Table>
          <THead><tr><TH>File</TH><TH>Created</TH><TH align="right">Size</TH><TH /></tr></THead>
          <TBody>
            {files.length === 0 && <EmptyRow colSpan={4} message="No backups yet." />}
            {files.map((f) => (
              <TR key={f.name}>
                <TD className="font-mono text-xs">{f.name}</TD><TD>{fmtDateTime(f.at)}</TD><TD align="right">{(f.size / 1024 / 1024).toFixed(2)} MB</TD>
                <TD align="right"><a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/backups/${encodeURIComponent(f.name)}`}>Download</a></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {failures.length > 0 && (
          <div className="border-t border-slate-100 p-4 text-sm">
            <p className="mb-1 font-medium text-rose-700">Recent failures</p>
            {failures.map((f) => <p key={f.id} className="text-xs text-rose-600">{fmtDateTime(f.createdAt)} — {f.error}</p>)}
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Restore the data: stop the app, then <code className="rounded bg-slate-100 px-1">gunzip -c backup-….json.gz &gt; .poc/data.json</code> and start it again. Restore files: <code className="rounded bg-slate-100 px-1">tar -xzf uploads-….tar.gz</code> in the app folder. Encrypted files (.enc): first <code className="rounded bg-slate-100 px-1">npm run backup:decrypt -- &lt;file.enc&gt;</code>.</p>
      </Card>
    </>
  );
}
