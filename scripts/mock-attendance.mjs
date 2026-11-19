/**
 * Adds realistic mock student attendance to a JSON data file (the POC has no database).
 *
 *   node scripts/mock-attendance.mjs data/demo-data.json            (history up to the snapshot's own date)
 *   node scripts/mock-attendance.mjs .poc/data.json --today         (history up to yesterday + part of today)
 *
 * Five weeks of school days per section: most children present, a few late, some absences with reasons, and four
 * "chronic absentees" below 75% so the report and alerts have something to show. On the last day some classes are left
 * unmarked, so the dashboard and the morning reminder have work to point at. Re-running replaces the previous mock rows.
 * Stop the app before editing .poc/data.json (it saves its own copy).
 */
import fs from "node:fs";
import crypto from "node:crypto";

const file = process.argv[2];
const liveToday = process.argv.includes("--today");
if (!file) { console.error("usage: node scripts/mock-attendance.mjs <data.json> [--today]"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const T = data.tables;

// Seeded random, so every run gives the same mock data.
let seed = 20261117;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const DAY = 86400000;
const istDate = (ms) => new Date(new Date(ms + 330 * 60000).toISOString().slice(0, 10) + "T00:00:00.000Z");
const lastDay = istDate(liveToday ? Date.now() : new Date(data.exportedAt).getTime());

// School calendar: Sundays and 2nd Saturdays off (HR rules defaults), plus HOLIDAY events.
const holidays = new Set();
for (const e of T.SchoolEvent ?? []) if (e.type === "HOLIDAY") for (let d = new Date(e.date); d <= new Date(e.endDate ?? e.date); d = new Date(d.getTime() + DAY)) holidays.add(d.toISOString().slice(0, 10));
const schoolDay = (d) => d.getUTCDay() !== 0 && !(d.getUTCDay() === 6 && Math.ceil(d.getUTCDate() / 7) === 2) && !holidays.has(d.toISOString().slice(0, 10));
const days = [];
for (let d = new Date(lastDay.getTime() - 35 * DAY); d <= lastDay; d = new Date(d.getTime() + DAY)) if (schoolDay(d)) days.push(d);

const users = new Map(T.User.map((u) => [u.id, u]));
const admin = T.User.find((u) => u.email === "admin@school.test");
const students = T.Student.filter((s) => s.status === "ACTIVE" && s.sectionId);
const bySection = new Map();
for (const s of students) { if (!bySection.has(s.sectionId)) bySection.set(s.sectionId, []); bySection.get(s.sectionId).push(s); }

// Four chronic absentees (~68%), everyone else ~97%.
const chronic = new Set([...students].sort((a, b) => a.admissionNo.localeCompare(b.admissionNo)).filter((_, i) => i % 41 === 7).map((s) => s.id));
const REASONS = ["Fever", "Family function", "Not informed", "Hospital visit", "Out of town", null, null];

const rows = [];
const sections = [...bySection.keys()];
const lastDayUnmarked = new Set(sections.filter((_, i) => i % 4 === 1)); // about a quarter of classes not marked yet "today"
for (const d of days) {
  const iso = d.toISOString().slice(0, 10);
  const isLast = d.getTime() === lastDay.getTime();
  for (const sectionId of sections) {
    if (isLast && lastDayUnmarked.has(sectionId)) continue;
    const sec = T.Section.find((x) => x.id === sectionId);
    const marker = (sec?.classTeacherId && users.get(sec.classTeacherId)) || admin;
    const markedAt = new Date(d.getTime() + (4 * 60 + 5 + Math.floor(rnd() * 40)) * 60000); // 09:35–10:15 IST
    for (const s of bySection.get(sectionId)) {
      if (new Date(s.admissionDate) > d) continue;
      const r = rnd();
      const pAbsent = chronic.has(s.id) ? 0.3 : 0.025;
      const status = r < pAbsent ? "ABSENT" : r < pAbsent + 0.025 ? "LATE" : r < pAbsent + 0.035 ? "HALF_DAY" : "PRESENT";
      const note = status === "ABSENT" ? pick(REASONS) : status === "LATE" ? pick(["Bus delay", "Traffic", null]) : status === "HALF_DAY" ? pick(["Left early — unwell", "Doctor appointment"]) : null;
      rows.push({
        id: "c" + crypto.randomBytes(12).toString("hex"), branchId: s.branchId, studentId: s.id, sectionId, date: `${iso}T00:00:00.000Z`, status, note,
        markedById: marker?.id ?? null, markedByName: marker?.name ?? "Office",
        parentNotifiedAt: status === "ABSENT" ? new Date(markedAt.getTime() + 60000).toISOString() : null,
        createdAt: markedAt.toISOString(), updatedAt: markedAt.toISOString(),
      });
    }
  }
}
T.StudentAttendance = rows;
fs.writeFileSync(file, JSON.stringify(data));
const absent = rows.filter((r) => r.status === "ABSENT").length;
console.log(`${file}: ${rows.length} attendance rows over ${days.length} school days up to ${lastDay.toISOString().slice(0, 10)} (${absent} absences, ${chronic.size} chronic absentees, ${lastDayUnmarked.size} classes left unmarked on the last day)`);
