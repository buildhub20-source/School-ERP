import { z } from "zod";
import { requireUserOrThrow } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { recordLocation } from "@/server/transport/trips";

const schema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), speed: z.number().min(0).max(200).nullable().optional() });

/** GPS ping from the driver/attendant phone (every ~15 s while a trip is active). */
export async function POST(req: Request) {
  try {
    const user = await requireUserOrThrow("driver.portal");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ ok: false, error: "Invalid location" }, { status: 400 });
    const r = await recordLocation(user.id, parsed.data);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ ok: false, error: e.message, code: e.code }, { status: e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 409 });
    console.error("[driver/location]", e);
    return Response.json({ ok: false, error: "Could not save location" }, { status: 500 });
  }
}
