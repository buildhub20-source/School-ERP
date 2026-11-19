"use client";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { Field, Input, Textarea } from "@/components/ui";
import { leaveSchool, rejoin } from "../actions";
import type { LeaveCheck } from "@/server/students/service";

export function LeaveSchoolButton({ id, checks, today }: { id: string; checks: LeaveCheck; today: string }) {
  return (
    <ModalForm trigger="Leaves school" triggerVariant="danger" title="Student leaves school" action={leaveSchool} extra={{ id }} submitLabel="Confirm" successMessage="Student marked as left">
      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-medium">Before leaving</p>
        <p>Pending dues: {checks.pendingDues > 0 ? <b className="text-rose-700">₹{checks.pendingDues.toLocaleString("en-IN")} ({checks.pendingCount} items)</b> : "None"}</p>
        <p>Open uniform orders: {checks.openOrders.length ? <b className="text-amber-700">{checks.openOrders.map((o) => `${o.orderNo} (${o.status.toLowerCase()})`).join(", ")}</b> : "None"}</p>
        <p>Bus seat: {checks.allocation ? <b>{checks.allocation.busNo}, {checks.allocation.stop} — will be freed</b> : "None"}</p>
        <p className="text-xs text-slate-500">Unpaid fees for later terms will be cancelled. Staff are notified about pending dues and orders.</p>
      </div>
      <Field label="Leaving date" required><Input type="date" name="leftOn" defaultValue={today} required /></Field>
      <Field label="Reason" required><Textarea name="reason" required rows={2} /></Field>
    </ModalForm>
  );
}

export function RejoinButton({ id }: { id: string }) {
  return <ActionButton action={rejoin} args={{ id }} confirm="Mark this student as active again?" successMessage="Student is active again">Rejoin</ActionButton>;
}
