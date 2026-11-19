"use client";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/client";
import { deleteBookAction } from "../actions";

/** Delete a book with no loan history, then go back to the catalogue. */
export function DeleteBookButton({ id, title, copies }: { id: string; title: string; copies: number }) {
  const router = useRouter();
  return (
    <ActionButton action={deleteBookAction} args={{ id }} variant="danger" confirm={`Delete "${title}" and its ${copies} cop${copies === 1 ? "y" : "ies"}?`}
      successMessage="Book deleted" onSuccess={() => router.push("/library/books")}>Delete book</ActionButton>
  );
}
