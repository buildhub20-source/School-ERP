"use client";
import { useState } from "react";
import { Button, Input, Textarea, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { ActionButton, useAction } from "@/components/ui/client";
import { approveReq, approveAndIssue, rejectReq, issueReq } from "../../actions";

type L = { id: string; name: string; unit: string; qtyRequested: number; currentStock: number };

/** Per-line approval: reduce a quantity for a partial approval, 0 drops the line. */
export function ApproveForm({ id, lines, canIssue }: { id: string; lines: L[]; canIssue: boolean }) {
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(Math.min(l.qtyRequested, Math.max(l.currentStock, 0)) || l.qtyRequested)])));
  const [remarks, setRemarks] = useState("");
  const approve = useAction(approveReq, { successMessage: (d: { status: string }) => (d.status === "APPROVED" ? "Request approved" : "Request partly approved") });
  const both = useAction(approveAndIssue, { successMessage: "Approved and issued. Stock deducted." });
  const payload = () => ({ id, remarks: remarks || undefined, lines: JSON.stringify(lines.map((l) => ({ lineId: l.id, qty: Number(qty[l.id] || 0) }))) });
  const partial = lines.some((l) => Number(qty[l.id] || 0) < l.qtyRequested);
  return (
    <div className="space-y-4">
      <Table>
        <THead><tr><TH>Item</TH><TH align="right">Requested</TH><TH align="right">In stock</TH><TH align="right">Approve</TH></tr></THead>
        <TBody>
          {lines.map((l) => {
            const v = Number(qty[l.id] || 0);
            return (
              <TR key={l.id} highlight={v > l.currentStock ? "red" : v < l.qtyRequested ? "yellow" : undefined}>
                <TD className="font-medium text-slate-900">{l.name}</TD>
                <TD align="right">{l.qtyRequested} {l.unit}</TD>
                <TD align="right" className={l.currentStock < l.qtyRequested ? "text-rose-700" : ""}>{l.currentStock}</TD>
                <TD align="right"><Input type="number" min={0} max={l.qtyRequested} step={1} inputMode="numeric" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className="ml-auto w-24 text-right" aria-label={`Approve quantity for ${l.name}`} /></TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700">Remarks for the teacher (optional)</label>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} maxLength={500} placeholder={partial ? "e.g. Reduced due to limited stock" : ""} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton action={rejectReq} args={{ id }} reason reasonLabel="Reason for rejecting" confirm="Reject this request?" variant="danger" size="md" successMessage="Request rejected">Reject</ActionButton>
        <Button variant="secondary" loading={approve.pending} onClick={() => approve.run(payload())}>{partial ? "Partly approve" : "Approve"}</Button>
        {canIssue && <Button variant="primary" loading={both.pending} onClick={() => both.run(payload())}>{partial ? "Partly approve" : "Approve"} &amp; issue</Button>}
      </div>
    </div>
  );
}

export function IssueButton({ id }: { id: string }) {
  return <ActionButton action={issueReq} args={{ id }} confirm="Issue the approved quantities now? Stock will be deducted." variant="primary" size="md" successMessage="Issued. Stock deducted and the teacher notified.">Issue items</ActionButton>;
}

export function RejectButton({ id }: { id: string }) {
  return <ActionButton action={rejectReq} args={{ id }} reason reasonLabel="Reason for rejecting" confirm="Reject this request?" variant="danger" size="md" successMessage="Request rejected">Reject</ActionButton>;
}
