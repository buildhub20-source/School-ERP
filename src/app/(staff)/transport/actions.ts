"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { saveUpload } from "@/lib/uploads";
import {
  addDocument, addFuel, addMaintenance, allocateStudent, assignCrew, changeAllocation, completeReminder, deleteSlab, deleteStop,
  disableStaffLogin, enableStaffLogin, endStudentAllocation, moveStop, renewDocument, saveBus, saveRoute, setBusActive, saveSlab, saveStaff, saveStop,
  MAINTENANCE_TYPES,
} from "@/server/transport/service";
import { DOC_TYPES } from "@/server/transport/helpers";

const T = "/transport";
const optNum = () => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number().optional());
const optId = () => z.string().optional().transform((v) => (v ? v : undefined));

async function upload(file: unknown) {
  if (file instanceof File && file.size > 0) return saveUpload(file, "transport-docs", { maxMb: 5 });
  return undefined;
}

export const saveBusAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({
    id: optId(), busNo: zs.str(40), registrationNo: zs.str(20), capacity: zs.int(1), make: zs.optStr(60), model: zs.optStr(60), year: zs.optInt(),
    odometerKm: zs.optInt(), serviceIntervalKm: zs.int(500), serviceIntervalDays: zs.int(7), lastServiceDate: zs.optDate(), lastServiceKm: zs.optInt(), isActive: zs.bool().optional(),
  }),
}, async (input, { branchId }) => {
  const b = await saveBus(branchId, input);
  return { id: b.id };
});

export const setBusActiveAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id, active: zs.bool() }) }, async ({ id, active }, { branchId }) => {
  await setBusActive(branchId, id, active);
  return true;
});

export const assignCrewAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ busId: zs.id, driverId: optId(), attendantId: optId() }) }, async (i, { branchId }) => {
  await assignCrew(branchId, i.busId, i.driverId ?? null, i.attendantId ?? null);
  return true;
});

export const saveStaffAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ id: optId(), type: z.enum(["DRIVER", "ATTENDANT"]), name: zs.str(120), phone: zs.phone(), licenseNo: zs.optStr(40), address: zs.optStr(300), isActive: zs.bool().optional() }),
}, async (input, { branchId }) => ({ id: (await saveStaff(branchId, input)).id }));

export const staffLoginAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id, enable: zs.bool() }) }, async ({ id, enable }, { branchId }) => {
  if (enable) { const u = await enableStaffLogin(branchId, id); return { phone: u.phone }; }
  await disableStaffLogin(branchId, id);
  return { phone: null };
});

export const saveRouteAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ id: optId(), code: zs.str(20), name: zs.str(120), description: zs.optStr(500), busId: optId(), isActive: zs.bool().optional() }),
}, async (input, { branchId }) => ({ id: (await saveRoute(branchId, { ...input, busId: input.busId ?? null })).id }));

export const saveStopAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({
    id: optId(), routeId: zs.id, name: zs.str(120), sequence: zs.optInt(), lat: optNum(), lng: optNum(),
    pickupTime: zs.optStr(5), dropTime: zs.optStr(5), distanceKm: z.coerce.number().min(0).max(500), feeAmount: zs.optMoney(),
  }),
}, async (input, { branchId }) => ({ id: (await saveStop(branchId, input)).id }));

export const moveStopAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id, dir: z.enum(["up", "down"]) }) }, async ({ id, dir }, { branchId }) => {
  await moveStop(branchId, id, dir);
  return true;
});

export const deleteStopAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  await deleteStop(branchId, id);
  return true;
});

export const saveSlabAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ id: optId(), fromKm: z.coerce.number().min(0), toKm: z.coerce.number().min(0), amount: zs.money() }),
}, async (input, { branchId }) => ({ id: (await saveSlab(branchId, input)).id }));

export const deleteSlabAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  await deleteSlab(branchId, id);
  return true;
});

export const allocateAction = defineAction({
  perm: "transport.manage", revalidate: [T, "/students"],
  schema: z.object({ studentId: z.string().min(1, "Choose a student"), routeId: z.string().min(1, "Choose a route"), stopId: z.string().min(1, "Choose a stop"), busId: optId(), startDate: zs.optDate(), override: zs.bool() }),
}, async (input, { branchId, user }) => {
  const r = await allocateStudent(branchId, user.id, input);
  return { id: r.allocation.id, warning: r.warning, feeLines: r.feeLines };
});

export const changeAllocationAction = defineAction({
  perm: "transport.manage", revalidate: [T, "/students"],
  schema: z.object({ allocationId: zs.id, routeId: z.string().min(1, "Choose a route"), stopId: z.string().min(1, "Choose a stop"), busId: optId(), changeDate: zs.optDate(), override: zs.bool() }),
}, async (input, { branchId, user }) => {
  const r = await changeAllocation(branchId, user.id, input);
  return { id: r.allocation.id, warning: r.warning, feeLines: r.feeLines };
});

export const endAllocationAction = defineAction({
  perm: "transport.manage", revalidate: [T, "/students"],
  schema: z.object({ allocationId: zs.id, endDate: zs.optDate() }),
}, async ({ allocationId, endDate }, { branchId }) => {
  const r = await endStudentAllocation(branchId, allocationId, endDate);
  return { cancelledFees: r.cancelledFees, message: `Allocation ended${r.cancelledFees ? ` · ${r.cancelledFees} future fee line(s) cancelled` : ""}` };
});

const docSchema = z.object({
  busId: optId(), staffId: optId(), type: z.enum(DOC_TYPES), number: zs.optStr(60), issueDate: zs.optDate(), expiryDate: zs.date(), file: z.any().optional(),
});

export const addDocumentAction = defineAction({ perm: "transport.manage", revalidate: T, schema: docSchema }, async (input, { branchId }) => {
  const fileUrl = await upload(input.file);
  return { id: (await addDocument(branchId, { ...input, fileUrl })).id };
});

export const renewDocumentAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ id: zs.id, number: zs.optStr(60), issueDate: zs.optDate(), expiryDate: zs.date(), file: z.any().optional() }),
}, async (input, { branchId }) => {
  const fileUrl = await upload(input.file);
  return { id: (await renewDocument(branchId, input.id, { ...input, fileUrl })).id };
});

export const addMaintenanceAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ busId: z.string().min(1, "Choose a bus"), date: zs.date(), type: z.enum(MAINTENANCE_TYPES), description: zs.str(500), odometerKm: zs.optInt(), cost: zs.money(), vendor: zs.optStr(120) }),
}, async (input, { branchId, user }) => ({ id: (await addMaintenance(branchId, user.id, input)).id }));

export const addFuelAction = defineAction({
  perm: "transport.manage", revalidate: T,
  schema: z.object({ busId: z.string().min(1, "Choose a bus"), date: zs.date(), litres: z.coerce.number().positive().max(2000), cost: zs.money(), odometerKm: zs.optInt() }),
}, async (input, { branchId, user }) => ({ id: (await addFuel(branchId, user.id, input)).id }));

export const completeReminderAction = defineAction({ perm: "transport.manage", revalidate: T, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  await completeReminder(branchId, id);
  return true;
});
