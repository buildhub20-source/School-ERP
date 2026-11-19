/**
 * Seed: roles, branch, academic year + terms, classes, departments, staff users, demo students and parents.
 * Run: npm run db:seed   (reset everything: npm run db:reset)
 */
import { db } from "@/lib/db";
import { assertDemoAllowed } from "../scripts/demo-guard";
import { runWithContext } from "@/lib/context";
import { DEFAULT_ROLES, ROLE_KEYS } from "@/lib/permissions";
import { syncRoles } from "@/lib/role-sync";
import { hashPassword } from "@/lib/auth/password";
import { saveSetting } from "@/lib/settings";
import { AUTOMATIONS } from "@/lib/automations/catalog";
import { createStudent } from "@/server/students/service";
import { seed_stationery } from "./seed-modules/stationery";
import { seed_uniforms } from "./seed-modules/uniforms";
import { seed_transport } from "./seed-modules/transport";
import { seed_fees } from "./seed-modules/fees";
import { seed_library } from "./seed-modules/library";
import { seed_assets } from "./seed-modules/assets";
import { seed_hostel } from "./seed-modules/hostel";
import { seed_hr } from "./seed-modules/hr";

export type SeedCtx = { branchId: string; yearId: string; users: Record<string, string>; adminId: string };

const d = (s: string) => new Date(s + "T00:00:00.000Z");

const FIRST_M = ["Arun", "Karthik", "Vijay", "Surya", "Praveen", "Dinesh", "Hari", "Rahul", "Sanjay", "Aakash", "Naveen", "Gokul", "Ajay", "Bharath", "Kavin", "Mohan", "Rohit", "Siddharth", "Tarun", "Vishal", "Yash", "Ashwin", "Deepak", "Ganesh"];
const FIRST_F = ["Priya", "Divya", "Kavya", "Lakshmi", "Meena", "Nandhini", "Pooja", "Revathi", "Sneha", "Swathi", "Harini", "Anitha", "Keerthana", "Madhu", "Ishwarya", "Janani", "Dharshini", "Gayathri", "Sowmya", "Varsha", "Yamini", "Abinaya", "Bhavya", "Charu"];
const LAST = ["Kumar", "Raj", "Murugan", "Subramanian", "Krishnan", "Natarajan", "Rajendran", "Selvam", "Ramasamy", "Pandian", "Shankar", "Venkatesh", "Iyer", "Pillai", "Sundaram", "Balaji"];
const FATHER = ["Ramesh", "Suresh", "Senthil", "Mani", "Prakash", "Saravanan", "Kannan", "Velu", "Anand", "Ravi", "Murali", "Gopal"];
const MOTHER = ["Lakshmi", "Malathi", "Vasuki", "Selvi", "Geetha", "Kalpana", "Uma", "Revathi", "Shanthi", "Bhuvana", "Jaya", "Radha"];
const BLOOD = ["A+", "B+", "O+", "AB+", "O-", "A-", "B-"];
const STREETS = ["Anna Nagar", "T Nagar", "Velachery", "Adyar", "Tambaram", "Porur", "Ambattur", "Mylapore", "Guindy", "Chromepet"];

/** Demo realism: students who paid Term 1 tuition also paid their Term 1 bus fee (same day and mode). Idempotent. */
async function settleTransportTerm1(ctx: SeedCtx) {
  const { recordPayment } = await import("@/server/fees/core");
  const term1 = await db.term.findFirst({ where: { academicYearId: ctx.yearId, sequence: 1 } });
  if (!term1) return;
  const lines = await db.studentFee.findMany({ where: { source: "TRANSPORT", termId: term1.id, status: "PENDING", student: { branchId: ctx.branchId } } });
  let n = 0;
  for (const l of lines) {
    const tuition = await db.studentFee.findFirst({ where: { studentId: l.studentId, termId: term1.id, feeHead: { type: "TUITION" }, status: "PAID" }, include: { allocations: { include: { payment: true } } } });
    const p = tuition?.allocations[0]?.payment;
    if (!p) continue;
    await db.$transaction((tx) => recordPayment(tx, { branchId: ctx.branchId, studentId: l.studentId, amount: Number(l.balance), mode: p.mode, reference: p.mode === "CASH" ? undefined : `${p.reference ?? "TXN"}-BUS`, chequeBank: p.chequeBank ?? undefined, chequeDate: p.chequeDate ?? undefined, allocations: [{ studentFeeId: l.id, amount: Number(l.balance) }], paidAt: p.paidAt, collectedById: ctx.users.accountant, notes: "Transport fee Term 1" }));
    n++;
  }
  if (n) console.log(`  ${n} Term 1 transport fees settled`);
}

/** A few sent circulars and upcoming events for the parent portal (idempotent). */
async function seedCirculars(ctx: SeedCtx) {
  if (await db.circular.count({ where: { branchId: ctx.branchId } })) return;
  const sent = (days: number) => new Date(Date.now() - days * 86400000);
  await db.circular.createMany({ data: [
    { branchId: ctx.branchId, title: "Term 2 fee reminder", body: "Term 2 fees are due. Parents can pay online through the parent app (Fees → Pay now) or at the school office between 9 am and 3 pm.", type: "CIRCULAR", audience: "ALL_PARENTS", sentAt: sent(20), createdById: ctx.users.admin },
    { branchId: ctx.branchId, title: "Annual Sports Day", body: "Our Annual Sports Day will be held on the school grounds. Students should come in their house T-shirts. Parents are welcome from 9 am.", type: "EVENT", audience: "EVERYONE", sentAt: sent(6), createdById: ctx.users.admin },
    { branchId: ctx.branchId, title: "Winter uniform", body: "Sweaters are part of the uniform from 15 November. Order sweaters from the parent app (Uniform orders) or the school store.", type: "CIRCULAR", audience: "ALL_PARENTS", sentAt: sent(2), createdById: ctx.users.admin },
  ] });
  const day = (offset: number) => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() + offset); return x; };
  await db.schoolEvent.createMany({ data: [
    { branchId: ctx.branchId, title: "Children's Day celebration", date: day(10), type: "EVENT", audience: "EVERYONE", notifyDaysBefore: 2 },
    { branchId: ctx.branchId, title: "Christmas holidays", date: day(51), endDate: day(56), type: "HOLIDAY", audience: "EVERYONE", notifyDaysBefore: 3 },
  ] });
}

async function main() {
  assertDemoAllowed("the demo seed");
  console.log("Seeding…");
  // Roles
  for (const key of ROLE_KEYS) {
    const r = DEFAULT_ROLES[key];
    await db.role.upsert({ where: { key }, create: { key, name: r.name, description: r.description, permissions: r.permissions }, update: { name: r.name, description: r.description, permissions: r.permissions } });
  }
  await syncRoles();
  const roles = Object.fromEntries((await db.role.findMany()).map((r) => [r.key, r.id]));

  // Branch + settings
  const branch = await db.branch.upsert({ where: { code: "MAIN" }, create: { code: "MAIN", name: "Main Campus", address: "12, Lake View Road, Anna Nagar, Chennai 600040", phone: "044 2626 1234", email: "office@greenvalleyschool.in" }, update: {} });
  await saveSetting("school", {
    name: "Green Valley Matriculation Higher Secondary School", tagline: "Learn · Lead · Serve", address: "12, Lake View Road, Anna Nagar, Chennai 600040",
    phone: "044 2626 1234", email: "office@greenvalleyschool.in", website: "www.greenvalleyschool.in", affiliation: "Affiliated to the Tamil Nadu State Board",
    principalName: "Dr. S. Meenakshi", principalEmail: "principal@greenvalleyschool.in",
  });
  await saveSetting("policies", {});
  for (const a of AUTOMATIONS) await db.automationSetting.upsert({ where: { key: a.key }, create: { key: a.key, enabled: true, config: a.defaultConfig as object }, update: {} });

  // Academic year 2026-27 with three terms
  await db.academicYear.updateMany({ data: { isCurrent: false } });
  const year = await db.academicYear.upsert({ where: { name: "2026-27" }, create: { name: "2026-27", startDate: d("2026-06-01"), endDate: d("2027-04-30"), isCurrent: true }, update: { isCurrent: true } });
  const terms = [
    { name: "Term 1", sequence: 1, startDate: d("2026-06-01"), endDate: d("2026-09-30") },
    { name: "Term 2", sequence: 2, startDate: d("2026-10-01"), endDate: d("2026-12-31") },
    { name: "Term 3", sequence: 3, startDate: d("2027-01-01"), endDate: d("2027-04-30") },
  ];
  for (const t of terms) await db.term.upsert({ where: { academicYearId_sequence: { academicYearId: year.id, sequence: t.sequence } }, create: { ...t, academicYearId: year.id }, update: {} });

  // Classes and sections
  const classNames = ["LKG", "UKG", ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];
  for (const [i, name] of classNames.entries()) {
    const c = await db.schoolClass.upsert({ where: { branchId_name: { branchId: branch.id, name } }, create: { branchId: branch.id, name, grade: i - 1 }, update: { grade: i - 1 } });
    for (const s of ["A", "B"]) await db.section.upsert({ where: { classId_name: { classId: c.id, name: s } }, create: { classId: c.id, name: s }, update: {} });
  }
  for (const name of ["Science", "Mathematics", "Languages", "Social Science", "Computer Science", "Arts & Sports", "Office"]) {
    await db.department.upsert({ where: { branchId_name: { branchId: branch.id, name } }, create: { branchId: branch.id, name }, update: {} });
  }
  const depts = Object.fromEntries((await db.department.findMany({ where: { branchId: branch.id } })).map((x) => [x.name, x.id]));

  // Staff users (demo passwords — change after first login)
  const pw = await hashPassword("Admin@12345");
  const staffPw = await hashPassword("Staff@12345");
  const people: { key: string; name: string; email: string; phone: string; role: string; dept?: string; dob?: string }[] = [
    { key: "super", name: "System Administrator", email: "superadmin@school.test", phone: "9000000001", role: "SUPER_ADMIN" },
    { key: "admin", name: "Rekha Srinivasan", email: "admin@school.test", phone: "9000000002", role: "SCHOOL_ADMIN", dept: "Office" },
    { key: "accountant", name: "Ganesh Iyer", email: "accounts@school.test", phone: "9000000003", role: "ACCOUNTANT", dept: "Office" },
    { key: "store", name: "Murali Krishnan", email: "store@school.test", phone: "9000000004", role: "STORE_MANAGER", dept: "Office" },
    { key: "transport", name: "Selvakumar P", email: "transport@school.test", phone: "9000000005", role: "TRANSPORT_MANAGER", dept: "Office" },
    { key: "librarian", name: "Vasanthi Natarajan", email: "library@school.test", phone: "9000000006", role: "LIBRARIAN", dept: "Office" },
    { key: "warden", name: "Arul Prakasam", email: "hostel@school.test", phone: "9000000007", role: "HOSTEL_WARDEN", dept: "Office" },
    { key: "hr", name: "Lakshmi Devi", email: "hr@school.test", phone: "9000000009", role: "HR_MANAGER", dept: "Office" },
    { key: "teacher1", name: "Anitha Raman", email: "anitha@school.test", phone: "9000000011", role: "TEACHER", dept: "Science", dob: "1988-11-03" },
    { key: "teacher2", name: "Prakash Sundar", email: "prakash@school.test", phone: "9000000012", role: "TEACHER", dept: "Mathematics" },
    { key: "teacher3", name: "Kalaiselvi M", email: "kalai@school.test", phone: "9000000013", role: "TEACHER", dept: "Languages" },
    { key: "teacher4", name: "Joseph Antony", email: "joseph@school.test", phone: "9000000014", role: "TEACHER", dept: "Computer Science" },
  ];
  const users: Record<string, string> = {};
  for (const p of people) {
    const u = await db.user.upsert({
      where: { email: p.email },
      create: { branchId: branch.id, roleId: roles[p.role], name: p.name, email: p.email, phone: p.phone, passwordHash: p.role === "SUPER_ADMIN" ? pw : staffPw, departmentId: p.dept ? depts[p.dept] : null, preferredChannel: "EMAIL", dob: p.dob ? d(p.dob) : null },
      update: {},
    });
    users[p.key] = u.id;
  }
  // Class teachers
  const sec5A = await db.section.findFirst({ where: { name: "A", schoolClass: { branchId: branch.id, name: "Class 5" } } });
  const sec8B = await db.section.findFirst({ where: { name: "B", schoolClass: { branchId: branch.id, name: "Class 8" } } });
  if (sec5A) await db.section.update({ where: { id: sec5A.id }, data: { classTeacherId: users.teacher1 } });
  if (sec8B) await db.section.update({ where: { id: sec8B.id }, data: { classTeacherId: users.teacher2 } });

  // Fee heads
  for (const h of [
    { name: "Tuition Fee", type: "TUITION" as const }, { name: "Transport Fee", type: "TRANSPORT" as const }, { name: "Exam Fee", type: "OTHER" as const },
    { name: "Lab Fee", type: "OTHER" as const }, { name: "Library Fee", type: "OTHER" as const }, { name: "Sports & Activities", type: "OTHER" as const }, { name: "Admission Fee", type: "OTHER" as const, lateFeeApplies: false },
  ]) await db.feeHead.upsert({ where: { branchId_name: { branchId: branch.id, name: h.name } }, create: { branchId: branch.id, ...h }, update: {} });

  const ctx: SeedCtx = { branchId: branch.id, yearId: year.id, users, adminId: users.super };

  // Students
  const existing = await db.student.count({ where: { branchId: branch.id } });
  if (existing === 0) {
    const classes = await db.schoolClass.findMany({ where: { branchId: branch.id }, include: { sections: true }, orderBy: { grade: "asc" } });
    let n = 0;
    let phoneSeq = 0;
    const families: { father: string; fphone: string; mother: string; mphone: string; last: string }[] = [];
    for (const c of classes) {
      for (const sec of c.sections) {
        const count = 5 + ((c.grade + sec.name.charCodeAt(0)) % 3);
        for (let k = 0; k < count; k++) {
          n++;
          const female = (n * 7) % 2 === 0;
          const first = (female ? FIRST_F : FIRST_M)[(n * 5) % 24];
          // every 9th student is a sibling of an earlier family
          let fam = n % 9 === 0 && families.length > 3 ? families[(n * 3) % families.length] : null;
          if (!fam) {
            phoneSeq++;
            fam = { father: `${FATHER[n % 12]} ${LAST[(n * 3) % 16]}`, fphone: `98${String(40000000 + phoneSeq * 2).padStart(8, "0")}`, mother: `${MOTHER[(n * 5) % 12]} ${LAST[(n * 3) % 16]}`, mphone: `98${String(40000000 + phoneSeq * 2 + 1).padStart(8, "0")}`, last: LAST[(n * 3) % 16] };
            families.push(fam);
          }
          const birthYear = 2026 - (c.grade + 6);
          await runWithContext({ userId: users.admin, userName: "Seed" }, () => createStudent(branch.id, {
            firstName: first, lastName: fam!.last, gender: female ? "FEMALE" : "MALE",
            dob: new Date(Date.UTC(birthYear, (n * 5) % 12, 1 + ((n * 7) % 27))), bloodGroup: BLOOD[n % 7],
            classId: c.id, sectionId: sec.id, rollNo: String(k + 1), admissionDate: n % 17 === 0 ? d("2026-10-20") : d(`${2026 - Math.min(c.grade + 1, 8)}-06-01`),
            address: `${(n * 13) % 200 + 1}, ${STREETS[n % 10]}, Chennai`, medicalNotes: n % 23 === 0 ? "Asthma — carries inhaler" : n % 31 === 0 ? "Peanut allergy" : undefined,
            emergencyPhone: fam!.fphone, isStaffChild: n === 40, staffUserId: n === 40 ? users.teacher3 : undefined,
            guardians: [{ relation: "Father", name: fam!.father, phone: fam!.fphone }, { relation: "Mother", name: fam!.mother, phone: fam!.mphone }],
          }));
        }
      }
    }
    console.log(`  ${n} students`);
  }

  await runWithContext({ userId: users.admin, userName: "Seed" }, async () => {
    await seed_fees(ctx);
    await seed_stationery(ctx);
    await seed_uniforms(ctx);
    await seed_transport(ctx);
    await settleTransportTerm1(ctx);
    await seed_library(ctx);
    await seed_assets(ctx);
    await seed_hostel(ctx);
    await seed_hr(ctx);
    await seedCirculars(ctx);
  });

  console.log("Done.\n");
  console.log("Staff logins (password Staff@12345, Super Admin: Admin@12345):");
  for (const p of people) console.log(`  ${p.role.padEnd(18)} ${p.email}`);
  const parent = await db.guardian.findFirst({ where: { students: { some: {} } }, orderBy: { phone: "asc" } });
  if (parent) console.log(`Parent login: OTP to ${parent.phone} (sandbox OTP shown on the login screen in development)`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
