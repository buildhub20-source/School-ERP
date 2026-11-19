"use client";
import { ExcelImport } from "@/components/shared/excel-import";
import { importFeesAction } from "../actions";
export function FeeImportForm() {
  return <ExcelImport action={importFeesAction} label="rows" />;
}
