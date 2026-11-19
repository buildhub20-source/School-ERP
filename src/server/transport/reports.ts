import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { className, fullName, round2, today, toNum } from "@/lib/format";
import { automation } from "@/lib/automations/config";
import { DOC_LABELS, daysUntil, docStatus } from "./helpers";

export const transportReports: ReportDef[] = [
  {
    key: "transport-route-students",
    title: "Route-wise student list",
    description: "Students on each route and stop with pickup/drop times and parent contact.",
    module: "Transport",
    perm: "reports.transport",
    filters: ["route", "bus", "class"],
    async run(f, { branchId }) {
      const allocs = await db.transportAllocation.findMany({
        where: {
          status: "ACTIVE", student: { branchId, status: "ACTIVE", ...(f.classId ? { classId: f.classId } : {}) },
          ...(f.routeId ? { routeId: f.routeId } : {}), ...(f.busId ? { busId: f.busId } : {}),
        },
        include: { route: true, bus: true, stop: true, student: { include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } } },
        orderBy: [{ route: { code: "asc" } }, { stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
      });
      return {
        columns: [
          { key: "route", label: "Route" }, { key: "bus", label: "Bus" }, { key: "seq", label: "#", format: "number", align: "right" }, { key: "stop", label: "Stop" },
          { key: "pickup", label: "Pickup" }, { key: "drop", label: "Drop" }, { key: "student", label: "Student" }, { key: "admissionNo", label: "Adm. no" },
          { key: "class", label: "Class" }, { key: "parent", label: "Parent" }, { key: "phone", label: "Phone" },
        ],
        rows: allocs.map((a) => ({
          route: `${a.route.code} · ${a.route.name}`, bus: a.bus.busNo, seq: a.stop.sequence, stop: a.stop.name, pickup: a.stop.pickupTime ?? "", drop: a.stop.dropTime ?? "",
          student: fullName(a.student), admissionNo: a.student.admissionNo, class: className(a.student.schoolClass, a.student.section),
          parent: a.student.guardians[0]?.guardian.name ?? "", phone: a.student.guardians[0]?.guardian.phone ?? "",
        })),
        totals: { route: `${allocs.length} students` },
      };
    },
  },
  {
    key: "transport-bus-occupancy",
    title: "Bus occupancy",
    description: "Seats filled vs capacity for every bus, with over-capacity and nearly-full buses flagged.",
    module: "Transport",
    perm: "reports.transport",
    filters: ["bus", "route"],
    async run(f, { branchId }) {
      const buses = await db.bus.findMany({
        where: { branchId, isActive: true, ...(f.busId ? { id: f.busId } : {}), ...(f.routeId ? { routes: { some: { id: f.routeId } } } : {}) },
        include: { driver: true, attendant: true, routes: { where: { isActive: true } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } },
        orderBy: { busNo: "asc" },
      });
      const rows = buses.map((b) => {
        const filled = b._count.allocations;
        return {
          bus: b.busNo, registrationNo: b.registrationNo, routes: b.routes.map((r) => r.code).join(", "), driver: b.driver?.name ?? "", attendant: b.attendant?.name ?? "",
          capacity: b.capacity, filled, free: Math.max(0, b.capacity - filled), percent: b.capacity ? round2((filled / b.capacity) * 100) : 0,
          status: filled > b.capacity ? `Over capacity by ${filled - b.capacity}` : filled === b.capacity ? "Full" : b.capacity && filled / b.capacity >= 0.9 ? "Nearly full" : "OK",
        };
      });
      const cap = rows.reduce((s, r) => s + r.capacity, 0), filled = rows.reduce((s, r) => s + r.filled, 0);
      return {
        columns: [
          { key: "bus", label: "Bus" }, { key: "registrationNo", label: "Registration" }, { key: "routes", label: "Routes" }, { key: "driver", label: "Driver" }, { key: "attendant", label: "Attendant" },
          { key: "capacity", label: "Capacity", format: "number", align: "right" }, { key: "filled", label: "Filled", format: "number", align: "right" },
          { key: "free", label: "Free", format: "number", align: "right" }, { key: "percent", label: "% filled", format: "number", align: "right" },
          { key: "status", label: "Status" },
        ],
        rows,
        note: rows.some((r) => r.status !== "OK") ? `${rows.filter((r) => r.status.startsWith("Over")).length} bus(es) over capacity, ${rows.filter((r) => r.status === "Full" || r.status === "Nearly full").length} full or nearly full (90% or more).` : "All buses have free seats.",
        totals: { bus: "Total", capacity: cap, filled, free: Math.max(0, cap - filled), percent: cap ? round2((filled / cap) * 100) : 0 },
        chart: { type: "bar", x: "bus", y: ["capacity", "filled"] },
      };
    },
  },
  {
    key: "transport-maintenance-cost",
    title: "Maintenance cost per bus",
    description: "Service, repair, tyre and other maintenance costs plus fuel, per bus, for the period.",
    module: "Transport",
    perm: "reports.transport",
    filters: ["dateRange", "bus"],
    async run(f, { branchId }) {
      const date = dateWhere(f, true);
      const busWhere = { branchId, ...(f.busId ? { id: f.busId } : {}) };
      const [buses, maint, fuel] = await Promise.all([
        db.bus.findMany({ where: busWhere, orderBy: { busNo: "asc" } }),
        db.maintenanceRecord.groupBy({ by: ["busId", "type"], where: { bus: busWhere, ...(date ? { date } : {}) }, _sum: { cost: true }, _count: true }),
        db.fuelLog.groupBy({ by: ["busId"], where: { bus: busWhere, ...(date ? { date } : {}) }, _sum: { cost: true, litres: true } }),
      ]);
      const rows = buses.map((b) => {
        const m = (t: string) => toNum(maint.find((x) => x.busId === b.id && x.type === t)?._sum.cost);
        const fl = fuel.find((x) => x.busId === b.id);
        const service = m("SERVICE"), repair = m("REPAIR"), tyres = m("TYRES"), other = m("OTHER");
        const fuelCost = toNum(fl?._sum.cost);
        const maintenance = round2(service + repair + tyres + other);
        return { bus: b.busNo, registrationNo: b.registrationNo, service, repair, tyres, other, maintenance, litres: toNum(fl?._sum.litres), fuel: fuelCost, total: round2(maintenance + fuelCost) };
      });
      const sum = (k: keyof (typeof rows)[number]) => round2(rows.reduce((s, r) => s + (r[k] as number), 0));
      return {
        columns: [
          { key: "bus", label: "Bus" }, { key: "registrationNo", label: "Registration" },
          { key: "service", label: "Service", format: "money", align: "right" }, { key: "repair", label: "Repairs", format: "money", align: "right" },
          { key: "tyres", label: "Tyres", format: "money", align: "right" }, { key: "other", label: "Other", format: "money", align: "right" },
          { key: "maintenance", label: "Maintenance total", format: "money", align: "right" }, { key: "litres", label: "Fuel (L)", format: "number", align: "right" },
          { key: "fuel", label: "Fuel cost", format: "money", align: "right" }, { key: "total", label: "Total cost", format: "money", align: "right" },
        ],
        rows,
        totals: { bus: "Total", service: sum("service"), repair: sum("repair"), tyres: sum("tyres"), other: sum("other"), maintenance: sum("maintenance"), litres: sum("litres"), fuel: sum("fuel"), total: sum("total") },
        chart: { type: "bar", x: "bus", y: ["maintenance", "fuel"] },
      };
    },
  },
  {
    key: "transport-document-expiry",
    title: "Document expiry",
    description: "Insurance, fitness, permit, pollution and driver licence expiry dates with status.",
    module: "Transport",
    perm: "reports.transport",
    filters: ["bus", "status"],
    statusFilter: { label: "Any status", options: [{ value: "VALID", label: "Valid" }, { value: "EXPIRING", label: "Expiring soon" }, { value: "EXPIRED", label: "Expired" }] },
    async run(f, { branchId }) {
      const daysBefore = Number((await automation("transport.docExpiry")).config.daysBefore ?? 30) || 30;
      const t = today();
      const docs = await db.transportDocument.findMany({
        where: { isCurrent: true, AND: [{ OR: [{ bus: { branchId } }, { staff: { branchId } }] }, ...(f.busId ? [{ OR: [{ busId: f.busId }, { staff: { drivesBus: { id: f.busId } } }] }] : [])] },
        include: { bus: true, staff: { include: { drivesBus: true } } },
        orderBy: { expiryDate: "asc" },
      });
      const rows = docs
        .map((d) => ({
          owner: d.bus?.busNo ?? d.staff?.name ?? "", bus: d.bus?.busNo ?? d.staff?.drivesBus?.busNo ?? "", type: DOC_LABELS[d.type], number: d.number ?? "",
          issueDate: d.issueDate, expiryDate: d.expiryDate, daysLeft: daysUntil(d.expiryDate, t), status: docStatus(d.expiryDate, t, daysBefore),
        }))
        .filter((r) => !f.status || r.status === f.status);
      return {
        columns: [
          { key: "owner", label: "Bus / driver" }, { key: "bus", label: "Bus" }, { key: "type", label: "Document" }, { key: "number", label: "Number" },
          { key: "issueDate", label: "Issued", format: "date" }, { key: "expiryDate", label: "Expires", format: "date" },
          { key: "daysLeft", label: "Days left", format: "number", align: "right" }, { key: "status", label: "Status" },
        ],
        rows,
        note: `Expiring soon = expires within ${daysBefore} days.`,
      };
    },
  },
];
