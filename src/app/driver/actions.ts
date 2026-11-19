"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { endTrip, markBoarding, startTrip } from "@/server/transport/trips";

export const startTripAction = defineAction({ perm: "driver.portal", revalidate: "/driver", schema: z.object({ type: z.enum(["PICKUP", "DROP"]) }) }, async ({ type }, { user }) => {
  const t = await startTrip(user.id, type);
  return { id: t.id };
});

export const endTripAction = defineAction({ perm: "driver.portal", revalidate: "/driver", schema: z.object({ tripId: zs.id }) }, async ({ tripId }, { user }) => {
  await endTrip(user.id, tripId);
  return true;
});

export const boardingAction = defineAction({
  perm: "driver.portal", revalidate: "/driver",
  schema: z.object({ tripId: zs.id, studentId: zs.id, event: z.enum(["BOARDED", "ALIGHTED"]), method: z.enum(["APP", "SCAN"]).default("APP") }),
}, async (input, { user }) => {
  const r = await markBoarding(user.id, input);
  return { studentName: r.studentName, event: r.record.event };
});
