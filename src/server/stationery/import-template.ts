import type { ImportTemplate } from "@/server/import-templates";

/** Excel template for bulk import of stationery items and opening stock (columns + one sample row). */
export const stationeryImportTemplate: ImportTemplate | null = {
  columns: [
    { key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "category", header: "Category" }, { key: "unit", header: "Unit" },
    { key: "openingStock", header: "Opening Stock" }, { key: "unitCost", header: "Unit Cost" }, { key: "reorderLevel", header: "Reorder Level" },
    { key: "reorderQty", header: "Reorder Qty" }, { key: "supplier", header: "Supplier" },
  ],
  sample: [{ code: "", name: "Long notebook 200 pages", category: "Notebook", unit: "pcs", openingStock: 500, unitCost: 45, reorderLevel: 100, reorderQty: 400, supplier: "Sri Lakshmi Stationers" }],
};
