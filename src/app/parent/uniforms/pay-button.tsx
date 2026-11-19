"use client";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { parentPayAction } from "./actions";

export function PayOnlineButton({ orderId, label }: { orderId: string; label: string }) {
  const { run, pending } = useAction(parentPayAction, { refresh: false, onSuccess: (d) => { window.location.href = d.checkoutUrl; } });
  return <Button size="sm" loading={pending} onClick={() => run({ orderId })}><CreditCard className="size-4" />{label}</Button>;
}
