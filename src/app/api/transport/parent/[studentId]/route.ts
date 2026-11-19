import { assertParentOf } from "@/server/parent";
import { parentBusInfo } from "@/server/transport/trips";

export const dynamic = "force-dynamic";

/** A parent's view of their own child's bus (live location while a trip is running). */
export async function GET(_: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  try { await assertParentOf(studentId); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 403 }); }
  return Response.json({ bus: await parentBusInfo(studentId), at: new Date().toISOString() });
}
