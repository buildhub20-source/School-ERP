import type { ImportTemplate } from "@/server/import-templates";
/** Excel template for bulk import of opening fee dues and past payments (matched by admission number). */
export const feesImportTemplate: ImportTemplate | null = {
  columns: [
    { key: "admissionNo", header: "Admission No" }, { key: "type", header: "Type" }, { key: "feeHead", header: "Fee Head" },
    { key: "description", header: "Description" }, { key: "amount", header: "Amount" }, { key: "dueDate", header: "Due Date" },
    { key: "paymentDate", header: "Payment Date" }, { key: "mode", header: "Mode" }, { key: "reference", header: "Reference" },
  ],
  sample: [
    { admissionNo: "ADM20260001", type: "DUE", feeHead: "Tuition Fee", description: "Opening balance — previous year", amount: 4500, dueDate: "15/04/2026" },
    { admissionNo: "ADM20260001", type: "PAYMENT", amount: 2000, paymentDate: "20/05/2026", mode: "Cash", reference: "Old receipt 1123" },
  ],
};
