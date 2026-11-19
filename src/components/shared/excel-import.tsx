"use client";
import { useState } from "react";
import { useAction } from "@/components/ui/client";
import { Button, Input } from "@/components/ui";
import type { ActionResult } from "@/lib/action";

type Result = { total: number; ok: number; errors: { row: number; message: string }[]; dryRun: boolean };

/** Generic Excel import form: validate first (dry run), then import. */
export function ExcelImport({ action, label = "rows" }: { action: (fd: FormData) => Promise<ActionResult<Result>>; label?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const { run, pending } = useAction(action as never, { onSuccess: (d: Result) => setResult(d), refresh: true });
  const submit = (dryRun: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("dryRun", dryRun ? "true" : "false");
    run(fd);
  };
  return (
    <div className="space-y-4">
      <Input type="file" accept=".xlsx" className="h-auto py-1.5" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!file} loading={pending} onClick={() => submit(true)}>Check file</Button>
        <Button disabled={!file || !result?.dryRun || result.errors.length > 0} loading={pending} onClick={() => submit(false)}>Import {result?.dryRun && result.ok ? `${result.ok} ${label}` : ""}</Button>
      </div>
      {result && (
        <div className={`rounded-lg border p-3 text-sm ${result.errors.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="font-medium">{result.dryRun ? "Check complete" : "Import complete"}: {result.ok} of {result.total} {label} {result.dryRun ? "are valid" : "imported"}.</p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5 text-amber-900">
              {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
            </ul>
          )}
          {result.dryRun && result.errors.length > 0 && <p className="mt-2 text-xs">Fix the rows above and check the file again. Nothing has been imported yet.</p>}
        </div>
      )}
    </div>
  );
}
