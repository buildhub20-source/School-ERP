import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { emergencySheet, staffBus } from "@/server/transport/trips";
import { SheetView } from "./sheet-view";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.emergency") };
}
export const dynamic = "force-dynamic";

export default async function DriverEmergency() {
  const user = await requireUser("driver.portal");
  const { t } = await getT();
  const { bus } = await staffBus(user.id);
  const sheet = bus ? await emergencySheet(bus.id) : null;
  return (
    <>
      <h1 className="mb-3 text-lg font-semibold">{t("driver.emergencyTitle")}</h1>
      {!bus && <p className="mb-3 text-sm text-slate-500">{t("driver.notAssignedShort")}</p>}
      <SheetView initial={sheet} />
    </>
  );
}
