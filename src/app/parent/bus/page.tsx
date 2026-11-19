import { requireParent } from "@/server/parent";
import { parentBusInfo } from "@/server/transport/trips";
import { getT } from "@/lib/i18n/server";
import { fullName } from "@/lib/format";
import { Card, CardBody } from "@/components/ui";
import { BusCard } from "./bus-card";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.bus") };
}
export const dynamic = "force-dynamic";

export default async function ParentBusPage() {
  const { children } = await requireParent();
  const { t } = await getT();
  const infos = await Promise.all(children.map(async (c) => ({ child: c, info: await parentBusInfo(c.id) })));
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("nav.bus")}</h1>
      {children.length === 0 && <Card><CardBody><p className="text-center text-sm text-slate-500">{t("parent.noChildrenAccount")}</p></CardBody></Card>}
      {infos.map(({ child, info }) => info
        ? <BusCard key={child.id} studentId={child.id} childName={fullName(child)} initial={info} />
        : <Card key={child.id}><CardBody><p className="text-sm"><b>{fullName(child)}</b> <span className="text-slate-500">{t("parent.noTransport")}</span></p></CardBody></Card>)}
    </div>
  );
}
