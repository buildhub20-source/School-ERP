import "server-only";
import { cookies } from "next/headers";
import { getUser } from "../auth/session";
import { translate, type DictKey } from "./dict";

export async function getLang(): Promise<string> {
  const user = await getUser();
  if (user) return user.language;
  const jar = await cookies();
  return jar.get("lang")?.value ?? "en";
}

export async function getT() {
  const lang = await getLang();
  return { lang, t: (k: DictKey) => translate(lang, k) };
}
