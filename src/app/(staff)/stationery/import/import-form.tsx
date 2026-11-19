"use client";
import { ExcelImport } from "@/components/shared/excel-import";
import { importItems } from "../actions";

export function StationeryImportForm() {
  return <ExcelImport action={importItems} label="items" />;
}
