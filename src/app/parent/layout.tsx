import { requireUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/settings";
import { PortalShell, type PortalNav } from "@/components/layout/portal-shell";

const NAV: PortalNav[] = [
  { href: "/parent", key: "nav.home", icon: "Home" },
  { href: "/parent/fees", key: "nav.fees", icon: "IndianRupee" },
  { href: "/parent/uniforms", key: "nav.uniformOrders", icon: "Shirt" },
  { href: "/parent/attendance", key: "att.title", icon: "CalendarCheck" },
  { href: "/parent/bus", key: "nav.bus", icon: "Bus" },
  { href: "/parent/circulars", key: "parent.circulars", icon: "Megaphone" },
  { href: "/parent/settings", key: "parent.preferences", icon: "Settings" },
];

export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!user.permissions.includes("parent.portal")) redirect("/");
  const school = await getSetting("school", user.branchId);
  return <PortalShell nav={NAV} title={school.name} userName={user.name} idleMinutes={user.idleMinutes} notificationsHref="/parent/notifications">{children}</PortalShell>;
}
