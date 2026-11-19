import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, StatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { CancelRequestButton } from "../request-form";

export const metadata = { title: "My request" };

const STEPS = ["Requested", "Approved", "Issued"];

export default async function MyRequest({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stationery.request");
  const { id } = await params;
  const r = await db.stationeryRequest.findFirst({
    where: { id, branchId: user.branchId, requestedById: user.id },
    include: { lines: { include: { item: { select: { name: true, unit: true } } } }, schoolClass: true, department: true, approvedBy: { select: { name: true } }, issuedBy: { select: { name: true } } },
  });
  if (!r) notFound();
  const step = r.status === "ISSUED" ? 2 : r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED" ? 1 : 0;
  const closed = r.status === "REJECTED" || r.status === "CANCELLED";
  return (
    <>
      <PageHeader title={`Request ${r.requestNo}`} breadcrumbs={[{ label: "My requests", href: "/teacher" }, { label: r.requestNo }]}
        description={<>{fmtDateTime(r.createdAt)} · <StatusBadge status={r.status} /></>}
        actions={["PENDING", "APPROVED", "PARTIALLY_APPROVED"].includes(r.status) && <CancelRequestButton id={r.id} />} />
      {!closed && (
        <ol className="mb-5 grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-lg border px-3 py-2 text-center text-sm font-medium ${i <= step ? "border-brand-200 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-400"}`}>
              {i === 1 && r.status === "PARTIALLY_APPROVED" ? "Partly approved" : s}
            </li>
          ))}
        </ol>
      )}
      {r.status === "REJECTED" && <p className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Rejected{r.approvedBy ? ` by ${r.approvedBy.name}` : ""}: {r.remarks}</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items" />
          <Table>
            <THead><tr><TH>Item</TH><TH align="right">Requested</TH><TH align="right">Approved</TH><TH align="right">Issued</TH></tr></THead>
            <TBody>
              {r.lines.map((l) => (
                <TR key={l.id} highlight={l.qtyApproved !== null && l.qtyApproved < l.qtyRequested ? "yellow" : undefined}>
                  <TD className="font-medium text-slate-900">{l.item.name}</TD>
                  <TD align="right">{l.qtyRequested} {l.item.unit}</TD>
                  <TD align="right">{l.qtyApproved ?? "—"}</TD>
                  <TD align="right">{l.qtyIssued}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "For", value: r.schoolClass?.name ?? r.department?.name ?? "Personal use" },
              { label: "Purpose", value: r.purpose },
              { label: "Approved by", value: r.approvedBy && r.status !== "REJECTED" ? `${r.approvedBy.name}, ${fmtDateTime(r.approvedAt)}` : "—" },
              { label: "Remarks", value: r.status !== "REJECTED" ? r.remarks : null },
              { label: "Issued", value: r.issuedBy ? `${fmtDateTime(r.issuedAt)} by ${r.issuedBy.name}` : "—" },
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
