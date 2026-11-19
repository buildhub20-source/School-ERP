import { redirect } from "next/navigation";

/** This address only has pages under it (opened from payment links and QR codes); send visitors home. */
export default function Index() {
  redirect("/");
}
