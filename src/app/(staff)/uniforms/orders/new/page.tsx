import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, sp, Badge, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton } from "@/components/ui";
import { FilterBar, SearchField } from "@/components/ui/client";
import { fullName } from "@/lib/format";
import { orderBuilderData } from "@/server/uniforms/queries";
import { preorderYear } from "@/server/uniforms/core";
import { OrderBuilder } from "../../_components/order-builder";
import { createOrderAction } from "../../actions";

export const metadata = { title: "New uniform order" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.orders");
  const s = await searchParams;
  const studentId = sp(s, "studentId");
  const crumbs = [{ label: "Uniforms", href: "/uniforms" }, { label: "Orders", href: "/uniforms/orders" }, { label: "New order" }];
  const student = studentId ? await db.student.findFirst({ where: { id: studentId, branchId: user.branchId, status: "ACTIVE" }, include: { schoolClass: true, section: true, sizeProfile: { include: { item: true } } } }) : null;

  if (!student) {
    const q = sp(s, "q");
    const results = q ? await db.student.findMany({
      where: { branchId: user.branchId, status: "ACTIVE", OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }, { guardians: { some: { guardian: { phone: { contains: q } } } } }] },
      include: { schoolClass: true, section: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { firstName: "asc" }], take: 20,
    }) : [];
    return (
      <>
        <PageHeader title="New uniform order" description="Step 1: find the student" breadcrumbs={crumbs} />
        <Card>
          <div className="border-b border-slate-100 p-3"><FilterBar><SearchField placeholder="Student name, admission no or parent mobile" className="sm:max-w-md" /></FilterBar></div>
          <Table>
            <THead><tr><TH>Student</TH><TH>Admission no</TH><TH>Class</TH><TH /></tr></THead>
            <TBody>
              {!results.length && <EmptyRow colSpan={4} message={q ? "No active student matches." : "Type to search for a student."} />}
              {results.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{fullName(r)}</TD><TD className="font-mono text-xs">{r.admissionNo}</TD>
                  <TD>{r.schoolClass.name}{r.section ? ` - ${r.section.name}` : ""}</TD>
                  <TD align="right"><LinkButton href={`/uniforms/orders/new?studentId=${r.id}`} size="sm" variant="primary">Select</LinkButton></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </>
    );
  }

  const pre = await preorderYear();
  const isPreOrder = sp(s, "pre") === "1" && !!pre;
  const data = await orderBuilderData(user.branchId, student, isPreOrder);
  const qsBase = `/uniforms/orders/new?studentId=${student.id}`;
  return (
    <>
      <PageHeader title="New uniform order" breadcrumbs={crumbs}
        description={<>{fullName(student)} · {student.admissionNo} · {student.schoolClass.name}{student.section ? ` - ${student.section.name}` : ""} · <Link href="/uniforms/orders/new" className="text-brand-700 hover:underline">change student</Link></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items" description={`Academic year ${data.year.name}. Stock is checked again when the order is marked ready.`}
            actions={pre && <div className="flex gap-1">
              <LinkButton href={qsBase} size="sm" variant={isPreOrder ? "secondary" : "primary"}>Order now</LinkButton>
              <LinkButton href={`${qsBase}&pre=1`} size="sm" variant={isPreOrder ? "primary" : "secondary"}>Pre-order ({pre.name})</LinkButton>
            </div>} />
          <CardBody>
            <OrderBuilder key={isPreOrder ? "pre" : "now"} data={data} studentId={student.id} isPreOrder={isPreOrder} showStock action={createOrderAction} redirectTo="/uniforms/orders/[id]" submitLabel="Place order" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Size profile" description="Last delivered sizes" />
          <CardBody className="space-y-2 text-sm">
            {!student.sizeProfile.length && <p className="text-slate-500">No sizes saved yet. They are saved when an order is delivered.</p>}
            {student.sizeProfile.map((p) => {
              const sug = data.suggestions[p.itemId];
              return (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span>{p.item.name}</span>
                  <span className="text-right">{p.size}{sug && sug.size !== p.size && <Badge tone="indigo" className="ml-2">next {sug.size}</Badge>}</span>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
