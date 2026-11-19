import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { itemOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge, EmptyState } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { fmtDateTime, money, toNum } from "@/lib/format";
import { KitFormButton, IssueKitButton } from "./kit-forms";

export const metadata = { title: "Class kits" };

export default async function KitsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 10);
  const where: Prisma.StationeryKitWhereInput = { branchId: user.branchId, isActive: sp(s, "inactive") === "1" ? false : true, ...(sp(s, "classId") ? { classId: sp(s, "classId") } : {}) };
  const [total, kits, classes, items] = await Promise.all([
    db.stationeryKit.count({ where }),
    db.stationeryKit.findMany({ where, include: { schoolClass: { include: { sections: { orderBy: { name: "asc" } } } }, items: { include: { item: true } }, issues: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }], skip, take }),
    classOptions(user.branchId),
    itemOptions(user.branchId),
  ]);
  const classIds = [...new Set(kits.map((k) => k.classId))];
  const counts = await db.student.groupBy({ by: ["classId", "sectionId"], where: { classId: { in: classIds }, status: "ACTIVE" }, _count: true });
  const issuers = await db.user.findMany({ where: { id: { in: kits.flatMap((k) => k.issues.map((i) => i.issuedById!)).filter(Boolean) } }, select: { id: true, name: true } });
  const manage = hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title="Class kits" description="Define a kit per class and issue it to the whole class in one step." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Kits" }]}
        actions={manage && <KitFormButton items={items} classes={classes} />} />
      <div className="mb-4">
        <FilterBar>
          <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect name="inactive" label="Active kits" options={[{ value: "1", label: "Inactive kits" }]} />
        </FilterBar>
      </div>
      {kits.length === 0 && <EmptyState title="No kits yet" description="Create a kit such as “Class 5 kit” with the items each student gets." />}
      <div className="space-y-5">
        {kits.map((k) => {
          const c = counts.filter((x) => x.classId === k.classId);
          const countMap: Record<string, number> = { "": c.reduce((a, x) => a + x._count, 0) };
          for (const x of c) if (x.sectionId) countMap[x.sectionId] = x._count;
          const perStudent = k.items.reduce((a, i) => a + i.qty * toNum(i.item.unitCost), 0);
          return (
            <Card key={k.id}>
              <CardHeader title={<>{k.name} {!k.isActive && <Badge>Inactive</Badge>}</>} description={`${k.schoolClass.name} · ${countMap[""]} active students · ${money(perStudent)} per student · ${money(perStudent * countMap[""])} for the class`}
                actions={manage && <>
                  <KitFormButton items={items} classes={classes} kit={{ id: k.id, name: k.name, classId: k.classId, isActive: k.isActive, lines: k.items.map((i) => ({ itemId: i.itemId, qty: i.qty })) }} />
                  {k.isActive && <IssueKitButton kit={{ id: k.id, name: k.name, className: k.schoolClass.name }} sections={k.schoolClass.sections} counts={countMap} lines={k.items.map((i) => ({ name: i.item.name, perStudent: i.qty, stock: i.item.currentStock, unit: i.item.unit }))} />}
                </>} />
              <div className="grid gap-0 lg:grid-cols-2">
                <Table>
                  <THead><tr><TH>Item</TH><TH align="right">Per student</TH><TH align="right">Whole class</TH><TH align="right">In stock</TH></tr></THead>
                  <TBody>
                    {k.items.length === 0 && <EmptyRow colSpan={4} message="No items." />}
                    {k.items.map((i) => (
                      <TR key={i.id} highlight={i.qty * countMap[""] > i.item.currentStock ? "red" : undefined}>
                        <TD>{i.item.name}</TD><TD align="right">{i.qty}</TD><TD align="right">{i.qty * countMap[""]}</TD><TD align="right">{i.item.currentStock}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <Table className="border-t border-slate-100 lg:border-l lg:border-t-0">
                  <THead><tr><TH>Issued</TH><TH>Section</TH><TH align="right">Students</TH><TH>By</TH></tr></THead>
                  <TBody>
                    {k.issues.length === 0 && <EmptyRow colSpan={4} message="Not issued yet." />}
                    {k.issues.map((i) => (
                      <TR key={i.id}>
                        <TD className="whitespace-nowrap">{fmtDateTime(i.createdAt)}</TD>
                        <TD>{i.sectionId ? k.schoolClass.sections.find((x) => x.id === i.sectionId)?.name ?? "—" : "Whole class"}</TD>
                        <TD align="right">{i.studentCount}</TD>
                        <TD>{issuers.find((u) => u.id === i.issuedById)?.name ?? "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          );
        })}
      </div>
      {total > pageSize && <Card className="mt-5"><Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/kits" /></Card>}
    </>
  );
}
