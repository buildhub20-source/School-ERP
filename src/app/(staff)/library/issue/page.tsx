import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { IssueForm } from "./issue-form";
import { RecentLoans } from "../_components/recent-loans";

export const metadata = { title: "Issue a book" };

export default async function IssuePage() {
  const user = await requireUser("library.circulate");
  return (
    <>
      <PageHeader title="Issue a book" description="Give a book to a student or staff member."
        breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Issue a book" }]}
        actions={<Link href="/library/return" className="text-sm font-medium text-brand-700 hover:underline">Taking a book back? Go to Return a book →</Link>} />
      <div className="max-w-2xl"><IssueForm /></div>
      <RecentLoans branchId={user.branchId} kind="issue" />
    </>
  );
}
