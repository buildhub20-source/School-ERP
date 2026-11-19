import { requireUser } from "@/lib/auth/session";
import { classOptions, staffOptions } from "@/server/lookups";
import { PageHeader, Card, CardBody, LinkButton } from "@/components/ui";
import { QrCode } from "lucide-react";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan in / out" };

export default async function ScanPage() {
  const user = await requireUser("stationery.manage");
  const [staff, classes] = await Promise.all([staffOptions(user.branchId), classOptions(user.branchId)]);
  return (
    <>
      <PageHeader title="Scan in / out" description="Scan an item's QR or barcode label with the phone camera, then add or remove stock." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Scan" }]}
        actions={<LinkButton href="/api/stationery/labels" target="_blank"><QrCode className="size-4" />Print labels</LinkButton>} />
      <Card><CardBody><Scanner staff={staff.map((s) => ({ id: s.id, name: s.name }))} classes={classes.map((c) => ({ id: c.id, name: c.name }))} /></CardBody></Card>
    </>
  );
}
