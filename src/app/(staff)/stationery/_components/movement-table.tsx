import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Table, THead, TBody, TR, TH, TD, EmptyRow, Badge } from "@/components/ui";
import { MOVEMENT_LABELS, RECIPIENT_LABELS } from "@/server/stationery/core";
import { fmtDateTime, money, toNum } from "@/lib/format";

export const movementInclude = {
  item: { select: { id: true, name: true, unit: true } },
  createdBy: { select: { name: true } },
  recipientUser: { select: { name: true } },
  student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
  schoolClass: { select: { name: true } },
  department: { select: { name: true } },
  request: { select: { id: true, requestNo: true } },
} satisfies Prisma.StockMovementInclude;

export type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

export function recipientText(m: MovementRow) {
  if (m.student) return `${m.student.firstName} ${m.student.lastName ?? ""}`.trim();
  if (m.recipientUser) return m.recipientUser.name;
  if (m.recipientType === "CLASS" && m.schoolClass) return m.schoolClass.name;
  if (m.recipientType === "DEPARTMENT" && m.department) return m.department.name;
  return m.recipientType ? RECIPIENT_LABELS[m.recipientType] : "—";
}

/** Movement log table. Every row shows recipient, who recorded it and when. */
export function MovementTable({ rows, showItem = true }: { rows: MovementRow[]; showItem?: boolean }) {
  const cols = showItem ? 9 : 8;
  return (
    <Table>
      <THead><tr><TH>When</TH>{showItem && <TH>Item</TH>}<TH>Type</TH><TH align="right">Qty</TH><TH align="right">Balance</TH><TH align="right">Value</TH><TH>Recipient</TH><TH>Charged to</TH><TH>By / note</TH></tr></THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={cols} message="No stock movements." />}
        {rows.map((m) => (
          <TR key={m.id}>
            <TD className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</TD>
            {showItem && <TD><Link href={`/stationery/items/${m.item.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.item.name}</Link></TD>}
            <TD><Badge tone={m.qty > 0 ? "green" : m.type === "ISSUE" ? "indigo" : "red"}>{MOVEMENT_LABELS[m.type]}</Badge></TD>
            <TD align="right" className={m.qty > 0 ? "text-emerald-700" : "text-rose-700"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TD>
            <TD align="right">{m.balanceAfter}</TD>
            <TD align="right">{money(Math.abs(m.qty) * toNum(m.unitCost))}</TD>
            <TD>
              {m.student ? <Link href={`/students/${m.student.id}`} className="hover:text-brand-700">{recipientText(m)}</Link> : recipientText(m)}
              {m.request && <Link href={`/stationery/requests/${m.request.id}`} className="block font-mono text-xs text-brand-700 hover:underline">{m.request.requestNo}</Link>}
            </TD>
            <TD>{m.schoolClass?.name ?? m.department?.name ?? "—"}</TD>
            <TD><span className="whitespace-nowrap">{m.createdBy?.name ?? "System"}</span>{m.note && <span className="block max-w-xs text-xs text-slate-500">{m.note}</span>}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
