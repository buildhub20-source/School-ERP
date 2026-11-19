"use client";
import { useState } from "react";
import { ArrowLeftRight, CheckCircle2, IndianRupee, PackageCheck, Undo2, XCircle } from "lucide-react";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { ActionButton, ModalForm } from "@/components/ui/client";
import { MODE_LABELS, PAYMENT_MODES } from "@/server/uniforms/labels";
import { exchangeAction, orderPaymentAction, orderStatusAction, returnAction } from "../actions";

export function PaymentModal({ orderId, balance }: { orderId: string; balance: number }) {
  const [mode, setMode] = useState("CASH");
  return (
    <ModalForm trigger="Record payment" triggerVariant="primary" icon={<IndianRupee className="size-4" />} title="Record payment at counter"
      description={`Balance due: ₹${balance.toLocaleString("en-IN")}`} action={orderPaymentAction} extra={{ orderId }}
      successMessage={(d: { receiptNo: string | null }) => `Payment recorded${d.receiptNo ? ` · receipt ${d.receiptNo}` : ""}`}>
      <FormGrid>
        <Field label="Amount (₹)" required><Input name="amount" type="number" step="0.01" min={0.01} max={balance} defaultValue={balance} required /></Field>
        <Field label="Mode" required>
          <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>{PAYMENT_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}</Select>
        </Field>
        {mode !== "CASH" && <Field label="Reference" required className="sm:col-span-2" hint="UTR, card slip or cheque number"><Input name="reference" required maxLength={100} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Input name="notes" maxLength={300} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function StatusButtons({ orderId, status, canReady }: { orderId: string; status: string; canReady: boolean }) {
  return (
    <>
      {status === "PAID" && (
        <ActionButton action={orderStatusAction} args={{ orderId, to: "READY" }} variant="primary" size="md" disabled={!canReady}
          title={canReady ? undefined : "Not enough stock for every item"} confirm="Mark ready? Stock will be set aside and the parent notified." successMessage="Marked ready — parent notified">
          <PackageCheck className="size-4" />Mark ready
        </ActionButton>
      )}
      {status === "READY" && (
        <ActionButton action={orderStatusAction} args={{ orderId, to: "DELIVERED" }} variant="success" size="md" confirm="Hand over to the student/parent?" successMessage="Delivered">
          <CheckCircle2 className="size-4" />Mark delivered
        </ActionButton>
      )}
      {["ORDERED", "PAID", "READY"].includes(status) && (
        <ActionButton action={orderStatusAction} args={{ orderId, to: "CANCELLED" }} variant="danger" size="md" confirm="Cancel this order?" reason reasonLabel="Reason for cancelling"
          successMessage={(d: unknown) => { const r = (d as { refundDue?: number })?.refundDue ?? 0; return r > 0 ? `Order cancelled. ₹${r.toLocaleString("en-IN")} was paid — raise a refund in Fees.` : "Order cancelled"; }}>
          <XCircle className="size-4" />Cancel
        </ActionButton>
      )}
    </>
  );
}

type LineOpt = { id: string; label: string; open: number; unitPrice: number; options: { id: string; size: string; price: number; stock: number }[] };

export function ExchangeModal({ orderId, lines }: { orderId: string; lines: LineOpt[] }) {
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(1);
  const line = lines.find((l) => l.id === lineId);
  const target = line?.options.find((o) => o.id === to);
  const diff = line && target ? (target.price - line.unitPrice) * qty : 0;
  return (
    <ModalForm trigger="Exchange size" triggerVariant="secondary" triggerSize="sm" icon={<ArrowLeftRight className="size-4" />} title="Exchange a wrong size"
      description="The returned size goes back into stock and the new size is taken from stock." action={exchangeAction} extra={{ orderId }}
      successMessage={(d: { priceDiff: number }) => d.priceDiff > 0 ? `Exchanged. ₹${d.priceDiff} more is due — record the payment.` : d.priceDiff < 0 ? `Exchanged. ₹${-d.priceDiff} excess — raise a refund in Fees.` : "Exchanged"}>
      <FormGrid>
        <Field label="Item" required className="sm:col-span-2">
          <Select name="lineId" value={lineId} onChange={(e) => { setLineId(e.target.value); setTo(""); setQty(1); }}>{lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
        </Field>
        <Field label="New size" required>
          <Select name="toVariantId" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Choose size" required>
            {line?.options.map((o) => <option key={o.id} value={o.id} disabled={o.stock < 1}>{o.size} · {o.stock} in stock</option>)}
          </Select>
        </Field>
        <Field label="Quantity" required><Input name="qty" type="number" min={1} max={line?.open ?? 1} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(line?.open ?? 1, Number(e.target.value) || 1)))} /></Field>
        <Field label="Reason" className="sm:col-span-2"><Input name="reason" maxLength={300} placeholder="e.g. Too small" /></Field>
      </FormGrid>
      {target && <p className="mt-3 text-sm text-slate-600">Price difference: <b>{diff === 0 ? "none" : `₹${diff.toLocaleString("en-IN")}`}</b>{target.stock < qty && <span className="ml-2 text-rose-600">Not enough stock of size {target.size}.</span>}</p>}
    </ModalForm>
  );
}

export function ReturnModal({ orderId, lines }: { orderId: string; lines: LineOpt[] }) {
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const line = lines.find((l) => l.id === lineId);
  return (
    <ModalForm trigger="Return" triggerVariant="secondary" triggerSize="sm" icon={<Undo2 className="size-4" />} title="Return items" description="Returned items go back into stock and the order total is reduced."
      action={returnAction} extra={{ orderId }} successMessage={(d: { refundDue: number }) => d.refundDue > 0 ? `Returned. ₹${d.refundDue} excess — raise a refund in Fees.` : "Returned"}>
      <FormGrid>
        <Field label="Item" required className="sm:col-span-2">
          <Select name="lineId" value={lineId} onChange={(e) => setLineId(e.target.value)}>{lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
        </Field>
        <Field label="Quantity" required hint={line ? `Up to ${line.open}` : undefined}><Input name="qty" type="number" min={1} max={line?.open ?? 1} defaultValue={1} required /></Field>
        <Field label="Reason" required className="sm:col-span-2"><Textarea name="reason" required maxLength={300} /></Field>
      </FormGrid>
    </ModalForm>
  );
}
