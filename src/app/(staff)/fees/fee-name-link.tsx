import Link from "next/link";

export type LineReceipt = { id: string; receiptNo: string };

/**
 * A fee line's name. When receipts have paid towards the line, the name opens the latest receipt
 * (print, cancel, refund). Staff without full fee access cannot open the receipt page, so for them it opens the PDF.
 * A line paid across several receipts lists the earlier ones underneath.
 */
export function FeeNameLink({ name, receipts, full }: { name: string; receipts: LineReceipt[]; full: boolean }) {
  if (!receipts.length) return <>{name}</>;
  const sorted = [...receipts].sort((a, b) => b.receiptNo.localeCompare(a.receiptNo));
  const href = (r: LineReceipt) => (full ? `/fees/payments/${r.id}` : `/api/fees/receipts/${r.id}`);
  const ext = full ? {} : { target: "_blank", rel: "noreferrer" };
  return (
    <>
      <Link href={href(sorted[0])} prefetch={false} {...ext} className="text-brand-700 hover:underline" title={`Receipt ${sorted[0].receiptNo}`}>{name}</Link>
      {sorted.length > 1 && (
        <span className="block text-xs text-slate-500">
          also{" "}
          {sorted.slice(1).map((r, i) => (
            <span key={r.id}>{i > 0 && ", "}<Link href={href(r)} prefetch={false} {...ext} className="font-mono hover:text-brand-700 hover:underline">{r.receiptNo.split("/").pop()}</Link></span>
          ))}
        </span>
      )}
    </>
  );
}
