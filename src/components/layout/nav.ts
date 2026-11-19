import type { DictKey } from "@/lib/i18n/dict";
import type { Permission } from "@/lib/permissions";

export type NavItem = { href: string; label: string; perm?: Permission | Permission[] };
/** Sidebar group heading (English, like the other staff labels). */
export type NavGroup = "Overview" | "Operations" | "People" | "Campus" | "Insights" | "Communication" | "Administration";
export type NavSection = { key: DictKey; href: string; icon: string; perm: Permission | Permission[]; group: NavGroup; children?: NavItem[] };

/** Staff navigation. Items are shown only to users holding the permission. */
export const NAV: NavSection[] = [
  { key: "nav.dashboard", group: "Overview", href: "/dashboard", icon: "LayoutDashboard", perm: "dashboard.view" },
  { key: "nav.myRequests", group: "Overview", href: "/teacher", icon: "ClipboardList", perm: "stationery.request" },
  { key: "nav.myClass", group: "Overview", href: "/teacher/class", icon: "Users", perm: "class.view" },
  { key: "nav.classAttendance", group: "Overview", href: "/attendance/mark", icon: "ClipboardCheck", perm: "attendance.mark" },
  { key: "nav.myLeave", group: "Overview", href: "/my-hr", icon: "CalendarCheck", perm: "hr.self" },
  { key: "nav.approvals", group: "Overview", href: "/approvals", icon: "CheckSquare", perm: "approvals.view" },
  {
    key: "nav.students", group: "Operations", href: "/students", icon: "GraduationCap", perm: "students.view",
    children: [
      { href: "/students", label: "All students" },
      { href: "/students/new", label: "Add student", perm: "students.manage" },
      { href: "/students/import", label: "Bulk import", perm: "students.import" },
      
      { href: "/students/promotion", label: "Promotion & year close", perm: "students.promote" },
    ],
  },
  {
    key: "nav.studentAttendance", group: "Operations", href: "/attendance", icon: "ClipboardCheck", perm: ["attendance.view", "attendance.manage"],
    children: [
      { href: "/attendance", label: "Today" },
      { href: "/attendance/mark", label: "Mark a class", perm: "attendance.manage" },
      { href: "/attendance/month", label: "Monthly view" },
      { href: "/attendance/report", label: "Send report", perm: "attendance.manage" },
    ],
  },
  {
    key: "nav.stationery", group: "Operations", href: "/stationery", icon: "PencilRuler", perm: "stationery.view",
    children: [
      { href: "/stationery", label: "Overview" },
      { href: "/stationery/items", label: "Items & stock" },
      { href: "/stationery/requests", label: "Requests" },
      { href: "/stationery/issue", label: "Issue / return", perm: "stationery.manage" },
      { href: "/stationery/purchases", label: "Purchase orders" },
      { href: "/stationery/suppliers", label: "Suppliers" },
      { href: "/stationery/kits", label: "Class kits" },
      { href: "/stationery/budgets", label: "Budgets" },
      { href: "/stationery/audits", label: "Stock audits" },
      { href: "/stationery/movements", label: "Stock movements" },
      { href: "/stationery/scan", label: "Scan in / out", perm: "stationery.manage" },
      { href: "/stationery/import", label: "Import stock", perm: "stationery.manage" },
    ],
  },
  {
    key: "nav.uniforms", group: "Operations", href: "/uniforms", icon: "Shirt", perm: "uniforms.view",
    children: [
      { href: "/uniforms", label: "Overview" },
      { href: "/uniforms/stock", label: "Size-wise stock" },
      { href: "/uniforms/items", label: "Items & sizes" },
      { href: "/uniforms/orders", label: "Orders" },
      { href: "/uniforms/orders/new", label: "New order", perm: "uniforms.orders" },
      { href: "/uniforms/sets", label: "Uniform sets" },
      { href: "/uniforms/purchases", label: "Purchases" },
      { href: "/uniforms/preorders", label: "Pre-order demand" },
      { href: "/uniforms/planning", label: "Seasonal planning" },
      { href: "/uniforms/id-cards", label: "ID cards" },
    ],
  },
  {
    key: "nav.fees", group: "Operations", href: "/fees", icon: "IndianRupee", perm: ["fees.view", "transport.fees.view"],
    children: [
      { href: "/fees", label: "Overview", perm: "fees.view" },
      { href: "/fees/collect", label: "Collect fee", perm: "fees.collect" },
      { href: "/fees/accounts", label: "Student accounts", perm: ["fees.view", "transport.fees.view"] },
      { href: "/fees/payments", label: "Payments & receipts", perm: "fees.view" },
      { href: "/fees/defaulters", label: "Defaulters", perm: "fees.view" },
      { href: "/fees/concessions", label: "Concessions", perm: ["fees.concession.request", "fees.concession.approve"] },
      { href: "/fees/refunds", label: "Refunds & adjustments", perm: ["fees.refund.request", "fees.refund.approve"] },
      { href: "/fees/cashbook", label: "Cash book & closing", perm: "fees.cashbook" },
      { href: "/fees/structure", label: "Fee structure", perm: "fees.setup" },
      { href: "/fees/export", label: "Export / Tally", perm: "fees.export" },
    ],
  },
  {
    key: "nav.transport", group: "Operations", href: "/transport", icon: "Bus", perm: "transport.view",
    children: [
      { href: "/transport", label: "Overview" },
      { href: "/transport/buses", label: "Buses" },
      { href: "/transport/routes", label: "Routes & stops" },
      { href: "/transport/allocations", label: "Student allocation" },
      { href: "/transport/staff", label: "Drivers & attendants" },
      { href: "/transport/documents", label: "Documents" },
      { href: "/transport/maintenance", label: "Maintenance & fuel" },
      { href: "/transport/map", label: "Route map" },
      { href: "/transport/live", label: "Live tracking" },
      { href: "/transport/attendance", label: "Boarding attendance" },
      { href: "/transport/fees", label: "Transport fees" },
    ],
  },
  {
    key: "nav.hr", group: "People", href: "/hr", icon: "IdCard", perm: "hr.view",
    children: [
      { href: "/hr", label: "Overview" },
      { href: "/hr/staff", label: "Staff" },
      { href: "/hr/attendance", label: "Attendance" },
      { href: "/hr/attendance/month", label: "Monthly register" },
      { href: "/hr/leave", label: "Leave" },
      { href: "/hr/rules", label: "Leave types & rules", perm: "hr.manage" },
    ],
  },
  {
    key: "nav.library", group: "Campus", href: "/library", icon: "LibraryBig", perm: "library.view",
    children: [
      { href: "/library", label: "Overview" },
      { href: "/library/issue", label: "Issue a book", perm: "library.circulate" },
      { href: "/library/return", label: "Return a book", perm: "library.circulate" },
      { href: "/library/books", label: "Catalogue" },
      { href: "/library/loans", label: "Loans" },
      { href: "/library/rules", label: "Rules", perm: "library.manage" },
    ],
  },
  {
    key: "nav.assets", group: "Campus", href: "/assets", icon: "Boxes", perm: "assets.view",
    children: [
      { href: "/assets", label: "Register" },
      { href: "/assets/verify", label: "Verify", perm: "assets.manage" },
    ],
  },
  {
    key: "nav.hostel", group: "Campus", href: "/hostel", icon: "BedDouble", perm: "hostel.view",
    children: [
      { href: "/hostel", label: "Overview" },
      { href: "/hostel/residents", label: "Residents" },
      { href: "/hostel/roll-call", label: "Roll call", perm: "hostel.warden" },
      { href: "/hostel/outpasses", label: "Outpasses" },
      { href: "/hostel/menu", label: "Mess menu" },
    ],
  },
  { key: "nav.reports", group: "Insights", href: "/reports", icon: "FileBarChart", perm: ["reports.fees", "reports.stationery", "reports.uniforms", "reports.transport", "reports.students", "reports.library", "reports.assets", "reports.hostel", "reports.hr"] },
  { key: "nav.analytics", group: "Insights", href: "/analytics", icon: "LineChart", perm: ["reports.fees", "reports.stationery", "reports.uniforms", "reports.transport"] },
  { key: "nav.circulars", group: "Communication", href: "/circulars", icon: "Megaphone", perm: "circulars.manage" },
  { key: "nav.outbox", group: "Communication", href: "/outbox", icon: "Send", perm: "outbox.view" },
  { key: "nav.audit", group: "Administration", href: "/audit", icon: "History", perm: "audit.view" },
  {
    key: "nav.settings", group: "Administration", href: "/settings", icon: "Settings", perm: ["settings.manage", "users.manage", "roles.manage"],
    children: [
      { href: "/settings", label: "School profile", perm: "settings.manage" },
      { href: "/settings/academic", label: "Academic years & classes", perm: "settings.manage" },
      { href: "/settings/users", label: "Users", perm: "users.manage" },
      { href: "/settings/roles", label: "Roles & permissions", perm: "roles.manage" },
      { href: "/settings/automations", label: "Automations", perm: "settings.manage" },
      { href: "/settings/policies", label: "Policies", perm: "settings.manage" },
      { href: "/settings/integrations", label: "Integrations", perm: "settings.manage" },
      { href: "/settings/branches", label: "Branches", perm: "settings.manage" },
      { href: "/settings/backups", label: "Backups", perm: "settings.manage" },
    ],
  },
];
