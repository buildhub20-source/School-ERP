import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { REPORTS, canSeeReport } from "@/lib/reports/registry";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { FileBarChart, ChevronRight } from "lucide-react";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireUser(["reports.fees", "reports.stationery", "reports.uniforms", "reports.transport", "reports.students", "reports.library", "reports.assets", "reports.hostel", "reports.hr"]);
  const visible = REPORTS.filter((r) => canSeeReport(user, r));
  const modules = [...new Set(visible.map((r) => r.module))];
  return (
    <>
      <PageHeader title="Reports" description="Filter by date, class, item or route, then export to PDF or Excel. A summary is also emailed to the principal every Monday and at month-end." />
      {visible.length === 0 && <EmptyState title="No reports available" description="Your role has no report permissions." />}
      <div className="space-y-6">
        {modules.map((m) => (
          <section key={m}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{m}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.filter((r) => r.module === m).map((r) => (
                <Link key={r.key} href={`/reports/${r.key}`}>
                  <Card className="flex h-full items-start gap-3 p-4 transition hover:border-brand-300 hover:shadow">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><FileBarChart className="size-4" /></div>
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{r.title}</p><p className="mt-0.5 text-xs text-slate-500">{r.description}</p></div>
                    <ChevronRight className="size-4 text-slate-400" />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
