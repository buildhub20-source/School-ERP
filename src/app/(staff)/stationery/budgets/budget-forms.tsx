"use client";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { Field, Input, Select } from "@/components/ui";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { saveBudgetAction, deleteBudgetAction } from "../actions";

type Opt = { id: string; name: string };

export function BudgetFormButton({ yearId, yearName, classes, departments, budget }: { yearId: string; yearName: string; classes: Opt[]; departments: Opt[]; budget?: { id: string; target: string; amount: number; name: string } }) {
  return (
    <ModalForm trigger={budget ? "" : "Set budget"} icon={budget ? <Pencil className="size-4" /> : <Plus className="size-4" />} triggerVariant={budget ? "ghost" : "primary"} triggerSize={budget ? "sm" : "md"}
      title={budget ? `Budget: ${budget.name}` : `New budget for ${yearName}`} description="Yearly stationery limit. Spend = issued quantity × unit cost, less returns." action={saveBudgetAction}
      extra={{ id: budget?.id, academicYearId: yearId, ...(budget ? { target: budget.target } : {}) }} successMessage="Budget saved">
      {!budget && (
        <Field label="Class or department" required>
          <Select name="target" required placeholder="Choose…">
            <optgroup label="Classes">{classes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label="Departments">{departments.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}</optgroup>
          </Select>
        </Field>
      )}
      <Field label="Yearly limit (₹)" required><Input name="amount" type="number" min={1} step="0.01" defaultValue={budget?.amount} required /></Field>
    </ModalForm>
  );
}

export function DeleteBudgetButton({ id }: { id: string }) {
  return <ActionButton action={deleteBudgetAction} args={{ id }} confirm="Remove this budget? Spend history is kept." variant="ghost" successMessage="Budget removed" title="Remove"><Trash2 className="size-4" /></ActionButton>;
}
