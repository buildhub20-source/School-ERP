import { getUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
export async function POST() {
  const user = await getUser();
  if (!user) return Response.json({ ok: false }, { status: 401 });
  await db.session.update({ where: { id: user.sessionId }, data: { lastSeenAt: new Date() } });
  return Response.json({ ok: true });
}
