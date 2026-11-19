import { requestOtp, authenticateOtp } from "@/app/(auth)/actions";

/** POST {phone} → sends OTP; POST {phone, code} → signs in. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  const fd = new FormData();
  fd.set("phone", body.phone ?? "");
  if (body.code) {
    fd.set("code", body.code);
    const res = await authenticateOtp(null, fd);
    return Response.json(res, { status: res.ok ? 200 : 401 });
  }
  return Response.json(await requestOtp(null, fd));
}
