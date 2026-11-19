import { authenticateStaff } from "@/app/(auth)/actions";

/** JSON login (used by API clients and automated tests): POST {login, password} → session cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const fd = new FormData();
  fd.set("login", body.login ?? "");
  fd.set("password", body.password ?? "");
  const res = await authenticateStaff(null, fd);
  return Response.json(res, { status: res.ok ? 200 : 401 });
}
