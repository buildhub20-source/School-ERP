export default function Offline() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">You are offline</h1>
        <p className="mt-1 text-sm text-slate-500">Check your internet connection. Drivers can still open the saved emergency contact sheet.</p>
        <a href="/driver/emergency" className="mt-4 inline-block text-sm font-medium text-brand-700">Open emergency sheet</a>
      </div>
    </div>
  );
}
