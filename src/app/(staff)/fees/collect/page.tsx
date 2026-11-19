import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { studentWhere } from "@/server/students/service";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton, DescList, sp } from "@/components/ui";
import { FilterBar, SearchField } from "@/components/ui/client";
import { fullName, money, fmtDate, isoDate, toNum, today } from "@/lib/format";
import { CollectForm } from "../fee-forms";

export const metadata = { title: "Collect fee" };

export default async function CollectPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.collect");
  const s = await searchParams;
  const q = sp(s, "q");
  const studentId = sp(s, "studentId");
  const student = studentId ? await db.student.findFirst({ where: { id: studentId, branchId: user.branchId }, include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } }) : null;
  const matches = !student && q ? await db.student.findMany({ where: studentWhere(user.branchId, { q }), include: { schoolClass: true, section: true }, take: 20, orderBy: { firstName: "asc" } }) : [];
  const open = student ? await db.studentFee.findMany({ where: { studentId: student.id, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } }, include: { feeHead: true }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] }) : [];
  const t = today();
  return (
    <>
      <PageHeader title="Collect fee" description="Cash, cheque, UPI, card, net banking or bank transfer at the counter." breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Collect" }]} />
      {!student ? (
        <Card>
          <div className="border-b border-slate-100 p-3"><FilterBar><SearchField placeholder="Student name, admission no or parent mobile" /></FilterBar></div>
          <Table>
            <THead><tr><TH>Student</TH><TH>Admission no</TH><TH>Class</TH><TH></TH></tr></THead>
            <TBody>
              {!q && <EmptyRow colSpan={4} message="Search for a student to collect fees." />}
              {q && matches.length === 0 && <EmptyRow colSpan={4} message="No student matches." />}
              {matches.map((m) => (
                <TR key={m.id}>
                  <TD className="font-medium">{fullName(m)}</TD><TD className="font-mono text-xs">{m.admissionNo}</TD>
                  <TD>{m.schoolClass.name}{m.section ? ` - ${m.section.name}` : ""}</TD>
                  <TD align="right"><LinkButton href={`/fees/collect?studentId=${m.id}`} size="sm" variant="primary">Select</LinkButton></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:order-2">
            <CardHeader title={fullName(student)} actions={<LinkButton href="/fees/collect" size="sm">Change</LinkButton>} />
            <CardBody>
              <DescList cols={1} items={[
                { label: "Admission no", value: student.admissionNo },
                { label: "Class", value: `${student.schoolClass.name}${student.section ? ` - ${student.section.name}` : ""}` },
                { label: "Parent", value: student.guardians[0] ? `${student.guardians[0].guardian.name} · ${student.guardians[0].guardian.phone}` : "—" },
                { label: "Open dues", value: <b>{money(open.reduce((a, f) => a + toNum(f.balance), 0))}</b> },
                { label: "Overdue", value: <span className="text-rose-700">{money(open.filter((f) => f.dueDate < t).reduce((a, f) => a + toNum(f.balance), 0))}</span> },
              ]} />
              <Link href={`/fees/accounts/${student.id}`} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Full fee account →</Link>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2 lg:order-1">
            <CardHeader title="Open dues" description="Overdue lines are highlighted." />
            <CardBody>
              <CollectForm studentId={student.id} today={isoDate()} lines={open.map((f) => ({ id: f.id, description: f.description, head: f.feeHead.name, dueDate: fmtDate(f.dueDate), balance: toNum(f.balance), overdue: f.dueDate < t }))} />
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
