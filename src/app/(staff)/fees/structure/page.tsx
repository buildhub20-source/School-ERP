import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, LinkButton, sp } from "@/components/ui";
import { ActionButton, FilterBar, FilterSelect } from "@/components/ui/client";
import { money, fmtDate, fmtDateTime, isoDate, toNum } from "@/lib/format";
import { FeeHeadForm, StructureForm, CopyStructureForm } from "../fee-forms";
import { deleteStructureAction, generateDuesAction, applyLateFeesAction, deleteFeeHeadAction, deleteOtherFeeAction } from "../actions";
import { moduleOwnedHeadIds } from "@/server/fees/other-fees";
import { Plus } from "lucide-react";

export const metadata = { title: "Fee structure" };

export default async function StructurePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.setup");
  const s = await searchParams;
  const years = await db.academicYear.findMany({ orderBy: { startDate: "desc" }, include: { terms: { orderBy: { sequence: "asc" } } } });
  const year = years.find((y) => y.id === sp(s, "yearId")) ?? years.find((y) => y.isCurrent) ?? years[0];
  const [classes, heads, moduleOwned, allYearLines] = await Promise.all([
    classOptions(user.branchId), db.feeHead.findMany({ where: { branchId: user.branchId }, orderBy: { name: "asc" } }), moduleOwnedHeadIds(user.branchId),
    year ? db.feeStructure.findMany({ where: { academicYearId: year.id, schoolClass: { branchId: user.branchId } }, select: { feeHeadId: true, classId: true, _count: { select: { studentFees: true } } } }) : [],
  ]);
  const yearLines = new Map<string, typeof allYearLines>();
  for (const l of allYearLines) yearLines.set(l.feeHeadId, [...(yearLines.get(l.feeHeadId) ?? []), l]);
  const classId = sp(s, "classId");
  const rows = year ? await db.feeStructure.findMany({
    where: { academicYearId: year.id, schoolClass: { branchId: user.branchId }, ...(classId ? { classId } : {}) },
    include: { schoolClass: true, term: true, feeHead: true, _count: { select: { studentFees: true } } },
    orderBy: [{ schoolClass: { grade: "asc" } }, { term: { sequence: "asc" } }, { feeHead: { name: "asc" } }],
  }) : [];
  const classOpts = classes.map((c) => ({ value: c.id, label: c.name }));
  const termOpts = year?.terms.map((t) => ({ value: t.id, label: t.name })) ?? [];
  const headOpts = heads.filter((h) => h.isActive && h.type !== "TRANSPORT").map((h) => ({ value: h.id, label: h.name }));
  const byClass = new Map<string, typeof rows>();
  for (const r of rows) byClass.set(r.classId, [...(byClass.get(r.classId) ?? []), r]);
  return (
    <>
      <PageHeader title="Fee structure" description="Define fees once per class and term (or annual); dues are generated for every student in the class."
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Fee structure" }]}
        actions={year && <><CopyStructureForm yearId={year.id} classes={classOpts} /><StructureForm yearId={year.id} classes={classOpts} terms={termOpts} heads={headOpts} />
          <LinkButton href="/fees/structure/new" variant="primary"><Plus className="size-4" />Add new fee</LinkButton></>} />
      {!year ? <Card><CardBody>Create an academic year first (Settings → Academic years).</CardBody></Card> : (
        <div className="space-y-5">
          <Card>
            <CardHeader title={`Generate dues — ${year.name}`} description="Also runs automatically when a term starts (automation “New term starts”). Safe to run again: a student never gets the same fee twice."
              actions={<ActionButton action={applyLateFeesAction} args={{}} confirm="Apply late fees to overdue lines now (per Policies)?" successMessage="@result">Apply late fees now</ActionButton>} />
            <Table>
              <THead><tr><TH>Term</TH><TH>Dates</TH><TH>Dues generated</TH><TH></TH></tr></THead>
              <TBody>
                {year.terms.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">{t.name}{t.sequence === 1 && <span className="block text-xs text-slate-500">includes annual fees</span>}</TD>
                    <TD>{fmtDate(t.startDate)} – {fmtDate(t.endDate)}</TD>
                    <TD>{t.duesGeneratedAt ? <Badge tone="green">{fmtDateTime(t.duesGeneratedAt)}</Badge> : <Badge tone="yellow">Not yet</Badge>}</TD>
                    <TD align="right"><ActionButton action={generateDuesAction} args={{ academicYearId: year.id, termId: t.id }} variant={t.duesGeneratedAt ? "secondary" : "primary"}
                      confirm={`Generate ${t.name} dues for every active student now?`} successMessage="@result">Generate dues now</ActionButton></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
              <FilterBar>
                <FilterSelect name="yearId" label="Current year" options={years.map((y) => ({ value: y.id, label: y.name }))} />
                <FilterSelect name="classId" label="All classes" options={classOpts} />
              </FilterBar>
              <span className="text-sm text-slate-500">{rows.length} lines</span>
            </div>
            <Table>
              <THead><tr><TH>Class</TH><TH>Term</TH><TH>Fee head</TH><TH align="right">Amount</TH><TH>Due</TH><TH align="right">Instalments</TH><TH align="right">Lines generated</TH><TH></TH></tr></THead>
              <TBody>
                {rows.length === 0 && <EmptyRow colSpan={8} message="No fee structure yet. Add a fee, then copy it to other classes." />}
                {[...byClass.values()].flatMap((list) => list.map((r, i) => (
                  <TR key={r.id}>
                    <TD className="font-medium">{i === 0 ? r.schoolClass.name : ""}{i === 0 && <span className="block text-xs font-normal text-slate-500">{money(list.reduce((a, x) => a + toNum(x.amount), 0))} / year</span>}</TD>
                    <TD>{r.term?.name ?? <Badge tone="purple">Annual</Badge>}</TD>
                    <TD>{r.feeHead.name}</TD>
                    <TD align="right">{money(r.amount)}</TD>
                    <TD>{fmtDate(r.dueDate)}</TD>
                    <TD align="right">{r.instalments}</TD>
                    <TD align="right">{r._count.studentFees}</TD>
                    <TD align="right" className="whitespace-nowrap">
                      <StructureForm yearId={year.id} classes={classOpts} terms={termOpts} heads={headOpts} row={{ id: r.id, classId: r.classId, termId: r.termId, feeHeadId: r.feeHeadId, amount: toNum(r.amount), dueDate: isoDate(r.dueDate), instalments: r.instalments }} />
                      {r._count.studentFees === 0 && <ActionButton action={deleteStructureAction} args={{ id: r.id }} variant="ghost" confirm="Remove this fee line?" successMessage="Removed">Remove</ActionButton>}
                    </TD>
                  </TR>
                )))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Fees" description="Every fee the school charges. “Add new fee” creates a fee with an amount for each class; Edit changes its name, classes and amounts."
              actions={<><FeeHeadForm /><LinkButton href="/fees/structure/new" variant="primary" size="sm"><Plus className="size-4" />Add new fee</LinkButton></>} />
            <Table>
              <THead><tr><TH>Name</TH><TH>Type</TH><TH>Classes ({year.name})</TH><TH>Late fee</TH><TH>Status</TH><TH></TH></tr></THead>
              <TBody>
                {heads.map((h) => {
                  const lines = yearLines.get(h.id) ?? [];
                  const billed = lines.reduce((a, l) => a + l._count.studentFees, 0);
                  const fullEdit = h.type === "OTHER" && !moduleOwned.has(h.id);
                  return (
                    <TR key={h.id}>
                      <TD className="font-medium">{h.name}</TD><TD>{h.type.charAt(0) + h.type.slice(1).toLowerCase()}</TD>
                      <TD>{moduleOwned.has(h.id) ? <span className="text-slate-500">Billed by {h.name.toLowerCase().includes("hostel") ? "Hostel" : "Library"}</span>
                        : h.type === "TRANSPORT" ? <span className="text-slate-500">Billed by Transport</span>
                        : lines.length ? `${new Set(lines.map((l) => l.classId)).size} class${new Set(lines.map((l) => l.classId)).size === 1 ? "" : "es"}` : <span className="text-slate-500">—</span>}</TD>
                      <TD>{h.lateFeeApplies ? "Applies" : "No"}</TD><TD>{h.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                      <TD align="right" className="whitespace-nowrap">
                        {fullEdit
                          ? <><LinkButton href={`/fees/structure/fee/${h.id}/edit`} size="sm">Edit</LinkButton>{" "}
                              <ActionButton action={deleteOtherFeeAction} args={{ id: h.id }} variant="ghost" successMessage="@result" disabled={billed > 0}
                                title={billed > 0 ? "Already billed to students — edit it and untick Active instead" : undefined}
                                confirm={`Delete “${h.name}” and remove it from the fee structure (${lines.length} line${lines.length === 1 ? "" : "s"})?`}>Delete</ActionButton></>
                          : <><FeeHeadForm head={h} />{" "}
                              <ActionButton action={deleteFeeHeadAction} args={{ id: h.id }} variant="ghost" confirm={`Delete the fee head “${h.name}”? Only possible while nothing uses it.`} successMessage="Deleted">Delete</ActionButton></>}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
