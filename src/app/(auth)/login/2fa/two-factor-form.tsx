"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { verifyTwoFactor, logout } from "../../actions";

export function TwoFactorForm({ next, name }: { next?: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(verifyTwoFactor, null);
  useEffect(() => { if (state?.next) router.replace(state.next); }, [state, router]);
  return (
    <>
      <h1 className="text-lg font-semibold">{t("auth.twoFactor")}</h1>
      <p className="mb-4 mt-1 text-sm text-slate-500">Hi {name}. {t("auth.enterCode")}.</p>
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="text-center font-mono tracking-[0.4em]" />
        {state && !state.ok && <p className="text-sm text-rose-600">{state.error}</p>}
        <Button type="submit" className="w-full" loading={pending}>{t("auth.verify")}</Button>
      </form>
      <form action={logout} className="mt-3 text-center"><button className="text-sm text-slate-500 hover:underline">Cancel</button></form>
    </>
  );
}
