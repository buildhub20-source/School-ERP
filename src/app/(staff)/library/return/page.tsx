import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { ReturnForm } from "./return-form";
import { RecentLoans } from "../_components/recent-loans";

export const metadata = { title: "Return a book" };

export default async function ReturnPage() {
  const user = await requireUser("library.circulate");
  return (
    <>
      <PageHeader title="Return a book" description="Take back a book that was borrowed."
        breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Return a book" }]}
        actions={<Link href="/library/issue" className="text-sm font-medium text-brand-700 hover:underline">Giving a book out? Go to Issue a book →</Link>} />
      <div className="max-w-2xl"><ReturnForm canWaive={hasPerm(user, "library.manage")} /></div>
      <RecentLoans branchId={user.branchId} kind="return" />
    </>
  );
}
