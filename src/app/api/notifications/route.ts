import { getUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const [unread, items] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  return Response.json({ unread, items });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Unauthenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };
  if (body.all) await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  else if (body.id) await db.notification.updateMany({ where: { id: body.id, userId: user.id }, data: { readAt: new Date() } });
  return Response.json({ ok: true });
}
