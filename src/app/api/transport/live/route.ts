import { requireUserOrThrow } from "@/lib/auth/session";
import { liveBuses } from "@/server/transport/trips";

export const dynamic = "force-dynamic";

/** Last location + trip status of all buses (staff live map). */
export async function GET() {
  let user;
  try { user = await requireUserOrThrow("transport.view"); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 403 }); }
  return Response.json({ buses: await liveBuses(user.branchId), at: new Date().toISOString() });
}
