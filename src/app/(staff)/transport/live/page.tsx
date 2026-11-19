import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { liveBuses } from "@/server/transport/trips";
import { ROUTE_COLORS } from "@/server/transport/helpers";
import { PageHeader } from "@/components/ui";
import { LiveView } from "./live-view";

export const metadata = { title: "Live tracking" };
export const dynamic = "force-dynamic";

export default async function LivePage() {
  const user = await requireUser("transport.view");
  const [buses, routes] = await Promise.all([
    liveBuses(user.branchId),
    db.route.findMany({ where: { branchId: user.branchId, isActive: true }, include: { stops: { where: { lat: { not: null } }, orderBy: { sequence: "asc" } } }, orderBy: { code: "asc" } }),
  ]);
  const lines = routes.filter((r) => r.stops.length > 1).map((r, i) => ({ id: r.id, color: ROUTE_COLORS[i % ROUTE_COLORS.length], points: r.stops.map((s) => [s.lat!, s.lng!] as [number, number]), dashed: true }));
  return (
    <>
      <PageHeader title="Live tracking" description="Last known location of every bus; green = trip running." breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Live" }]} />
      <LiveView initial={buses} stops={lines} />
    </>
  );
}
