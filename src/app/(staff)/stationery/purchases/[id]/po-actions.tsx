"use client";
import { useState } from "react";
import { Button, Input, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ui/client";
import { receivePoAction, orderPo, cancelPoAction, closePoAction } from "../../actions";

type L = { id: string; name: string; unit: string; ordered: number; received: number };

export function ReceiveForm({ id, lines }: { id: string; lines: L[] }) {
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.ordered - l.received)])));
  const [invoice, setInvoice] = useState("");
  const { run, pending } = useAction(receivePoAction, { successMessage: (d: { status: string }) => (d.status === "RECEIVED" ? "All goods received. Stock added." : "Partial receipt recorded. Stock added.") });
  const open = lines.filter((l) => l.ordered > l.received);
  return (
    <div className="space-y-3">
      <Table>
        <THead><tr><TH>Item</TH><TH align="right">Ordered</TH><TH align="right">Received</TH><TH align="right">Receiving now</TH></tr></THead>
        <TBody>
          {open.map((l) => (
            <TR key={l.id}>
              <TD className="font-medium text-slate-900">{l.name}</TD>
              <TD align="right">{l.ordered}</TD>
              <TD align="right">{l.received}</TD>
              <TD align="right"><Input type="number" min={0} max={l.ordered - l.received} step={1} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className="ml-auto w-24 text-right" aria-label={`Receive ${l.name}`} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex flex-wrap items-end justify-end gap-2">
        <label className="flex flex-col text-xs text-slate-500">Supplier invoice no<Input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} className="w-48" /></label>
        <Button loading={pending} onClick={() => run({ id, invoiceNo: invoice || undefined, lines: JSON.stringify(open.map((l) => ({ lineId: l.id, qty: Number(qty[l.id] || 0) }))) })}>Receive goods</Button>
      </div>
    </div>
  );
}

export function OrderButton({ id }: { id: string }) {
  return <ActionButton action={orderPo} args={{ id }} confirm="Mark this purchase order as sent to the supplier?" variant="primary" size="md" successMessage="Marked as ordered">Mark as ordered</ActionButton>;
}
export function CancelPoButton({ id }: { id: string }) {
  return <ActionButton action={cancelPoAction} args={{ id }} confirm="Cancel this purchase order?" reason variant="danger" size="md" successMessage="Purchase order cancelled">Cancel order</ActionButton>;
}
export function ClosePoButton({ id }: { id: string }) {
  return <ActionButton action={closePoAction} args={{ id }} confirm="Close this order? The remaining quantities will not be received." reason variant="secondary" size="md" successMessage="Order closed">Close short</ActionButton>;
}
