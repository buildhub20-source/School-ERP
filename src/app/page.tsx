import { redirect } from "next/navigation";
import { getUser, homePathFor } from "@/lib/auth/session";

export default async function Home() {
  const user = await getUser();
  redirect(user ? homePathFor(user) : "/login");
}
