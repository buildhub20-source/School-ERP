"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
      <p className="font-semibold">Something went wrong loading this page.</p>
      <p className="mt-1 text-rose-700">{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      <button onClick={reset} className="mt-3 rounded-md bg-white px-3 py-1.5 font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">Try again</button>
    </div>
  );
}
