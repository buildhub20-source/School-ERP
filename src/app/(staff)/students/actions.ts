"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { saveUpload } from "@/lib/uploads";
import { createStudent, markStudentLeft, rejoinStudent, updateStudent } from "@/server/students/service";
import { importStudents } from "@/server/students/import";

const guardian = z.object({ relation: zs.str(30), name: zs.str(120), phone: zs.phone(), email: zs.optEmail(), occupation: zs.optStr(120) });

const studentSchema = z.object({
  id: z.string().optional(),
  admissionNo: zs.optStr(40),
  firstName: zs.str(80),
  lastName: zs.optStr(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dob: zs.optDate(),
  bloodGroup: zs.optStr(10),
  classId: zs.id,
  sectionId: zs.optStr(40),
  rollNo: zs.optStr(20),
  admissionDate: zs.optDate(),
  address: zs.optStr(500),
  medicalNotes: zs.optStr(1000),
  emergencyPhone: zs.optPhone(),
  isStaffChild: zs.bool(),
  staffUserId: zs.optStr(40),
  photo: z.any().optional(),
  guardians: zs.json(z.array(guardian).min(1, "Add at least one parent or guardian")),
});

export const saveStudent = defineAction({ perm: "students.manage", schema: studentSchema, revalidate: "/students" }, async (input, { branchId }) => {
  let photoUrl: string | undefined;
  if (input.photo instanceof File && input.photo.size > 0) photoUrl = await saveUpload(input.photo, "students", { maxMb: 3, types: ["image/jpeg", "image/png", "image/webp"] });
  const data = { ...input, photoUrl };
  const s = input.id ? await updateStudent(branchId, input.id, data) : await createStudent(branchId, data);
  return { id: s.id };
});

export const leaveSchool = defineAction({ perm: "students.manage", schema: z.object({ id: zs.id, leftOn: zs.date(), reason: zs.str(300) }), revalidate: "/students" }, async ({ id, leftOn, reason }, { branchId }) => {
  return markStudentLeft(branchId, id, leftOn, reason);
});

export const rejoin = defineAction({ perm: "students.manage", schema: z.object({ id: zs.id }), revalidate: "/students" }, async ({ id }, { branchId }) => {
  await rejoinStudent(branchId, id);
  return true;
});

export const uploadStudents = defineAction({ perm: "students.import", schema: z.object({ file: z.instanceof(File), dryRun: zs.bool() }) }, async ({ file, dryRun }, { branchId }) => {
  return importStudents(branchId, await file.arrayBuffer(), dryRun);
});
