import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { activeTrip, staffBus, tripRoster } from "@/server/transport/trips";
import { Card, CardBody, LinkButton } from "@/components/ui";
import { Roster } from "./roster";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.attendance") };
}
export const dynamic = "force-dynamic";

export default async function DriverAttendance() {
  const user = await requireUser("driver.portal");
  const { t } = await getT();
  const { bus } = await staffBus(user.id);
  if (!bus) return <Card><CardBody><p className="text-center text-slate-600">{t("driver.notAssigned")}</p></CardBody></Card>;
  const trip = await activeTrip(bus.id);
  if (!trip) {
    return (
      <Card><CardBody className="space-y-4 text-center">
        <p className="text-slate-600">{t("driver.startTripHint")}</p>
        <LinkButton href="/driver" variant="primary" size="lg" className="h-14 w-full">{t("driver.startTrip")}</LinkButton>
      </CardBody></Card>
    );
  }
  const rows = await tripRoster(bus.id, trip.id);
  return (
    <>
      <h1 className="mb-2 text-lg font-semibold">{bus.busNo} · {trip.type === "PICKUP" ? t("driver.pickupTrip") : t("driver.dropTrip")}</h1>
      <Roster tripId={trip.id} tripType={trip.type} rows={rows.map((r) => ({ ...r, last: r.last ? { event: r.last.event, at: r.last.at.toISOString() } : null }))} />
    </>
  );
}
