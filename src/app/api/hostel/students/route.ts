import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fullName } from "@/lib/format";

/** Student search for hostel forms. ?residents=1 limits to current residents (outpasses). */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow(["hostel.manage", "hostel.warden"]); } catch { return Response.json({ error: "Forbidden" }, { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const residents = p.get("residents") === "1";
  const students = await db.student.findMany({
    where: {
      branchId: user.branchId, status: "ACTIVE",
      OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }],
      ...(residents ? { hostelAllocations: { some: { status: "ACTIVE" } } } : {}),
    },
    include: { schoolClass: true, section: true, hostelAllocations: { where: { status: "ACTIVE" }, include: { room: { include: { hostel: true } } } } },
    take: 10, orderBy: { firstName: "asc" },
  });
  return Response.json({
    results: students.map((s) => {
      const a = s.hostelAllocations[0];
      return { value: s.id, label: fullName(s), sub: `${s.admissionNo} · ${s.schoolClass.name}${s.section ? "-" + s.section.name : ""} · ${s.gender === "FEMALE" ? "Girl" : s.gender === "MALE" ? "Boy" : ""}${a ? ` · ${a.room.hostel.name} ${a.room.roomNo}` : ""}`, resident: !!a };
    }),
  });
}
