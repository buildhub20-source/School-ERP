"use client";
import { ModalForm } from "@/components/ui/client";
import type { ActionResult } from "@/lib/action";

/** ModalForm that opens the created record afterwards (`redirectBase` + returned id) — usable from server pages. */
export function CreateModal({ redirectBase, ...props }: Omit<React.ComponentProps<typeof ModalForm<{ id: string }>>, "redirectTo" | "action"> & { redirectBase: string; action: (input: FormData | Record<string, unknown>) => Promise<ActionResult<{ id: string }>> }) {
  return <ModalForm<{ id: string }> {...props} redirectTo={(d) => `${redirectBase}${d.id}`} />;
}
