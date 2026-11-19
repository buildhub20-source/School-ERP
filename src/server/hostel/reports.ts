import "server-only";
import type { Prisma } from "@prisma/client";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { fmtDateTime, fullName, round2, toNum } from "@/lib/format";
import { TYPE_LABEL } from "./service";

const occupancy: ReportDef = {
  key: "hostel-occupancy", title: "Hostel occupancy", module: "Hostel", perm: "reports.hostel",
  description: "Beds, residents and free beds for every hostel and room, with fees billed and collected this year.",
  filters: [],
  groupBy: [{ value: "hostel", label: "Hostel" }, { value: "room", label: "Room" }],
  async run(f, { branchId }) {
    const hostels = await db.hostel.findMany({ where: { branchId }, include: { rooms: { where: { isActive: true }, orderBy: { roomNo: "asc" }, include: { allocations: { where: { status: "ACTIVE" }, include: { fees: { where: { status: { not: "CANCELLED" } } } } } } } }, orderBy: { name: "asc" } });
    const feeOf = (fees: { amount: Prisma.Decimal; concessionAmount: Prisma.Decimal; paidAmount: Prisma.Decimal }[]) => fees.reduce((s, x) => ({ billed: s.billed + toNum(x.amount) - toNum(x.concessionAmount), paid: s.paid + toNum(x.paidAmount) }), { billed: 0, paid: 0 });
    if (f.groupBy === "room") {
      const rows = hostels.flatMap((h) => h.rooms.map((r) => {
        const fee = feeOf(r.allocations.flatMap((a) => a.fees));
        return { hostel: h.name, room: r.roomNo, type: r.roomType ?? "", beds: r.capacity, residents: r.allocations.length, free: Math.max(0, r.capacity - r.allocations.length), billed: round2(fee.billed), paid: round2(fee.paid) };
      }));
      return {
        columns: [{ key: "hostel", label: "Hostel" }, { key: "room", label: "Room" }, { key: "type", label: "Type" }, { key: "beds", label: "Beds", format: "number" }, { key: "residents", label: "Residents", format: "number" }, { key: "free", label: "Free", format: "number" }, { key: "billed", label: "Fees billed", format: "money" }, { key: "paid", label: "Fees paid", format: "money" }],
        rows, totals: { hostel: "Total", beds: rows.reduce((s, r) => s + r.beds, 0), residents: rows.reduce((s, r) => s + r.residents, 0), free: rows.reduce((s, r) => s + r.free, 0), billed: round2(rows.reduce((s, r) => s + r.billed, 0)), paid: round2(rows.reduce((s, r) => s + r.paid, 0)) },
      };
    }
    const rows = hostels.map((h) => {
      const beds = h.rooms.reduce((s, r) => s + r.capacity, 0), residents = h.rooms.reduce((s, r) => s + r.allocations.length, 0);
      const fee = feeOf(h.rooms.flatMap((r) => r.allocations.flatMap((a) => a.fees)));
      return { hostel: h.name, type: TYPE_LABEL[h.type], rooms: h.rooms.length, beds, residents, free: Math.max(0, beds - residents), percent: beds ? round2((residents / beds) * 100) : 0, billed: round2(fee.billed), paid: round2(fee.paid) };
    });
    return {
      columns: [{ key: "hostel", label: "Hostel" }, { key: "type", label: "For" }, { key: "rooms", label: "Rooms", format: "number" }, { key: "beds", label: "Beds", format: "number" }, { key: "residents", label: "Residents", format: "number" }, { key: "free", label: "Free", format: "number" }, { key: "percent", label: "% full", format: "number" }, { key: "billed", label: "Fees billed", format: "money" }, { key: "paid", label: "Fees paid", format: "money" }],
      rows, totals: { hostel: "Total", rooms: rows.reduce((s, r) => s + r.rooms, 0), beds: rows.reduce((s, r) => s + r.beds, 0), residents: rows.reduce((s, r) => s + r.residents, 0), free: rows.reduce((s, r) => s + r.free, 0), billed: round2(rows.reduce((s, r) => s + r.billed, 0)), paid: round2(rows.reduce((s, r) => s + r.paid, 0)) },
      chart: rows.length ? { type: "bar", x: "hostel", y: ["beds", "residents"] } : undefined,
    };
  },
};

const residents: ReportDef = {
  key: "hostel-residents", title: "Hostel residents", module: "Hostel", perm: "reports.hostel",
  description: "Residents with room, class and parent contact — a printable hostel register.",
  filters: ["class"],
  async run(f, { branchId }) {
    const list = await db.hostelAllocation.findMany({
      where: { branchId, status: "ACTIVE", ...(f.classId ? { student: { classId: f.classId } } : {}) },
      include: { student: { include: { schoolClass: true, section: true, guardians: { where: { isPrimary: true }, include: { guardian: true } } } }, room: { include: { hostel: true } } },
      orderBy: [{ room: { hostel: { name: "asc" } } }, { room: { roomNo: "asc" } }],
    });
    return {
      columns: [{ key: "hostel", label: "Hostel" }, { key: "room", label: "Room" }, { key: "student", label: "Student" }, { key: "adm", label: "Adm. no" }, { key: "cls", label: "Class" }, { key: "parent", label: "Parent" }, { key: "phone", label: "Phone" }, { key: "blood", label: "Blood" }],
      rows: list.map((a) => ({ hostel: a.room.hostel.name, room: a.room.roomNo + (a.bedNo ? `/${a.bedNo}` : ""), student: fullName(a.student), adm: a.student.admissionNo, cls: `${a.student.schoolClass.name}${a.student.section ? "-" + a.student.section.name : ""}`, parent: a.student.guardians[0]?.guardian.name ?? "", phone: a.student.guardians[0]?.guardian.phone ?? "", blood: a.student.bloodGroup ?? "" })),
      totals: { hostel: `${list.length} residents` },
    };
  },
};

const outpasses: ReportDef = {
  key: "hostel-outpasses", title: "Outpass register", module: "Hostel", perm: "reports.hostel",
  description: "Every outpass in the period: when residents left and came back, and who took them.",
  filters: ["dateRange"],
  async run(f, { branchId }) {
    const list = await db.hostelOutpass.findMany({ where: { branchId, outAt: dateWhere(f) }, include: { student: { include: { schoolClass: true } } }, orderBy: { outAt: "desc" } });
    const rows = list.map((p) => ({
      student: fullName(p.student), cls: p.student.schoolClass.name, out: fmtDateTime(p.outAt), due: fmtDateTime(p.expectedReturn), back: p.returnedAt ? fmtDateTime(p.returnedAt) : "Not back",
      late: p.returnedAt ? (p.returnedAt > p.expectedReturn ? "Late" : "") : (p.expectedReturn < new Date() ? "Late" : ""), reason: p.reason, escort: [p.escortName, p.escortPhone].filter(Boolean).join(" · "), approved: p.approvedByName ?? "",
    }));
    return {
      columns: [{ key: "student", label: "Student" }, { key: "cls", label: "Class" }, { key: "out", label: "Left" }, { key: "due", label: "Due back" }, { key: "back", label: "Returned" }, { key: "late", label: "Late" }, { key: "reason", label: "Reason" }, { key: "escort", label: "Picked up by" }, { key: "approved", label: "Approved by" }],
      rows, totals: { student: `${rows.length} outpasses` },
    };
  },
};

export const hostelReports: ReportDef[] = [occupancy, residents, outpasses];
