"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { closeYearAndPromote } from "@/server/students/promotion";

export const runPromotion = defineAction({
  perm: "students.promote", revalidate: "/",
  schema: z.object({ detainIds: z.array(z.string()).default([]), copyFeeStructure: zs.bool(), carryTransport: zs.bool(), openPreorders: zs.bool(), confirm: z.literal("CLOSE", { message: "Type CLOSE to confirm" }) }),
}, async (i, { branchId }) => closeYearAndPromote(branchId, i));
