import { redirect } from "next/navigation";
import { getPendingTwoFactorUser } from "@/lib/auth/session";
import { TwoFactorForm } from "./two-factor-form";
import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Two-step verification" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getPendingTwoFactorUser();
  if (!user) redirect("/login");
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><ShieldCheck className="size-6" /></div>
        <TwoFactorForm next={next} name={user.name} />
      </div>
    </div>
  );
}
