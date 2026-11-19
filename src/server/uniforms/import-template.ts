import type { ImportTemplate } from "@/server/import-templates";

/** Excel template for bulk import of uniform items, sizes and opening stock (one row per item size). */
export const uniformsImportTemplate: ImportTemplate | null = {
  columns: [
    { key: "item", header: "Item" },
    { key: "category", header: "Category" },
    { key: "gender", header: "Gender" },
    { key: "size", header: "Size" },
    { key: "sizeOrder", header: "Size order" },
    { key: "price", header: "Price" },
    { key: "stock", header: "Stock" },
    { key: "reorderLevel", header: "Reorder level" },
    { key: "sku", header: "SKU" },
  ],
  sample: [
    { item: "Shirt (white)", category: "Shirt", gender: "Boy", size: "30", sizeOrder: 30, price: 420, stock: 25, reorderLevel: 5, sku: "SHB-30" },
    { item: "Shirt (white)", category: "Shirt", gender: "Boy", size: "32", sizeOrder: 32, price: 440, stock: 18, reorderLevel: 5, sku: "SHB-32" },
    { item: "School tie", category: "Tie", gender: "Unisex", size: "Free", sizeOrder: 1, price: 120, stock: 60, reorderLevel: 15, sku: "" },
  ],
};
