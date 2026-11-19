import Link from "next/link";
import { Phone, UserCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { activeTrip, staffBus } from "@/server/transport/trips";
import { Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { TripControls } from "./trip-controls";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.route") };
}
export const dynamic = "force-dynamic";

export default async function DriverHome() {
  const user = await requireUser("driver.portal");
  const { t } = await getT();
  const { staff, bus } = await staffBus(user.id);
  if (!staff || !bus) {
    return <Card><CardBody><p className="text-center text-slate-600">{!staff ? t("driver.notLinked") : t("driver.notAssigned")} {t("driver.contactOffice")}</p></CardBody></Card>;
  }
  const [trip, full] = await Promise.all([
    activeTrip(bus.id),
    db.bus.findUniqueOrThrow({ where: { id: bus.id }, include: { driver: true, attendant: true, routes: { where: { isActive: true }, include: { stops: { orderBy: { sequence: "asc" }, include: { _count: { select: { allocations: { where: { status: "ACTIVE", busId: bus.id } } } } } } } } } }),
  ]);
  const students = await db.transportAllocation.count({ where: { busId: bus.id, status: "ACTIVE" } });
  const partner = staff.type === "DRIVER" ? full.attendant : full.driver;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xl font-bold text-slate-900">{bus.busNo}</p>
              <p className="text-sm text-slate-500">{bus.registrationNo} · <span className="whitespace-nowrap">{students} {t("driver.students").toLowerCase()} / {bus.capacity}</span></p>
            </div>
            {partner && <a href={`tel:${partner.phone}`} className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm"><Phone className="size-4" /><span>{staff.type === "DRIVER" ? t("parent.attendant") : t("parent.driver")}<span className="block text-xs text-slate-500">{partner.name}</span></span></a>}
          </div>
          <TripControls trip={trip ? { id: trip.id, type: trip.type, startedAt: trip.startedAt.toISOString() } : null} />
          {trip && <LinkButton href="/driver/attendance" variant="secondary" size="lg" className="h-14 w-full text-base"><UserCheck className="size-5" />{t("nav.attendance")}</LinkButton>}
        </CardBody>
      </Card>
      {full.routes.length === 0 && <Card><CardBody><p className="text-center text-sm text-slate-500">{t("driver.noRoute")}</p></CardBody></Card>}
      {full.routes.map((r) => (
        <Card key={r.id}>
          <CardHeader title={`${r.code} · ${r.name}`} />
          <ol className="divide-y divide-slate-100">
            {r.stops.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-sm font-semibold text-ink tabular-nums">{s.sequence}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{t("parent.pickup")} {s.pickupTime ?? "—"} · {t("parent.drop")} {s.dropTime ?? "—"}</p>
                </div>
                <span className="text-sm text-slate-600">{s._count.allocations}</span>
                {s.lat !== null && s.lng !== null && <Link href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" className="text-xs text-brand-700">{t("driver.map")}</Link>}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
