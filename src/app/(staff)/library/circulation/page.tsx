import { redirect } from "next/navigation";

/** The old combined "Issue & return" desk is now two pages; keep old links and bookmarks working. */
export default function CirculationPage() {
  redirect("/library/issue");
}
