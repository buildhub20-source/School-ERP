"use client";
import { useState } from "react";
import { ClipboardPlus, PackagePlus, Send, XCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { Modal, ActionButton, useAction } from "@/components/ui/client";
import { PurchaseBuilder } from "./forms";
import { purchaseStatusAction, receiveAction } from "../actions";

type VOpt = { id: string; label: string; stock: number; price: number; lastCost: number };

/** Button + modal with the purchase builder (optionally pre-filled, e.g. from a shortfall). */
export function PurchaseModal({ label, suppliers, variants, initial, defaultStatus, variant = "primary" }: {
  label: string; suppliers: { id: string; name: string }[]; variants: VOpt[]; initial?: { variantId: string; qty: number }[];
  defaultStatus?: "DRAFT" | "ORDERED" | "RECEIVED"; variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} disabled={initial !== undefined && !initial.length}>{defaultStatus === "RECEIVED" ? <PackagePlus className="size-4" /> : <ClipboardPlus className="size-4" />}{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="xl">
        {open && <PurchaseBuilder suppliers={suppliers} variants={variants} initial={initial} defaultStatus={defaultStatus} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

export function PoStatusButtons({ poId, status, received }: { poId: string; status: string; received: boolean }) {
  return (
    <>
      {status === "DRAFT" && <ActionButton action={purchaseStatusAction} args={{ poId, to: "ORDERED" }} variant="primary" size="md" successMessage="Marked as ordered"><Send className="size-4" />Mark ordered</ActionButton>}
      {["DRAFT", "ORDERED"].includes(status) && !received && <ActionButton action={purchaseStatusAction} args={{ poId, to: "CANCELLED" }} variant="danger" size="md" confirm="Cancel this purchase order?" successMessage="Cancelled"><XCircle className="size-4" />Cancel</ActionButton>}
    </>
  );
}

export function ReceiveForm({ poId, lines }: { poId: string; lines: { id: string; label: string; left: number }[] }) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.left])));
  const [invoiceNo, setInvoiceNo] = useState("");
  const { run, pending } = useAction(receiveAction, { successMessage: "Goods received — stock updated" });
  const any = Object.values(qty).some((n) => n > 0);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Item / size</th><th className="px-3 py-2 text-right">Pending</th><th className="px-3 py-2 text-left">Receiving now</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id}><td className="px-3 py-2">{l.label}</td><td className="px-3 py-2 text-right">{l.left}</td>
                <td className="px-3 py-2"><Input type="number" min={0} max={l.left} value={qty[l.id]} onChange={(e) => setQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(l.left, Number(e.target.value) || 0)) }))} className="w-24" aria-label={`Receive ${l.label}`} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Supplier invoice no"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={60} /></Field>
        <Button loading={pending} disabled={!any} onClick={() => run({ poId, invoiceNo, lines: JSON.stringify(Object.entries(qty).map(([lineId, q]) => ({ lineId, qty: q }))) })}>Receive goods</Button>
      </div>
    </div>
  );
}
