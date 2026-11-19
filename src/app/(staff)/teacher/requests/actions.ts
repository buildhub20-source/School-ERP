"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { createRequest, cancelRequest } from "@/server/stationery/requests";

export const newRequest = defineAction({
  perm: "stationery.request",
  schema: z.object({
    target: zs.optStr(60), purpose: zs.str(300),
    lines: zs.json(z.array(z.object({ itemId: z.string(), qty: z.coerce.number().int("Quantities must be whole numbers") }))),
  }),
  revalidate: ["/teacher", "/stationery"],
}, async (input, { branchId, user }) => {
  const [kind, id] = (input.target ?? "").split(":");
  const r = await createRequest(branchId, user.id, { purpose: input.purpose, lines: input.lines, classId: kind === "c" ? id : undefined, departmentId: kind === "d" ? id : undefined });
  return { id: r.id, requestNo: r.requestNo };
});

export const cancelMyRequest = defineAction({ perm: "stationery.request", schema: z.object({ id: zs.id }), revalidate: ["/teacher", "/stationery"] }, async ({ id }, { branchId, user }) => {
  await cancelRequest(branchId, user.id, id);
  return true;
});
