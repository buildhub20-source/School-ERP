import { requireUserOrThrow } from "@/lib/auth/session";
import { emergencySheet, staffBus } from "@/server/transport/trips";

export const dynamic = "force-dynamic";

/** Emergency contact sheet for the signed-in driver/attendant's own bus (cached by sw.js for offline use). */
export async function GET() {
  let user;
  try { user = await requireUserOrThrow("driver.portal"); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 401 }); }
  const { bus } = await staffBus(user.id);
  if (!bus) return Response.json({ error: "You are not assigned to a bus." }, { status: 404 });
  return Response.json(await emergencySheet(bus.id), { headers: { "cache-control": "no-store" } });
}
