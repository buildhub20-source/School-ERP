"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { saveSetting, WEEKDAYS } from "@/lib/settings";
import { addRooms, allocateBed, changeRoom, createOutpass, markReturned, saveHostel, saveRollCall, saveRoom, vacate } from "@/server/hostel/service";
import { dateOnly } from "@/lib/format";

const H = "/hostel";
const optId = () => z.string().optional().transform((v) => (v ? v : undefined));

export const saveHostelAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ id: optId(), name: zs.str(80), type: z.enum(["BOYS", "GIRLS", "MIXED"]), wardenName: zs.optStr(100), phone: zs.optStr(20), feePerTerm: zs.money(), notes: zs.optStr(500), isActive: zs.bool().optional() }),
}, async (input, { branchId }) => ({ id: (await saveHostel(branchId, input)).id }));

export const saveRoomAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ id: optId(), hostelId: zs.id, roomNo: zs.str(20), floor: zs.optStr(20), capacity: zs.int(1), roomType: zs.optStr(60), feePerTerm: zs.optMoney(), isActive: zs.bool().optional() }),
}, async (input, { branchId }) => { await saveRoom(branchId, input); return true; });

export const addRoomsAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ hostelId: zs.id, from: zs.int(0), to: zs.int(0), prefix: zs.optStr(5), floor: zs.optStr(20), capacity: zs.int(1), roomType: zs.optStr(60) }),
}, async (input, { branchId }) => ({ message: `Added ${await addRooms(branchId, input)} room(s)` }));

export const allocateBedAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ studentId: zs.id, roomId: zs.id, bedNo: zs.optStr(10), startDate: zs.optDate(), notes: zs.optStr(300) }),
}, async (input, { branchId }) => {
  const r = await allocateBed(branchId, input);
  return { message: `${r.who} → ${r.room}${r.fees ? ` · hostel fee added for ${r.fees} term${r.fees === 1 ? "" : "s"}` : ""}` };
});

export const changeRoomAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ allocationId: zs.id, roomId: zs.id, bedNo: zs.optStr(10) }),
}, async ({ allocationId, roomId, bedNo }, { branchId }) => { await changeRoom(branchId, allocationId, roomId, bedNo); return true; });

export const vacateAction = defineAction({
  perm: "hostel.manage", revalidate: H,
  schema: z.object({ allocationId: zs.id, endDate: zs.date() }),
}, async ({ allocationId, endDate }, { branchId }) => {
  const r = await vacate(branchId, allocationId, endDate);
  return { message: `Bed freed${r.cancelledFees ? ` · ${r.cancelledFees} unpaid future term fee(s) cancelled` : ""}` };
});

export const createOutpassAction = defineAction({
  perm: "hostel.warden", revalidate: H,
  schema: z.object({ studentId: zs.id, expectedReturn: z.coerce.date(), reason: zs.str(300), escortName: zs.optStr(100), escortPhone: zs.optStr(20) }),
}, async (input, { branchId, user }) => { await createOutpass(branchId, user.name, input); return true; });

export const markReturnedAction = defineAction({ perm: "hostel.warden", revalidate: H, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  await markReturned(branchId, id);
  return true;
});

export const saveRollCallAction = defineAction({
  perm: "hostel.warden", revalidate: H,
  schema: z.object({ hostelId: zs.id, date: zs.date(), session: z.enum(["NIGHT", "MORNING"]), entries: zs.json(z.array(z.object({ studentId: z.string(), status: z.enum(["PRESENT", "ABSENT", "ON_LEAVE"]) }))) }),
}, async ({ hostelId, date, session, entries }, { branchId, user }) => {
  const r = await saveRollCall(branchId, user.name, { hostelId, date: dateOnly(date), session, entries });
  return { message: `Roll call saved: ${r.marked} marked${r.absent ? `, ${r.absent} absent (hostel managers alerted)` : ""}` };
});

const meal = z.object({ breakfast: zs.optStr(200), lunch: zs.optStr(200), snacks: zs.optStr(200), dinner: zs.optStr(200) });
const menuSchema = z.object({
  Monday: zs.json(meal), Tuesday: zs.json(meal), Wednesday: zs.json(meal), Thursday: zs.json(meal), Friday: zs.json(meal), Saturday: zs.json(meal), Sunday: zs.json(meal),
});
export const saveMenuAction = defineAction({ perm: "hostel.manage", revalidate: H, schema: menuSchema }, async (menu, { branchId }) => {
  const clean = Object.fromEntries(WEEKDAYS.map((d) => [d, { breakfast: menu[d].breakfast ?? "", lunch: menu[d].lunch ?? "", snacks: menu[d].snacks ?? "", dinner: menu[d].dinner ?? "" }]));
  await saveSetting("hostelMenu", clean as never, branchId);
  return true;
});
