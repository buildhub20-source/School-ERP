"use client";
import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Modal } from "./modal";
import { ActionForm } from "./action-form";
import type { ActionResult } from "@/lib/action";

/** Button that opens a modal containing an ActionForm. */
export function ModalForm<T>({ trigger, triggerVariant = "primary", triggerSize = "md", title, description, action, children, submitLabel = "Save", successMessage = "Saved", size = "md", extra, onSuccess, redirectTo, icon, disabled }: {
  trigger: React.ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  title: string;
  description?: string;
  action: (input: FormData | Record<string, unknown>) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string | ((d: T) => string);
  size?: "sm" | "md" | "lg" | "xl";
  extra?: Record<string, string | number | boolean | undefined>;
  onSuccess?: (d: T) => void;
  redirectTo?: string | ((d: T) => string);
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)} disabled={disabled}>{icon}{trigger}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        {open && (
          <ActionForm action={action} submitLabel={submitLabel} successMessage={successMessage} extra={extra} redirectTo={redirectTo}
            onSuccess={(d) => { setOpen(false); onSuccess?.(d); }}
            cancel={<Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>}>
            {children}
          </ActionForm>
        )}
      </Modal>
    </>
  );
}
