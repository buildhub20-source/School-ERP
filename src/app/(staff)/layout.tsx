import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { NAV } from "@/components/layout/nav";
import { StaffShell } from "@/components/layout/staff-shell";
import { redirect } from "next/navigation";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.permissions.includes("parent.portal")) redirect("/parent");
  if (user.permissions.includes("driver.portal")) redirect("/driver");
  const school = await getSetting("school", user.branchId);
  const nav = NAV.filter((s) => hasPerm(user, s.perm)).map((s) => ({
    key: s.key, href: s.href, icon: s.icon, group: s.group,
    children: s.children?.filter((c) => !c.perm || hasPerm(user, c.perm)).map((c) => ({ href: c.href, label: c.label })),
  }));
  const branches = user.roleKey === "SUPER_ADMIN" ? await db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : undefined;
  return (
    <StaffShell nav={nav} schoolName={school.name} logoUrl={school.logoUrl || undefined} canSearch={hasPerm(user, "search.global")} branches={branches}
      user={{ name: user.name, roleName: user.roleName, language: user.language, idleMinutes: user.idleMinutes, branchId: user.branchId }}>
      {children}
    </StaffShell>
  );
}
