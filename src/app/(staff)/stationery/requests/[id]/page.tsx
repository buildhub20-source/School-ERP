import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, StatusBadge } from "@/components/ui";
import { fmtDateTime, money, toNum } from "@/lib/format";
import { ApproveForm, IssueButton, RejectButton } from "./approve-form";
import { MovementTable, movementInclude } from "../../_components/movement-table";

export const metadata = { title: "Stationery request" };

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["stationery.view", "stationery.approve"]);
  const { id } = await params;
  const r = await db.stationeryRequest.findFirst({
    where: { id, branchId: user.branchId },
    include: { requestedBy: { include: { department: true } }, approvedBy: true, issuedBy: true, schoolClass: true, department: true, lines: { include: { item: true } } },
  });
  if (!r) notFound();
  const moves = await db.stockMovement.findMany({ where: { requestId: id }, include: movementInclude, orderBy: { createdAt: "asc" } });
  const canApprove = hasPerm(user, "stationery.approve");
  const own = r.requestedById === user.id;
  const approved = r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED";
  const value = r.lines.reduce((s, l) => s + (l.qtyApproved ?? l.qtyRequested) * toNum(l.item.unitCost), 0);
  return (
    <>
      <PageHeader title={`Request ${r.requestNo}`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Requests", href: "/stationery/requests" }, { label: r.requestNo }]}
        description={<>{r.requestedBy.name} · {fmtDateTime(r.createdAt)} · <StatusBadge status={r.status} /></>}
        actions={canApprove && !own && approved && <><RejectButton id={r.id} /><IssueButton id={r.id} /></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {canApprove && r.status === "PENDING" && (own
            ? <Card><CardBody><p className="text-sm text-amber-800">This is your own request. Another approver must approve or reject it.</p></CardBody></Card>
            : (
              <Card>
                <CardHeader title="Approve request" description="Reduce a quantity to partly approve; 0 leaves the item out." />
                <CardBody>
                  <ApproveForm id={r.id} canIssue={hasPerm(user, "stationery.approve")} lines={r.lines.map((l) => ({ id: l.id, name: l.item.name, unit: l.item.unit, qtyRequested: l.qtyRequested, currentStock: l.item.currentStock }))} />
                </CardBody>
              </Card>
            ))}
          {!(canApprove && r.status === "PENDING" && !own) && (
            <Card>
              <CardHeader title="Items" />
              <Table>
                <THead><tr><TH>Item</TH><TH align="right">Requested</TH><TH align="right">Approved</TH><TH align="right">Issued</TH><TH align="right">In stock</TH></tr></THead>
                <TBody>
                  {r.lines.map((l) => (
                    <TR key={l.id} highlight={approved && (l.qtyApproved ?? 0) > l.item.currentStock ? "red" : l.qtyApproved !== null && l.qtyApproved < l.qtyRequested ? "yellow" : undefined}>
                      <TD className="font-medium text-slate-900">{l.item.name}</TD>
                      <TD align="right">{l.qtyRequested} {l.item.unit}</TD>
                      <TD align="right">{l.qtyApproved ?? "—"}</TD>
                      <TD align="right">{l.qtyIssued}</TD>
                      <TD align="right">{l.item.currentStock}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
          {moves.length > 0 && (
            <Card>
              <CardHeader title="Stock issued" />
              <MovementTable rows={moves} />
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Requested by", value: `${r.requestedBy.name}${r.requestedBy.department ? ` (${r.requestedBy.department.name})` : ""}` },
              { label: "For", value: r.schoolClass?.name ?? (r.department ? `${r.department.name} department` : "—") },
              { label: "Purpose", value: r.purpose },
              { label: "Estimated value", value: money(value) },
              { label: r.status === "REJECTED" ? "Rejected by" : "Approved by", value: r.approvedBy ? `${r.approvedBy.name}, ${fmtDateTime(r.approvedAt)}` : "—" },
              { label: r.status === "REJECTED" ? "Reason" : "Remarks", value: r.remarks },
              { label: "Issued by", value: r.issuedBy ? `${r.issuedBy.name}, ${fmtDateTime(r.issuedAt)}` : "—" },
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
