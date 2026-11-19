import { stationeryImportTemplate } from "./stationery/import-template";
import { uniformsImportTemplate } from "./uniforms/import-template";
import { feesImportTemplate } from "./fees/import-template";

/** Import templates registered by each module (stationery stock, uniform stock, fee dues). */
export type ImportTemplate = { columns: { key: string; header: string }[]; sample: Record<string, unknown>[] };
export const IMPORT_TEMPLATES: Record<string, ImportTemplate> = Object.fromEntries(
  Object.entries({ stationery: stationeryImportTemplate, uniforms: uniformsImportTemplate, fees: feesImportTemplate }).filter(([, v]) => v),
) as Record<string, ImportTemplate>;
