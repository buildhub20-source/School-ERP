"use client";
import { ExcelImport } from "@/components/shared/excel-import";
import { uploadStudents } from "../actions";
export function ImportForm() {
  return <ExcelImport action={uploadStudents} label="students" />;
}
