"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Field, cn } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { requestOtp, setGuestLanguage, staffLogin, verifyOtpLogin } from "../actions";

const glassInput = "h-11 border-white/15! bg-black/20! text-white! placeholder:text-white/40! backdrop-blur-sm hover:border-white/30! focus:border-brand-300! focus:bg-black/30!";

export function LoginForms({ next, lang }: { next?: string; lang: string }) {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<"staff" | "otp">("staff");
  const [staffState, staffAction, staffPending] = useActionState(staffLogin, null);
  const [otpReq, otpReqAction, otpReqPending] = useActionState(requestOtp, null);
  const [otpVer, otpVerAction, otpVerPending] = useActionState(verifyOtpLogin, null);
  const [phone, setPhone] = useState("");

  useEffect(() => { if (staffState?.ok && staffState.next) router.replace(staffState.next); }, [staffState, router]);
  useEffect(() => { if (otpVer?.ok && otpVer.next) router.replace(otpVer.next); }, [otpVer, router]);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 rounded-full border border-white/10 bg-white/[0.06] p-1 text-sm font-medium">
        {(["staff", "otp"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-full py-2 transition-colors duration-150", tab === k ? "bg-brand-300 text-on-brand shadow-[0_4px_14px_-4px_rgb(233_201_95/0.6)]" : "text-white/70 hover:text-white")}>
            {k === "staff" ? t("auth.staffLogin") : t("auth.parentLogin")}
          </button>
        ))}
      </div>

      {tab === "staff" ? (
        <form action={staffAction} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label={t("auth.email")}><Input name="login" autoComplete="username" required autoFocus className={glassInput} placeholder="you@school.in" /></Field>
          <Field label={t("auth.password")}><Input name="password" type="password" autoComplete="current-password" required className={glassInput} placeholder="••••••••" /></Field>
          {staffState && !staffState.ok && <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{staffState.error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={staffPending}>{t("auth.signIn")}</Button>
        </form>
      ) : !otpReq?.ok ? (
        <form action={otpReqAction} className="space-y-4">
          <Field label={t("auth.mobile")} hint="We will send a one-time password by SMS.">
            <Input name="phone" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus className={glassInput} />
          </Field>
          {otpReq && !otpReq.ok && <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{otpReq.error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={otpReqPending}>{t("auth.sendOtp")}</Button>
        </form>
      ) : (
        <form action={otpVerAction} className="space-y-4">
          <input type="hidden" name="phone" value={phone} />
          <p className="text-sm text-white/75">If <b>{phone}</b> is registered, an OTP has been sent to it.</p>
          {otpReq.devOtp && <p className="rounded-lg bg-violet-400/15 px-3 py-2 text-xs text-violet-200">Sandbox mode (no SMS provider configured): your OTP is <b className="font-mono">{otpReq.devOtp}</b></p>}
          <Field label={t("auth.otp")}><Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className={cn(glassInput, "tracking-[0.4em] text-center font-mono")} /></Field>
          {otpVer && !otpVer.ok && <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{otpVer.error}</p>}
          <Button type="submit" className="w-full" size="lg" loading={otpVerPending}>{t("auth.verify")}</Button>
          <button type="button" className="w-full text-center text-sm text-brand-300 hover:underline" onClick={() => location.reload()}>Use a different number</button>
        </form>
      )}

      <div className="mt-6 flex justify-center gap-3 border-t border-white/10 pt-5 text-xs text-white/60">
        {[{ c: "en", l: "English" }, { c: "ta", l: "தமிழ்" }].map((l) => (
          <button key={l.c} type="button" className={cn("rounded-full px-2.5 py-1 hover:text-white", lang === l.c && "bg-white/10 font-semibold text-brand-300")} onClick={async () => { await setGuestLanguage(l.c); router.refresh(); }}>{l.l}</button>
        ))}
      </div>
    </div>
  );
}
