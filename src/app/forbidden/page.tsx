import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600"><ShieldAlert className="size-6" /></div>
        <h1 className="text-lg font-semibold">You don't have access to this page</h1>
        <p className="mt-1 text-sm text-slate-500">Your role does not include this permission. Ask the Super Admin if you need it.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Go to my home page</Link>
      </div>
    </div>
  );
}
