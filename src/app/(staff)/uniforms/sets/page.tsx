import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { classOptions } from "@/server/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, sp, Pagination, pageParams } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { GENDER_LABELS, UNIFORM_GENDERS } from "@/server/uniforms/labels";
import { money, toNum } from "@/lib/format";
import { SetModal, DeleteSetButton } from "../_components/forms";
import type { UniformGender } from "@prisma/client";

export const metadata = { title: "Uniform sets" };

export default async function SetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const classId = sp(s, "classId");
  const where = { branchId: user.branchId, ...(classId ? { classId: classId === "all" ? null : classId } : {}), ...(sp(s, "gender") ? { gender: sp(s, "gender") as UniformGender } : {}) };
  const [classes, total, sets, items] = await Promise.all([
    classOptions(user.branchId),
    db.uniformSet.count({ where }),
    db.uniformSet.findMany({ where, include: { schoolClass: true, items: { include: { item: { include: { variants: { where: { isActive: true } } } } } } }, orderBy: [{ schoolClass: { grade: "asc" } }, { gender: "asc" }, { name: "asc" }], skip, take }),
    db.uniformItem.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, gender: true, category: true } }),
  ]);
  const canManage = hasPerm(user, "uniforms.manage");
  const cls = classes.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader title="Uniform sets" description="The full set for a class and gender — one click adds it to an order." breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Sets" }]}
        actions={canManage && <SetModal classes={cls} items={items} />} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <FilterSelect name="classId" label="Any class" options={[{ value: "all", label: "All-classes sets" }, ...cls.map((c) => ({ value: c.id, label: c.name }))]} />
            <FilterSelect name="gender" label="Any gender" options={UNIFORM_GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Set</TH><TH>Class</TH><TH>For</TH><TH>Items</TH><TH align="right">Approx. price</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {!sets.length && <EmptyRow colSpan={6} message="No sets yet." />}
            {sets.map((st) => {
              const approx = st.items.reduce((a, i) => { const ps = i.item.variants.map((v) => toNum(v.price)); return a + (ps.length ? Math.min(...ps) : 0) * i.qty; }, 0);
              return (
                <TR key={st.id}>
                  <TD className="font-medium">{st.name}</TD>
                  <TD>{st.schoolClass?.name ?? <Badge>All classes</Badge>}</TD>
                  <TD>{GENDER_LABELS[st.gender]}</TD>
                  <TD className="max-w-md text-xs text-slate-600">{st.items.map((i) => `${i.item.name}${i.qty > 1 ? ` × ${i.qty}` : ""}`).join(", ")}</TD>
                  <TD align="right">from {money(approx)}</TD>
                  {canManage && <TD align="right"><div className="flex justify-end gap-1"><SetModal set={{ id: st.id, name: st.name, classId: st.classId, gender: st.gender, items: st.items.map((i) => ({ itemId: i.itemId, qty: i.qty })) }} classes={cls} items={items} /><DeleteSetButton id={st.id} /></div></TD>}
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/uniforms/sets" />
      </Card>
    </>
  );
}
