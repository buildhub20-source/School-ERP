import { requireUserOrThrow } from "@/lib/auth/session";
import { runWithContext } from "@/lib/context";
import { pdfResponse } from "@/lib/excel";
import { AppError } from "@/lib/errors";
import { buildIdCards } from "@/server/uniforms/idcards";

/** ID card PDF: ?studentIds=a,b | ?sectionId= | ?classId= */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow(["uniforms.manage", "uniforms.orders", "students.manage"]); } catch (e) { return new Response(e instanceof AppError ? e.message : "Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const studentIds = (p.get("studentIds") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500);
  try {
    const { buf } = await runWithContext({ userId: user.id, userName: user.name, branchId: user.branchId }, () =>
      buildIdCards(user.branchId, { studentIds, sectionId: p.get("sectionId") ?? undefined, classId: p.get("classId") ?? undefined }, user.id));
    return pdfResponse(buf, "id-cards.pdf");
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 400 });
    console.error("[id-cards]", e);
    return new Response("Could not generate ID cards.", { status: 500 });
  }
}
