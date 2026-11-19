import "server-only";
import { db } from "@/lib/db";
import { fullName, isoDate, today, addDays } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { notifyGuardians, notifyUsers } from "@/lib/messaging/notify";
import { sendCircular } from "./service";

/** Daily: birthday greetings to students' parents and staff; event/holiday circulars N days before. */
export async function greetingsAndCirculars(config: Record<string, unknown>): Promise<string> {
  const t = today();
  const mmdd = isoDate(t).slice(5);
  let birthdays = 0, events = 0;
  const branches = await db.branch.findMany({ where: { isActive: true } });
  for (const b of branches) {
    const school = await getSetting("school", b.id);
    if (config.birthdays !== false) {
      const students = (await db.student.findMany({ where: { branchId: b.id, status: "ACTIVE", dob: { not: null } }, select: { id: true, firstName: true, lastName: true, dob: true } }))
        .filter((s) => isoDate(s.dob!).slice(5) === mmdd);
      for (const s of students) {
        await notifyGuardians(s.id, { title: `Happy birthday, ${s.firstName}!`, body: `Warm wishes to ${fullName(s)} from everyone at ${school.name}.`, category: "GREETING", template: "GREETING", ta: { title: `இனிய பிறந்தநாள் வாழ்த்துகள், ${s.firstName}!`, body: `${school.name} குடும்பத்தின் சார்பாக ${fullName(s)} க்கு அன்பான வாழ்த்துகள்.` } });
        birthdays++;
      }
      const staff = (await db.user.findMany({ where: { branchId: b.id, isActive: true, role: { key: { notIn: ["PARENT"] } }, dob: { not: null } }, select: { id: true, name: true, dob: true } }))
        .filter((u) => isoDate(u.dob!).slice(5) === mmdd);
      for (const u of staff) {
        await notifyUsers([u.id], { title: `Happy birthday, ${u.name}!`, body: `Best wishes from ${school.name}.`, category: "GREETING", template: "GREETING", ta: { title: `இனிய பிறந்தநாள் வாழ்த்துகள், ${u.name}!`, body: `${school.name} சார்பாக நல்வாழ்த்துகள்.` } });
        birthdays++;
      }
    }
    if (config.events !== false) {
      const upcoming = await db.schoolEvent.findMany({ where: { branchId: b.id, notifiedAt: null, date: { gte: t, lte: addDays(t, 60) } } });
      for (const ev of upcoming) {
        const notifyOn = addDays(ev.date, -ev.notifyDaysBefore);
        if (notifyOn > t) continue;
        const when = ev.date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
        const circ = await db.circular.create({
          data: { branchId: b.id, title: ev.type === "HOLIDAY" ? `Holiday: ${ev.title}` : ev.title, body: `${ev.type === "HOLIDAY" ? "The school will remain closed" : "Event"} on ${when}${ev.endDate ? ` to ${ev.endDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "UTC" })}` : ""}.${ev.description ? "\n" + ev.description : ""}`, type: ev.type, audience: ev.audience },
        });
        await sendCircular(circ.id);
        await db.schoolEvent.update({ where: { id: ev.id }, data: { notifiedAt: new Date() } });
        events++;
      }
    }
  }
  return `${birthdays} birthday greeting(s), ${events} event/holiday circular(s)`;
}
