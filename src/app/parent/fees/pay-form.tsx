"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { payFees } from "./actions";

type Line = { id: string; description: string; due: string; balance: number; overdue: boolean };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function PayForm({ studentId, lines, labels }: { studentId: string; lines: Line[]; labels: { payNow: string; payAll: string; overdue: string; due: string } }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>(() => lines.filter((l) => l.overdue).map((l) => l.id));
  const { run, pending } = useAction(payFees, { onSuccess: (d: { checkoutUrl: string }) => router.push(d.checkoutUrl), refresh: false });
  const total = Math.round(lines.filter((l) => sel.includes(l.id)).reduce((s, l) => s + l.balance, 0) * 100) / 100;
  const all = Math.round(lines.reduce((s, l) => s + l.balance, 0) * 100) / 100;
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {lines.map((l) => (
          <li key={l.id}>
            <label className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${l.overdue ? "bg-rose-50/60" : ""}`}>
              <input type="checkbox" className="size-4" checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{l.description}</span>
                <span className={`block text-xs ${l.overdue ? "font-medium text-rose-700" : "text-slate-500"}`}>{l.overdue ? `${labels.overdue} · ` : `${labels.due} `}{l.due}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{inr(l.balance)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-slate-100 p-4 sm:flex-row">
        <Button className="flex-1" disabled={!sel.length} loading={pending} onClick={() => run({ studentId, feeIds: JSON.stringify(sel) })}>{labels.payNow} {total > 0 ? inr(total) : ""}</Button>
        <Button className="flex-1" variant="secondary" loading={pending} onClick={() => run({ studentId, feeIds: JSON.stringify(lines.map((l) => l.id)) })}>{labels.payAll} ({inr(all)})</Button>
      </div>
    </div>
  );
}
