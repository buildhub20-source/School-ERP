import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { PortalShell, type PortalNav } from "@/components/layout/portal-shell";
import { activeTrip, staffBus } from "@/server/transport/trips";
import { GpsSharer } from "./gps-sharer";

const NAV: PortalNav[] = [
  { href: "/driver", key: "nav.route", icon: "Route" },
  { href: "/driver/attendance", key: "nav.attendance", icon: "UserCheck" },
  { href: "/driver/emergency", key: "nav.emergency", icon: "Siren" },
  { href: "/driver/settings", key: "parent.preferences", icon: "Settings" },
];

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.permissions.includes("driver.portal")) redirect("/");
  const [school, { bus }] = await Promise.all([getSetting("school", user.branchId), staffBus(user.id)]);
  const trip = bus ? await activeTrip(bus.id) : null;
  return (
    <PortalShell nav={NAV} title={bus ? `${bus.busNo} · ${school.name}` : school.name} userName={user.name} idleMinutes={Math.max(user.idleMinutes, 240)} notificationsHref="/driver/notifications">
      {trip && <GpsSharer tripId={trip.id} />}
      {children}
    </PortalShell>
  );
}
