"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModalForm, ActionForm, ActionButton, useAction, useToast } from "@/components/ui/client";
import { Button, Field, Input, Select, Textarea, Checkbox, FormGrid } from "@/components/ui";
import {
  saveFeeHeadAction, saveStructureAction, copyStructureAction, addLineAction, splitLineAction, collectAction, resendReceiptAction,
  requestConcessionAction, requestAdjustmentAction, requestRefundAction, closeDayAction, remindAction, decideRefundAction, saveOtherFeeAction,
} from "./actions";

type Opt = { value: string; label: string };
const MODES: Opt[] = [
  { value: "CASH", label: "Cash" }, { value: "CHEQUE", label: "Cheque" }, { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" }, { value: "NETBANKING", label: "Net banking" }, { value: "BANK_TRANSFER", label: "Bank transfer" },
];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ───────── setup ───────── */

export function FeeHeadForm({ head }: { head?: { id: string; name: string; type: string; lateFeeApplies: boolean; isActive: boolean } }) {
  return (
    <ModalForm trigger={head ? "Edit" : "Add fee head"} triggerVariant={head ? "secondary" : "primary"} triggerSize="sm" title={head ? "Edit fee head" : "Add fee head"} action={saveFeeHeadAction} extra={{ id: head?.id }}>
      <Field label="Name" required><Input name="name" defaultValue={head?.name} required /></Field>
      <Field label="Type" hint="Concessions apply to tuition-type heads by default. Transport heads are filled by the transport module.">
        <Select name="type" defaultValue={head?.type ?? "OTHER"}><option value="TUITION">Tuition</option><option value="OTHER">Other</option><option value="TRANSPORT">Transport</option></Select>
      </Field>
      <input type="hidden" name="lateFeeApplies" value="false" />
      <Checkbox name="lateFeeApplies" value="true" label="Late fee applies after the due date" defaultChecked={head?.lateFeeApplies ?? true} />
      <input type="hidden" name="isActive" value="false" />
      <Checkbox name="isActive" value="true" label="Active" defaultChecked={head?.isActive ?? true} />
    </ModalForm>
  );
}

export function StructureForm({ yearId, classes, terms, heads, row }: {
  yearId: string; classes: Opt[]; terms: Opt[]; heads: Opt[];
  row?: { id: string; classId: string; termId: string | null; feeHeadId: string; amount: number; dueDate: string; instalments: number };
}) {
  return (
    <ModalForm trigger={row ? "Edit" : "Add fee line"} triggerVariant={row ? "ghost" : "secondary"} triggerSize="sm" title={row ? "Edit fee structure line" : "Add an existing fee to a class"}
      description="Defined once per class and term; it applies to every student in the class when dues are generated." action={saveStructureAction} extra={{ id: row?.id, academicYearId: yearId }}>
      <FormGrid>
        <Field label="Class" required><Select name="classId" defaultValue={row?.classId} required placeholder="Choose…">{classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
        <Field label="Term" required><Select name="termId" defaultValue={row ? row.termId ?? "ANNUAL" : terms[0]?.value}><option value="ANNUAL">Annual (whole year)</option>{terms.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <Field label="Fee head" required><Select name="feeHeadId" defaultValue={row?.feeHeadId} required placeholder="Choose…">{heads.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</Select></Field>
        <Field label="Amount (₹)" required><Input name="amount" type="number" min="1" step="0.01" defaultValue={row?.amount} required /></Field>
        <Field label="Due date" required><Input name="dueDate" type="date" defaultValue={row?.dueDate} required /></Field>
        <Field label="Instalments" hint="Split into equal parts due every 30 days"><Input name="instalments" type="number" min="1" max="12" defaultValue={row?.instalments ?? 1} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function CopyStructureForm({ yearId, classes }: { yearId: string; classes: Opt[] }) {
  return (
    <ModalForm trigger="Copy to classes" triggerVariant="secondary" triggerSize="sm" title="Copy a class's fee structure" action={copyStructureAction} extra={{ academicYearId: yearId }}
      successMessage={(d: { created: number; skipped: number }) => `Copied ${d.created} lines (${d.skipped} already existed)`} submitLabel="Copy">
      <Field label="Copy from" required><Select name="fromClassId" required placeholder="Choose…">{classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
      <Field label="To classes" hint="Lines that already exist in a target class are kept.">
        <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-3">
          {classes.map((c) => <Checkbox key={c.value} name="toClassIds[]" value={c.value} label={c.label} />)}
        </div>
      </Field>
    </ModalForm>
  );
}

/* ───────── account actions ───────── */

export function AddLineForm({ studentId, heads, terms, today }: { studentId: string; heads: Opt[]; terms: Opt[]; today: string }) {
  return (
    <ModalForm trigger="Add fee line" triggerVariant="secondary" triggerSize="sm" title="Add a fee to this account" action={addLineAction} extra={{ studentId }}>
      <FormGrid>
        <Field label="Fee head" required><Select name="feeHeadId" required placeholder="Choose…">{heads.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</Select></Field>
        <Field label="Term"><Select name="termId" placeholder="None / annual">{terms.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select></Field>
        <Field label="Description" required className="sm:col-span-2"><Input name="description" required /></Field>
        <Field label="Amount (₹)" required><Input name="amount" type="number" min="1" step="0.01" required /></Field>
        <Field label="Due date" required><Input name="dueDate" type="date" defaultValue={today} required /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function SplitLineForm({ line }: { line: { id: string; description: string; amount: number; dueDate: string } }) {
  const [parts, setParts] = useState(() => {
    const half = Math.floor((line.amount / 2) * 100) / 100;
    const d2 = new Date(line.dueDate); d2.setUTCDate(d2.getUTCDate() + 30);
    return [{ amount: half, dueDate: line.dueDate }, { amount: r2(line.amount - half), dueDate: d2.toISOString().slice(0, 10) }];
  });
  const sum = r2(parts.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const set = (i: number, k: "amount" | "dueDate", v: string) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: k === "amount" ? Number(v) : v } : p)));
  return (
    <ModalForm trigger="Split" triggerVariant="ghost" triggerSize="sm" title="Split into instalments" description={`${line.description} — ${inr(line.amount)}`} action={splitLineAction}
      extra={{ studentFeeId: line.id, parts: JSON.stringify(parts) }} submitLabel="Split" successMessage="Fee split into instalments">
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <span className="w-6 pb-2 text-sm text-slate-500">{i + 1}.</span>
            <Field label="Amount" className="flex-1"><Input type="number" step="0.01" min="0.01" value={p.amount} onChange={(e) => set(i, "amount", e.target.value)} /></Field>
            <Field label="Due date" className="flex-1"><Input type="date" value={p.dueDate} onChange={(e) => set(i, "dueDate", e.target.value)} /></Field>
            {parts.length > 2 && <Button type="button" variant="ghost" size="sm" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button type="button" variant="secondary" size="sm" disabled={parts.length >= 12} onClick={() => setParts((ps) => [...ps, { amount: 0, dueDate: ps[ps.length - 1].dueDate }])}>Add instalment</Button>
          <span className={`text-sm ${Math.abs(sum - line.amount) > 0.009 ? "text-rose-600" : "text-emerald-700"}`}>Total {inr(sum)} of {inr(line.amount)}</span>
        </div>
      </div>
    </ModalForm>
  );
}

export function ConcessionRequestForm({ studentId, heads, defaults, triggerLabel = "Request concession", students }: {
  studentId?: string; heads: Opt[]; defaults?: { type: string; value: number; reason: string }; triggerLabel?: string; students?: Opt[];
}) {
  return (
    <ModalForm trigger={triggerLabel} triggerVariant={defaults ? "secondary" : "primary"} triggerSize="sm" title="Request concession / scholarship" description="Applied after approval by the School Admin."
      action={requestConcessionAction} extra={studentId ? { studentId } : undefined} successMessage="Concession requested for approval">
      <FormGrid>
        {!studentId && <Field label="Student (admission no)" required className="sm:col-span-2"><Select name="studentId" required placeholder="Choose…">{students?.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>}
        <Field label="Type" required><Select name="type" defaultValue={defaults?.type ?? "MERIT"}><option value="SIBLING">Sibling discount</option><option value="STAFF_CHILD">Staff child</option><option value="MERIT">Merit scholarship</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Applies to"><Select name="feeHeadId" placeholder="All tuition fees">{heads.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}</Select></Field>
        <Field label="Mode"><Select name="mode" defaultValue="PERCENT"><option value="PERCENT">Percent of fee</option><option value="FIXED">Fixed ₹ per fee line</option></Select></Field>
        <Field label="Value" required><Input name="value" type="number" step="0.01" min="0.01" defaultValue={defaults?.value} required /></Field>
        <Field label="Reason" required className="sm:col-span-2"><Textarea name="reason" rows={2} defaultValue={defaults?.reason} required /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function AdjustmentForm({ line }: { line: { id: string; description: string; net: number } }) {
  return (
    <ModalForm trigger="Adjust" triggerVariant="ghost" triggerSize="sm" title="Request fee adjustment" description={`${line.description} — payable ${inr(line.net)}`} action={requestAdjustmentAction}
      extra={{ studentFeeId: line.id }} successMessage="Adjustment requested for approval">
      <FormGrid>
        <Field label="Direction"><Select name="direction"><option value="REDUCE">Reduce the fee (waiver)</option><option value="ADD">Add to the fee</option></Select></Field>
        <Field label="Amount (₹)" required><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
        <Field label="Reason" required className="sm:col-span-2"><Textarea name="reason" rows={2} required /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function RefundRequestForm({ paymentId, max }: { paymentId: string; max: number }) {
  return (
    <ModalForm trigger="Request refund" triggerVariant="secondary" triggerSize="sm" title="Request refund" description={`Up to ${inr(max)} can be refunded from this receipt.`} action={requestRefundAction}
      extra={{ paymentId }} successMessage="Refund requested for approval">
      <FormGrid>
        <Field label="Amount (₹)" required><Input name="amount" type="number" step="0.01" min="0.01" max={max} defaultValue={max} required /></Field>
        <Field label="Pay out by"><Select name="mode" defaultValue="BANK_TRANSFER">{MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
        <Field label="Reason" required className="sm:col-span-2"><Textarea name="reason" rows={2} required /></Field>
      </FormGrid>
      <input type="hidden" name="waiveFee" value="false" />
      <Checkbox name="waiveFee" value="true" label="Also waive the fee (the refunded amount will not become due again)" />
    </ModalForm>
  );
}

export function ApproveRefundForm({ id, amount }: { id: string; amount: number }) {
  return (
    <ModalForm trigger="Approve" triggerVariant="success" triggerSize="sm" title="Approve refund" description={`Pay out ${inr(amount)} and record it.`} action={decideRefundAction}
      extra={{ id, approve: "true" }} submitLabel="Approve & record payout" successMessage="Refund approved">
      <Field label="Payout reference" hint="Cheque no., UTR or voucher no."><Input name="payoutRef" /></Field>
      <Field label="Note"><Textarea name="reason" rows={2} /></Field>
    </ModalForm>
  );
}

/* ───────── collection ───────── */

type OpenLine = { id: string; description: string; dueDate: string; balance: number; overdue: boolean; head: string };

export function CollectForm({ studentId, lines, today }: { studentId: string; lines: OpenLine[]; today: string }) {
  const router = useRouter();
  const [pay, setPay] = useState<Record<string, number>>({});
  const [auto, setAuto] = useState(false);
  const [autoAmount, setAutoAmount] = useState(0);
  const [mode, setMode] = useState("CASH");
  const [send, setSend] = useState<string[]>(["SMS"]);
  const totalDue = r2(lines.reduce((s, l) => s + l.balance, 0));
  const selectedTotal = useMemo(() => r2(Object.values(pay).reduce((s, v) => s + (Number(v) || 0), 0)), [pay]);
  const amount = auto ? autoAmount : selectedTotal;
  const { run, pending, error } = useAction(collectAction, {
    successMessage: (d: { receiptNo: string | null }) => `Receipt ${d.receiptNo} issued`,
    onSuccess: (d: { id: string }) => router.push(`/fees/payments/${d.id}`), refresh: false,
  });
  const toggle = (l: OpenLine, on: boolean) => setPay((p) => { const n = { ...p }; if (on) n[l.id] = l.balance; else delete n[l.id]; return n; });
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("studentId", studentId);
    fd.set("amount", String(amount));
    if (!auto) fd.set("allocations", JSON.stringify(Object.entries(pay).filter(([, v]) => v > 0).map(([studentFeeId, a]) => ({ studentFeeId, amount: a }))));
    fd.set("sendVia", JSON.stringify(send));
    run(fd);
  };
  if (!lines.length) return <p className="text-sm text-slate-500">No open dues on this account.</p>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2"><input type="radio" checked={!auto} onChange={() => setAuto(false)} /> Pay selected lines</label>
        <label className="inline-flex items-center gap-2"><input type="radio" checked={auto} onChange={() => setAuto(true)} /> Amount, oldest dues first</label>
      </div>
      {!auto ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
              <th className="px-3 py-2 text-left"><input type="checkbox" aria-label="Select all" checked={Object.keys(pay).length === lines.length} onChange={(e) => setPay(e.target.checked ? Object.fromEntries(lines.map((l) => [l.id, l.balance])) : {})} /></th>
              <th className="px-3 py-2 text-left">Fee</th><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-right">Pay now</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id} className={l.overdue ? "bg-rose-50/60" : ""}>
                  <td className="px-3 py-2"><input type="checkbox" checked={l.id in pay} onChange={(e) => toggle(l, e.target.checked)} aria-label={`Select ${l.description}`} /></td>
                  <td className="px-3 py-2">{l.description}<span className="block text-xs text-slate-500">{l.head}</span></td>
                  <td className={`px-3 py-2 whitespace-nowrap ${l.overdue ? "font-medium text-rose-700" : ""}`}>{l.dueDate}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(l.balance)}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" step="0.01" min="0" max={l.balance} disabled={!(l.id in pay)} value={pay[l.id] ?? ""} aria-label="Amount"
                      onChange={(e) => setPay((p) => ({ ...p, [l.id]: Math.min(l.balance, Number(e.target.value) || 0) }))}
                      className="h-8 w-28 rounded-md border border-slate-300 px-2 text-right disabled:bg-slate-100" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Field label="Amount (₹)" hint={`Total dues ${inr(totalDue)}. Allocated to the oldest due lines first.`}>
          <Input type="number" step="0.01" min="0.01" max={totalDue} value={autoAmount || ""} onChange={(e) => setAutoAmount(Number(e.target.value) || 0)} />
        </Field>
      )}
      <FormGrid cols={3}>
        <Field label="Mode" required><Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></Field>
        {mode === "CHEQUE" && <>
          <Field label="Bank" required><Input name="chequeBank" required /></Field>
          <Field label="Cheque no." required><Input name="reference" required /></Field>
          <Field label="Cheque date" required><Input name="chequeDate" type="date" defaultValue={today} required /></Field>
        </>}
        {mode !== "CASH" && mode !== "CHEQUE" && <Field label={mode === "CARD" ? "Approval / terminal ref" : "Transaction ref (UTR)"} required><Input name="reference" required /></Field>}
        <Field label="Payment date" hint="Back-dating is blocked for closed days"><Input name="paidOn" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input name="notes" /></Field>
      </FormGrid>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-slate-600">Send receipt by:</span>
        {["SMS", "WHATSAPP", "EMAIL"].map((c) => (
          <Checkbox key={c} label={c === "WHATSAPP" ? "WhatsApp" : c === "EMAIL" ? "Email" : "SMS"} checked={send.includes(c)} onChange={(e) => setSend((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))} />
        ))}
      </div>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-lg font-semibold tabular-nums">Total {inr(amount)}</p>
        <Button type="submit" loading={pending} disabled={!(amount > 0)}>Collect &amp; issue receipt</Button>
      </div>
    </form>
  );
}

export function ResendReceipt({ id }: { id: string }) {
  const [ch, setCh] = useState<string[]>(["SMS"]);
  const { run, pending } = useAction(resendReceiptAction, { successMessage: (d: { sent: number }) => `Sent ${d.sent} message(s)`, refresh: false });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {["SMS", "WHATSAPP", "EMAIL"].map((c) => <Checkbox key={c} label={c === "WHATSAPP" ? "WhatsApp" : c === "EMAIL" ? "Email (PDF)" : "SMS"} checked={ch.includes(c)} onChange={(e) => setCh((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))} />)}
      <Button size="sm" variant="secondary" loading={pending} disabled={!ch.length} onClick={() => run({ id, channels: JSON.stringify(ch) })}>Send receipt</Button>
    </div>
  );
}

/* ───────── cash book / defaulters ───────── */

export function CloseDayForm({ date, expectedCash, expectedBank }: { date: string; expectedCash: number; expectedBank: number }) {
  const [cash, setCash] = useState(expectedCash);
  const [bank, setBank] = useState(expectedBank);
  const diff = r2(cash - expectedCash + (bank - expectedBank));
  return (
    <ModalForm trigger="Close the day" title={`Day-end closing — ${date}`} description="Closed days are locked: no payments can be added, back-dated or cancelled on them." action={closeDayAction} extra={{ date }} submitLabel="Close day" successMessage="Day closed">
      <FormGrid>
        <Field label="Cash counted (₹)" hint={`System cash (after cash refunds): ${inr(expectedCash)}`}><Input name="cashCounted" type="number" step="0.01" min="0" value={cash} onChange={(e) => setCash(Number(e.target.value) || 0)} /></Field>
        <Field label="Bank credited (₹)" hint={`System non-cash: ${inr(expectedBank)}`}><Input name="bankCredited" type="number" step="0.01" min="0" value={bank} onChange={(e) => setBank(Number(e.target.value) || 0)} /></Field>
        <Field label="Cash deposited to bank (₹)"><Input name="cashDeposited" type="number" step="0.01" min="0" defaultValue={0} /></Field>
        <div className={`rounded-lg p-3 text-sm ${Math.abs(diff) > 0.009 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>Difference: <b>{inr(diff)}</b></div>
        <Field label="Notes" hint={Math.abs(diff) > 0.009 ? "Required when there is a difference" : undefined} className="sm:col-span-2"><Textarea name="notes" rows={2} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function DefaulterReminder({ ids, label }: { ids: string[]; label: string }) {
  return <ActionButton action={remindAction} args={{ studentIds: JSON.stringify(ids) }} confirm={`Send overdue reminders to ${ids.length} famil${ids.length === 1 ? "y" : "ies"}?`} successMessage={(d: { sent: number }) => `Reminders sent to ${d.sent} families`} disabled={!ids.length}>{label}</ActionButton>;
}

export function DefaulterSelect() {
  // Reads the checkboxes named "sel" in the defaulter table.
  const { run, pending } = useAction(remindAction, { successMessage: (d: { sent: number }) => `Reminders sent to ${d.sent} families`, refresh: false });
  const toast = useToast();
  return (
    <Button type="button" size="sm" variant="secondary" loading={pending} onClick={() => {
      const ids = Array.from(document.querySelectorAll<HTMLInputElement>("input[name=sel]:checked")).map((e) => e.value);
      if (!ids.length) { toast.error("Tick the students to remind first."); return; }
      run({ studentIds: JSON.stringify(ids) });
    }}>Remind selected</Button>
  );
}


/* ───────── new fee (a fee head + its class amounts in the fee structure) ───────── */

export type OtherFeeRow = {
  id: string; name: string; lateFeeApplies: boolean; isActive: boolean; termId: string | null; dueDate: string; instalments: number;
  lines: { classId: string; amount: number; billed: number }[];
};

/** Full-page add / edit form for a fee: one amount per class, saved into the fee structure. */
export function OtherFeeForm({ terms, classes, today, row, backTo }: { terms: Opt[]; classes: { id: string; name: string }[]; today: string; row?: OtherFeeRow; backTo: string }) {
  const router = useRouter();
  const existing = useMemo(() => new Map((row?.lines ?? []).map((l) => [l.classId, l])), [row]);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries((row?.lines ?? []).map((l) => [l.classId, String(l.amount)])));
  const [ticked, setTicked] = useState<Set<string>>(() => new Set((row?.lines ?? []).map((l) => l.classId)));
  const [bulk, setBulk] = useState("");
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const applyAll = () => {
    if (!bulk) return;
    const next = { ...amounts };
    const targets = ticked.size ? [...ticked] : classes.map((c) => c.id);
    for (const id of targets) if (!existing.get(id)?.billed) next[id] = bulk;
    setAmounts(next);
    if (!ticked.size) setTicked(new Set(classes.map((c) => c.id)));
  };
  const lines = [...ticked].map((classId) => ({ classId, amount: Number(amounts[classId] || 0) }));
  const billedAny = (row?.lines ?? []).some((l) => l.billed > 0);

  return (
    <ActionForm action={saveOtherFeeAction} extra={{ id: row?.id, lines: JSON.stringify(lines) }} successMessage="@result" submitLabel={row ? "Save changes" : "Add fee"}
      redirectTo={backTo} cancel={<Button type="button" variant="secondary" onClick={() => router.push(backTo)}>Cancel</Button>}>
      <div className="space-y-5">
        <Field label="Fee name" required hint="e.g. Miscellaneous Fee, ID Card Fee, Annual Day Fee. Shown on student accounts, receipts and the parent app.">
          <Input name="name" defaultValue={row?.name} maxLength={80} required />
        </Field>
        <Field label="Charged for" required hint="Annual fees are billed with Term 1 dues.">
          <Select name="termId" defaultValue={row ? row.termId ?? "ANNUAL" : "ANNUAL"}>
            <option value="ANNUAL">Annual (whole year)</option>
            {terms.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Due date" required><Input name="dueDate" type="date" defaultValue={row?.dueDate ?? today} required /></Field>
        <Field label="Instalments" hint="Split into equal parts due every 30 days"><Input name="instalments" type="number" min="1" max="12" defaultValue={row?.instalments ?? 1} /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <input type="hidden" name="lateFeeApplies" value="false" />
          <Checkbox name="lateFeeApplies" value="true" label="Late fee applies after the due date" defaultChecked={row?.lateFeeApplies ?? false} />
          <input type="hidden" name="isActive" value="false" />
          <Checkbox name="isActive" value="true" label="Active" defaultChecked={row?.isActive ?? true} />
        </div>

        <Field label="Classes and amount" required hint="Tick each class that pays this fee and enter its amount per student.">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input type="number" min="1" step="0.01" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Same amount (₹)" className="w-44" />
            <Button type="button" size="sm" variant="secondary" onClick={applyAll}>{ticked.size ? "Apply to ticked classes" : "Apply to all classes"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set(classes.map((c) => c.id)))}>Tick all</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTicked(new Set([...ticked].filter((id) => existing.get(id)?.billed)))}>Clear</Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            {classes.map((c) => {
              const on = ticked.has(c.id);
              const billed = existing.get(c.id)?.billed ?? 0;
              return (
                <div key={c.id} className="flex items-center gap-3 border-b border-line/60 px-3 py-2 last:border-0">
                  <Checkbox label={c.name} checked={on} disabled={billed > 0} onChange={() => toggle(c.id)} className="w-40 shrink-0" />
                  <Input type="number" min="1" step="0.01" placeholder="Amount (₹)" className="w-40" disabled={!on || billed > 0}
                    value={amounts[c.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} required={on} />
                  {billed > 0 && <span className="text-xs text-amber-700">Dues generated for {billed} student{billed === 1 ? "" : "s"} — amount locked</span>}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-slate-500">{ticked.size} class{ticked.size === 1 ? "" : "es"} ticked</p>
        </Field>

        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Saving adds this fee to the Fee structure — no student is billed yet. Students get it when dues are generated
          (Fee structure → Generate dues, or automatically when a term starts).{billedAny ? " Classes already billed keep their amount; only the due date changes for them." : ""}
        </p>
      </div>
    </ActionForm>
  );
}
