/** Permission catalog. The Super Admin edits which role holds which permission in Settings → Roles. */
export const PERMISSIONS = {
  "dashboard.view": "View the admin dashboard",
  "search.global": "Use global search",
  "students.view": "View student records",
  "students.manage": "Add and edit students, parents and classes",
  "students.import": "Bulk import from Excel",
  "students.promote": "Promote students, close academic year",
  "class.view": "View own class list (teachers)",
  "attendance.view": "View student attendance for every class",
  "attendance.mark": "Mark today's attendance for own class (class teachers)",
  "attendance.manage": "Mark or correct student attendance for any class and any past day",
  "stationery.view": "View stationery stock",
  "stationery.manage": "Manage stationery items, purchases, suppliers, kits, budgets and audits",
  "stationery.approve": "Approve, reject and issue stationery requests",
  "stationery.request": "Request stationery",
  "uniforms.view": "View uniform stock and orders",
  "uniforms.manage": "Manage uniform items, sizes, stock, sets and purchases",
  "uniforms.orders": "Create and process uniform orders and record uniform payments",
  "fees.view": "View fee accounts and payments",
  "fees.setup": "Set up fee heads, structures, instalments and late fee rules",
  "fees.collect": "Collect fees and issue receipts",
  "fees.concession.request": "Request concessions and scholarships",
  "fees.concession.approve": "Approve concessions and scholarships",
  "fees.refund.request": "Request refunds and fee adjustments",
  "fees.refund.approve": "Approve refunds and fee adjustments",
  "fees.cashbook": "Daily cash book and day-end closing",
  "fees.export": "Export to Excel / Tally",
  "transport.view": "View buses, routes and allocations",
  "transport.manage": "Manage buses, staff, routes, stops, allocation and maintenance",
  "transport.fees.view": "See transport fee details",
  "reports.stationery": "Stationery reports",
  "reports.uniforms": "Uniform reports",
  "reports.fees": "Fee reports",
  "reports.transport": "Transport reports",
  "reports.students": "Student reports",
  "library.view": "View the library catalogue and loans",
  "library.manage": "Manage books, copies and library rules",
  "library.circulate": "Issue, return and renew library books",
  "reports.library": "Library reports",
  "assets.view": "View the asset register",
  "assets.manage": "Add, move, repair, verify and dispose of assets",
  "reports.assets": "Asset reports",
  "hostel.view": "View hostels, rooms and residents",
  "hostel.manage": "Manage hostels, rooms, allocations and hostel fees",
  "hostel.warden": "Hostel roll call and outpasses",
  "reports.hostel": "Hostel reports",
  "hr.view": "View the staff directory, staff attendance and leave",
  "hr.manage": "Add and edit staff profiles, documents, leave types, leave balances and HR rules",
  "hr.attendance": "Mark daily staff attendance",
  "hr.leave.approve": "Approve or reject staff leave",
  "hr.self": "Apply for own leave, check in and see own attendance",
  "reports.hr": "HR reports",
  "approvals.view": "Approvals inbox",
  "circulars.manage": "Send circulars and manage events",
  "outbox.view": "View message outbox",
  "settings.manage": "Change system settings, automations, integrations and backups",
  "users.manage": "Manage user accounts",
  "roles.manage": "Change role permissions",
  "audit.view": "View the audit log",
  "parent.portal": "Parent portal",
  "driver.portal": "Driver / attendant mobile view",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; prefix: string[] }[] = [
  { label: "General", prefix: ["dashboard", "search", "approvals", "circulars", "outbox"] },
  { label: "Students", prefix: ["students", "class", "attendance"] },
  { label: "Stationery", prefix: ["stationery"] },
  { label: "Uniforms", prefix: ["uniforms"] },
  { label: "Fees", prefix: ["fees"] },
  { label: "Transport", prefix: ["transport"] },
  { label: "Library", prefix: ["library"] },
  { label: "Assets", prefix: ["assets"] },
  { label: "Hostel", prefix: ["hostel"] },
  { label: "HR", prefix: ["hr"] },
  { label: "Reports", prefix: ["reports"] },
  { label: "Administration", prefix: ["settings", "users", "roles", "audit"] },
  { label: "Portals", prefix: ["parent", "driver"] },
];

export const ROLE_KEYS = ["SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT", "STORE_MANAGER", "TRANSPORT_MANAGER", "LIBRARIAN", "HOSTEL_WARDEN", "HR_MANAGER", "TEACHER", "PARENT", "DRIVER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const DEFAULT_ROLES: Record<RoleKey, { name: string; description: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: "Super Admin", description: "Complete control over the entire system", permissions: ALL_PERMISSIONS.filter((p) => !p.endsWith(".portal") && p !== "stationery.request" && p !== "class.view" && p !== "attendance.mark" && p !== "hr.self") },
  SCHOOL_ADMIN: {
    name: "School Admin",
    description: "Runs the school day to day: add and edit everything in every module, approvals, all reports (settings, users and roles stay with the Super Admin)",
    permissions: [
      "dashboard.view", "search.global", "students.view", "students.manage", "students.import", "students.promote", "attendance.view", "attendance.manage",
      "stationery.view", "stationery.manage", "stationery.approve",
      "uniforms.view", "uniforms.manage", "uniforms.orders",
      "fees.view", "fees.setup", "fees.collect", "fees.concession.request", "fees.concession.approve", "fees.refund.request", "fees.refund.approve", "fees.cashbook", "fees.export",
      "transport.view", "transport.manage", "transport.fees.view",
      "library.view", "library.manage", "library.circulate", "assets.view", "assets.manage", "hostel.view", "hostel.manage", "hostel.warden",
      "hr.view", "hr.manage", "hr.attendance", "hr.leave.approve", "hr.self",
      "reports.stationery", "reports.uniforms", "reports.fees", "reports.transport", "reports.students", "reports.library", "reports.assets", "reports.hostel", "reports.hr",
      "approvals.view", "circulars.manage", "outbox.view",
    ],
  },
  ACCOUNTANT: {
    name: "Accountant",
    description: "Fee collection, receipts, concessions (with approval), refunds, fee reports",
    permissions: [
      "dashboard.view", "search.global", "students.view", "fees.view", "fees.setup", "fees.collect", "fees.concession.request",
      "fees.refund.request", "fees.cashbook", "fees.export", "transport.fees.view", "reports.fees", "hr.self",
    ],
  },
  STORE_MANAGER: {
    name: "Store Manager",
    description: "Stationery and uniform stock, purchases, suppliers, issue and approve requests",
    permissions: [
      "dashboard.view", "search.global", "students.view", "stationery.view", "stationery.manage", "stationery.approve",
      "uniforms.view", "uniforms.manage", "uniforms.orders", "reports.stationery", "reports.uniforms",
      "assets.view", "assets.manage", "reports.assets", "hr.self",
    ],
  },
  TRANSPORT_MANAGER: {
    name: "Transport Manager",
    description: "Buses, drivers, routes, stops, allocation, maintenance",
    permissions: ["dashboard.view", "search.global", "students.view", "transport.view", "transport.manage", "transport.fees.view", "reports.transport", "hr.self"],
  },
  LIBRARIAN: {
    name: "Librarian",
    description: "Library catalogue, copies, issue, return, renewals and fines",
    permissions: ["dashboard.view", "search.global", "students.view", "library.view", "library.manage", "library.circulate", "reports.library", "hr.self"],
  },
  HOSTEL_WARDEN: {
    name: "Hostel Warden",
    description: "Hostel rooms, residents, roll call and outpasses",
    permissions: ["dashboard.view", "search.global", "students.view", "hostel.view", "hostel.manage", "hostel.warden", "reports.hostel", "hr.self"],
  },
  HR_MANAGER: {
    name: "HR / Office Manager",
    description: "Staff profiles and documents, daily staff attendance, leave records and balances, HR reports",
    permissions: ["dashboard.view", "search.global", "hr.view", "hr.manage", "hr.attendance", "reports.hr", "hr.self"],
  },
  TEACHER: { name: "Teacher", description: "Request stationery, view class list, mark class attendance, apply for leave and check in", permissions: ["stationery.request", "class.view", "attendance.mark", "hr.self"] },
  PARENT: { name: "Parent", description: "View and pay fees, receipts, uniform orders, bus details", permissions: ["parent.portal"] },
  DRIVER: { name: "Driver / Attendant", description: "Route, student list, boarding attendance", permissions: ["driver.portal"] },
};

export function hasPerm(user: { roleKey: string; permissions: string[] } | null | undefined, perm: Permission | Permission[]): boolean {
  if (!user) return false;
  const perms = Array.isArray(perm) ? perm : [perm];
  return perms.some((p) => user.permissions.includes(p));
}
