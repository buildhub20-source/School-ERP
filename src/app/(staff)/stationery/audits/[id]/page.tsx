import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, StatusBadge } from "@/components/ui";
import { fmtDateTime, toNum } from "@/lib/format";
import { CountSheet } from "../audit-forms";
import { MovementTable, movementInclude } from "../../_components/movement-table";

export const metadata = { title: "Stock audit" };

export default async function AuditDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stationery.view");
  const { id } = await params;
  const audit = await db.stockAudit.findFirst({ where: { id, branchId: user.branchId }, include: { lines: { include: { item: true }, orderBy: [{ item: { category: "asc" } }, { item: { name: "asc" } }] } } });
  if (!audit) notFound();
  const moves = audit.status === "COMPLETED" ? await db.stockMovement.findMany({ where: { auditId: id }, include: movementInclude, orderBy: { createdAt: "asc" } }) : [];
  const editable = audit.status === "IN_PROGRESS" && hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title={`Stock audit ${audit.auditNo}`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Audits", href: "/stationery/audits" }, { label: audit.auditNo }]}
        description={<>Started {fmtDateTime(audit.createdAt)}{audit.completedAt && ` · completed ${fmtDateTime(audit.completedAt)}`} · <StatusBadge status={audit.status} />{audit.notes && ` · ${audit.notes}`}</>} />
      <Card>
        <CardHeader title="Count sheet" description={editable ? "System quantities are the stock when the audit started. Leave a line blank to skip it. Red = less found, amber = more found." : undefined} />
        <CardBody>
          <CountSheet id={audit.id} editable={editable} lines={audit.lines.map((l) => ({ id: l.id, name: l.item.name, code: l.item.code, category: l.item.category, unit: l.item.unit, systemQty: l.systemQty, countedQty: l.countedQty, note: l.note, unitCost: toNum(l.item.unitCost) }))} />
        </CardBody>
      </Card>
      {moves.length > 0 && <Card className="mt-5"><CardHeader title="Adjustments posted" /><MovementTable rows={moves} /></Card>}
    </>
  );
}
