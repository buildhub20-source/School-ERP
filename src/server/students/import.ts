import "server-only";
import { db } from "@/lib/db";
import { readSheet } from "@/lib/excel";
import { createStudent, type GuardianInput } from "./service";

export const STUDENT_TEMPLATE = [
  { key: "admissionNo", header: "Admission No" }, { key: "firstName", header: "First Name" }, { key: "lastName", header: "Last Name" },
  { key: "gender", header: "Gender" }, { key: "dob", header: "DOB" }, { key: "bloodGroup", header: "Blood Group" }, { key: "class", header: "Class" },
  { key: "section", header: "Section" }, { key: "rollNo", header: "Roll No" }, { key: "admissionDate", header: "Admission Date" }, { key: "address", header: "Address" },
  { key: "fatherName", header: "Father Name" }, { key: "fatherPhone", header: "Father Phone" }, { key: "motherName", header: "Mother Name" },
  { key: "motherPhone", header: "Mother Phone" }, { key: "guardianEmail", header: "Guardian Email" }, { key: "medicalNotes", header: "Medical Notes" },
  { key: "emergencyPhone", header: "Emergency Phone" },
];

export type ImportResult = { total: number; ok: number; errors: { row: number; message: string }[]; dryRun: boolean };

const phone = (s?: string) => (s ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
const date = (s?: string) => {
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export async function importStudents(branchId: string, data: ArrayBuffer, dryRun: boolean): Promise<ImportResult> {
  const rows = await readSheet(data);
  const classes = await db.schoolClass.findMany({ where: { branchId }, include: { sections: true } });
  const errors: ImportResult["errors"] = [];
  let ok = 0;
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const rowNo = i + 2;
    try {
      const cls = classes.find((c) => c.name.toLowerCase() === (r.class ?? "").toLowerCase());
      if (!r.firstname) throw new Error("First Name is required");
      if (!cls) throw new Error(`Class “${r.class}” does not exist. Add it in Settings → Academic years & classes`);
      const g = (r.gender ?? "").toUpperCase();
      const gender = g.startsWith("M") || g === "BOY" ? "MALE" : g.startsWith("F") || g === "GIRL" ? "FEMALE" : g ? "OTHER" : null;
      if (!gender) throw new Error("Gender is required (M/F)");
      const dob = date(r.dob);
      if (dob === null) throw new Error("DOB is not a valid date (use DD/MM/YYYY)");
      const adm = date(r.admissiondate);
      if (adm === null) throw new Error("Admission Date is not a valid date");
      const guardians: GuardianInput[] = [];
      if (r.fatherphone) guardians.push({ relation: "Father", name: r.fathername || "Father", phone: phone(r.fatherphone), email: r.guardianemail || undefined });
      if (r.motherphone) guardians.push({ relation: "Mother", name: r.mothername || "Mother", phone: phone(r.motherphone), email: !r.fatherphone ? r.guardianemail || undefined : undefined });
      if (!guardians.length) throw new Error("Father Phone or Mother Phone is required");
      for (const gg of guardians) if (!/^\d{10}$/.test(gg.phone)) throw new Error(`Invalid mobile number ${gg.phone}`);
      if (r.admissionno) {
        if (seen.has(r.admissionno)) throw new Error(`Admission No ${r.admissionno} appears twice in the file`);
        seen.add(r.admissionno);
        if (await db.student.findUnique({ where: { admissionNo: r.admissionno } })) throw new Error(`Admission No ${r.admissionno} already exists`);
      }
      let sectionId: string | undefined;
      if (r.section) {
        sectionId = cls.sections.find((s) => s.name.toLowerCase() === r.section.toLowerCase())?.id;
        if (!sectionId && !dryRun) {
          const sec = await db.section.create({ data: { classId: cls.id, name: r.section.toUpperCase() } });
          cls.sections.push(sec);
          sectionId = sec.id;
        }
      }
      if (!dryRun) {
        await createStudent(branchId, {
          admissionNo: r.admissionno || undefined, firstName: r.firstname, lastName: r.lastname || undefined, gender, dob: dob ?? undefined,
          bloodGroup: r.bloodgroup || undefined, classId: cls.id, sectionId, rollNo: r.rollno || undefined, admissionDate: adm ?? undefined,
          address: r.address || undefined, medicalNotes: r.medicalnotes || undefined, emergencyPhone: phone(r.emergencyphone) || undefined, guardians,
        });
      }
      ok++;
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { total: rows.length, ok, errors, dryRun };
}
