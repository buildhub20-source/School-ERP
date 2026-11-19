import { Tabs } from "@/components/ui";
import { hasPerm } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth/session";

const ALL = [
  { href: "/settings", label: "School profile", perm: "settings.manage" },
  { href: "/settings/academic", label: "Years & classes", perm: "settings.manage" },
  { href: "/settings/users", label: "Users", perm: "users.manage" },
  { href: "/settings/roles", label: "Roles & permissions", perm: "roles.manage" },
  { href: "/settings/automations", label: "Automations", perm: "settings.manage" },
  { href: "/settings/policies", label: "Policies", perm: "settings.manage" },
  { href: "/settings/integrations", label: "Integrations", perm: "settings.manage" },
  { href: "/settings/branches", label: "Branches", perm: "settings.manage" },
  { href: "/settings/backups", label: "Backups", perm: "settings.manage" },
] as const;

export function SettingsTabs({ user, active }: { user: SessionUser; active: string }) {
  return <Tabs active={active} tabs={ALL.filter((t) => hasPerm(user, t.perm)).map((t) => ({ href: t.href, label: t.label }))} />;
}
