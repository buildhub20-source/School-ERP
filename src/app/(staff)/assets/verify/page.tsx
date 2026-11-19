import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, fmtDate, today } from "@/lib/format";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Field, FormGrid, Input } from "@/components/ui";
import { ActionForm } from "@/components/ui/client";
import { verifyAssetAction } from "../actions";

export const metadata = { title: "Verify assets" };

/** Physical verification round: type or scan each asset code as you see it. */
export default async function VerifyAssetsPage() {
  const user = await requireUser("assets.manage");
  const yearAgo = addDays(today(), -365);
  const pending = await db.asset.findMany({
    where: { branchId: user.branchId, status: { not: "DISPOSED" }, OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: yearAgo } }] },
    orderBy: [{ location: "asc" }, { code: "asc" }], take: 200,
  });
  return (
    <>
      <PageHeader title="Verify assets" description="Walk round each room and enter or scan the code on every asset label you see. Assets not seen in the last year are listed below." breadcrumbs={[{ label: "Assets", href: "/assets" }, { label: "Verify" }]} />
      <Card className="max-w-2xl">
        <CardBody>
          <ActionForm action={verifyAssetAction} submitLabel="Mark verified" successMessage="@result" resetOnSuccess>
            <FormGrid cols={2}>
              <Field label="Asset code" required><Input name="code" required autoFocus autoComplete="off" placeholder="AST-00012" className="font-mono uppercase" /></Field>
              <Field label="Found at" hint="Leave empty if it is where the register says"><Input name="location" /></Field>
            </FormGrid>
          </ActionForm>
        </CardBody>
      </Card>
      <Card className="mt-5">
        <CardHeader title={`Not verified in the last year (${pending.length}${pending.length === 200 ? "+" : ""})`} />
        <Table>
          <THead><tr><TH>Code</TH><TH>Asset</TH><TH>Location</TH><TH>Last verified</TH></tr></THead>
          <TBody>
            {pending.length === 0 && <EmptyRow colSpan={4} message="Every asset has been verified in the last year." />}
            {pending.map((a) => (
              <TR key={a.id}>
                <TD className="font-mono text-xs">{a.code}</TD>
                <TD><Link href={`/assets/${a.id}`} className="font-medium text-ink hover:text-brand-700">{a.name}</Link></TD>
                <TD>{a.location ?? "—"}</TD>
                <TD>{a.lastVerifiedAt ? fmtDate(a.lastVerifiedAt) : "Never"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
