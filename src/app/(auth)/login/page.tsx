import { redirect } from "next/navigation";
import { getUser, homePathFor } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { getT } from "@/lib/i18n/server";
import { LoginForms } from "./login-forms";
import { School } from "lucide-react";

export const metadata = { title: "Sign in" };

/** Faint grid lines, used behind the panel (fading out from the centre) and inside the glass. */
const grid = (size: number, alpha: number) => ({
  backgroundImage: `linear-gradient(rgb(255 255 255 / ${alpha}) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / ${alpha}) 1px, transparent 1px)`,
  backgroundSize: `${size}px ${size}px`,
});

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; twofa?: string }> }) {
  const user = await getUser();
  const sp = await searchParams;
  if (user) redirect(homePathFor(user));
  const school = await getSetting("school");
  const { t, lang } = await getT();
  return (
    // Always the dark palette here: the panel sits on a photo, so light text on dark glass reads in both themes.
    <div className="dark relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0b0d16] px-4 py-10 text-white">
      {/* Background: school photo (public/images/login-school.png). A light blur hides upscaling and lifts the glass panel. */}
      <div aria-hidden className="absolute inset-0 -z-30 scale-110 bg-cover bg-center blur-[2px]" style={{ backgroundImage: "url(/images/login-school.png)" }} />
      <div aria-hidden className="absolute inset-0 -z-20 bg-gradient-to-b from-[#0b0d16]/60 via-[#0b0d16]/35 to-[#0b0d16]/80" />
      {/* Grid that glows around the centre and fades towards the edges */}
      <div aria-hidden className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_65%)]" style={grid(44, 0.09)} />
      <div aria-hidden className="absolute left-1/2 top-1/2 -z-10 size-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-300/15 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Glass panel */}
        <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-white/[0.07] p-6 shadow-[0_24px_80px_-20px_rgb(0_0_0/0.7),inset_0_1px_0_rgb(255_255_255/0.18)] backdrop-blur-2xl backdrop-saturate-150 sm:p-8">
          <div aria-hidden className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" style={grid(22, 0.06)} />
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-white/20 blur-3xl" />

          <div className="relative">
            <div className="mb-6 flex flex-col items-center text-center">
              {school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={school.logoUrl} alt="" className="mb-3 size-16 rounded-2xl bg-white/90 object-contain p-1.5 shadow-lg" />
              ) : (
                <div className="mb-3 grid size-14 place-items-center rounded-2xl border border-white/20 bg-white/10 text-brand-300 shadow-lg backdrop-blur"><School className="size-7" strokeWidth={1.75} /></div>
              )}
              <h1 className="text-balance text-xl font-semibold leading-snug text-white sm:text-2xl">{school.name}</h1>
              <p className="mt-1 text-sm text-white/65">{t("appName")}</p>
            </div>
            {sp.expired && <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-sm text-amber-100">You were signed out after a period of inactivity.</p>}
            {sp.twofa && <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-sm text-amber-100">Two-step verification was not completed (too many wrong codes or it took too long). Please sign in again.</p>}
            <LoginForms next={sp.next} lang={lang} />
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-white/55 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">Secure sign-in · {school.name}</p>
      </div>
    </div>
  );
}
