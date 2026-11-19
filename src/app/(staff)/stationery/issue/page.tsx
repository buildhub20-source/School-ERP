import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions, departmentOptions, staffOptions } from "@/server/lookups";
import { itemOptions, studentOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { IssueForm } from "./issue-form";
import { MovementTable, movementInclude } from "../_components/movement-table";

export const metadata = { title: "Issue / return stationery" };

export default async function IssuePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.manage");
  const s = await searchParams;
  const [items, classes, departments, staff, students, recent] = await Promise.all([
    itemOptions(user.branchId), classOptions(user.branchId), departmentOptions(user.branchId), staffOptions(user.branchId), studentOptions(user.branchId),
    db.stockMovement.findMany({ where: { item: { branchId: user.branchId }, type: { in: ["ISSUE", "RETURN", "DAMAGE", "LOSS", "ADJUSTMENT"] }, requestId: null, kitId: null }, include: movementInclude, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const kind = ["ISSUE", "RETURN", "DAMAGE", "LOSS", "ADJUST_IN", "ADJUST_OUT"].includes(s.kind) ? s.kind : "ISSUE";
  return (
    <>
      <PageHeader title="Issue, returns, damage & loss" description="Every movement records the recipient, who recorded it and when." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Issue / return" }]}
        actions={<><LinkButton href="/stationery/kits">Issue a class kit</LinkButton><LinkButton href="/stationery/requests?status=APPROVED">Approved requests</LinkButton></>} />
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Record a movement" />
          <CardBody>
            <IssueForm defaultKind={kind} items={items} classes={classes.map((c) => ({ id: c.id, name: c.name }))} departments={departments.map((d) => ({ id: d.id, name: d.name }))} staff={staff.map((u) => ({ id: u.id, name: u.name }))} students={students} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader title="Recent direct movements" actions={<LinkButton href="/stationery/movements" size="sm">Full log</LinkButton>} />
          <MovementTable rows={recent} />
        </Card>
      </div>
    </>
  );
}
