import { requireUser } from "@/lib/auth/session";
import { promotionPreview } from "@/server/students/promotion";
import { PageHeader, Card, CardBody, EmptyState, LinkButton } from "@/components/ui";
import { PromotionForm } from "./promotion-form";

export const metadata = { title: "Promotion & year close" };

export default async function PromotionPage() {
  const user = await requireUser("students.promote");
  const p = await promotionPreview(user.branchId);
  return (
    <>
      <PageHeader title="Promotion & year close" description="Close the current academic year and move everyone up a class. History is kept: each student's class for every year stays on their profile." breadcrumbs={[{ label: "Students", href: "/students" }, { label: "Promotion" }]} />
      {!p.current ? <EmptyState title="No current academic year" action={<LinkButton href="/settings/academic">Set up academic years</LinkButton>} />
        : !p.next ? <EmptyState title={`Create the year after ${p.current.name} first`} description="Add the next academic year and its terms, then come back here." action={<LinkButton href="/settings/academic" variant="primary">Add next academic year</LinkButton>} />
        : (
          <>
            <Card className="mb-5"><CardBody className="text-sm text-slate-600">
              Closing <b>{p.current.name}</b> and starting <b>{p.next.name}</b>. Students in the top class graduate; tick students who should stay in the same class.
              {p.withDues > 0 && <> <b className="text-rose-700">{p.withDues} students have pending dues</b> — dues stay on their accounts and the accounts team is notified.</>}
            </CardBody></Card>
            <PromotionForm rows={p.rows} hasNextStructure={p.nextStructures > 0} nextName={p.next.name} />
          </>
        )}
    </>
  );
}
