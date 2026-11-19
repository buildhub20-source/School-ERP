"use client";
import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Modal } from "./modal";
import { Textarea } from "./form";
import { useAction } from "./action-form";
import type { ActionResult } from "@/lib/action";

/** A button that runs a server action with fixed arguments, optionally after confirmation and/or asking for a reason. */
export function ActionButton<T>({ action, args, children, variant = "secondary", size = "sm", confirm, reason, reasonLabel = "Reason", successMessage = "Done", onSuccess, className, disabled, title }: {
  action: (input: Record<string, unknown>) => Promise<ActionResult<T>>;
  args: Record<string, unknown>;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  confirm?: string;
  reason?: boolean | "optional";
  reasonLabel?: string;
  successMessage?: string | ((d: T) => string);
  onSuccess?: (d: T) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { run, pending } = useAction(action, { successMessage, onSuccess });
  const needsDialog = !!confirm || !!reason;
  const go = async () => {
    const res = await run({ ...args, ...(reason ? { reason: text } : {}) });
    if (res.ok) {
      setOpen(false);
      setText("");
    }
  };
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} loading={pending && !needsDialog} disabled={disabled} title={title} onClick={() => (needsDialog ? setOpen(true) : go())}>
        {children}
      </Button>
      {needsDialog && (
        <Modal open={open} onClose={() => setOpen(false)} title={confirm ?? "Confirm"} size="sm"
          footer={<>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={variant === "danger" ? "danger" : "primary"} loading={pending} disabled={reason === true && !text.trim()} onClick={go}>Confirm</Button>
          </>}>
          {reason ? (
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink">{reasonLabel}{reason === true && <span className="text-rose-500"> *</span>}</label>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            </div>
          ) : <p className="text-sm text-muted">Are you sure?</p>}
        </Modal>
      )}
    </>
  );
}
