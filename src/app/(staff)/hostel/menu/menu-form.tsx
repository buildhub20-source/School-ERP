"use client";
import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { saveMenuAction } from "../actions";
import type { MealDay } from "@/lib/settings";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MEALS = [{ k: "breakfast", l: "Breakfast" }, { k: "lunch", l: "Lunch" }, { k: "snacks", l: "Snacks" }, { k: "dinner", l: "Dinner" }] as const;

export function MenuForm({ menu }: { menu: Record<string, MealDay> }) {
  const [m, setM] = useState<Record<string, MealDay>>(Object.fromEntries(DAYS.map((d) => [d, { breakfast: menu[d]?.breakfast ?? "", lunch: menu[d]?.lunch ?? "", snacks: menu[d]?.snacks ?? "", dinner: menu[d]?.dinner ?? "" }])));
  const save = useAction(saveMenuAction, { successMessage: "Menu saved" });
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[56rem] text-sm">
          <thead className="bg-surface-2/70"><tr><th className="px-4 py-3 text-left text-xs font-semibold text-muted">Day</th>{MEALS.map((x) => <th key={x.k} className="px-2 py-3 text-left text-xs font-semibold text-muted">{x.l}</th>)}</tr></thead>
          <tbody className="divide-y divide-line/70">
            {DAYS.map((d) => (
              <tr key={d}>
                <td className="px-4 py-2 font-medium text-ink">{d}</td>
                {MEALS.map((x) => <td key={x.k} className="px-2 py-2"><Input value={m[d][x.k]} onChange={(e) => setM((p) => ({ ...p, [d]: { ...p[d], [x.k]: e.target.value } }))} aria-label={`${d} ${x.l}`} maxLength={200} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-line p-4"><Button loading={save.pending} onClick={() => save.run(Object.fromEntries(DAYS.map((d) => [d, JSON.stringify(m[d])])))}>Save menu</Button></div>
    </Card>
  );
}
