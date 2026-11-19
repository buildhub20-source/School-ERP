import { redirect } from "next/navigation";

/** The teacher's request list lives at /teacher ("My requests"); this address only has per-request pages under it. */
export default function TeacherRequestsIndex() {
  redirect("/teacher");
}
