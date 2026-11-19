import "server-only";
import { db } from "./db";
import { ALL_PERMISSIONS, DEFAULT_ROLES, ROLE_KEYS } from "./permissions";

/** Permissions that existed before role sync was introduced: every install already has these in its roles. */
const BASELINE = [
  "dashboard.view", "search.global", "students.view", "students.manage", "students.import", "students.promote", "class.view",
  "stationery.view", "stationery.manage", "stationery.approve", "stationery.request", "uniforms.view", "uniforms.manage", "uniforms.orders",
  "fees.view", "fees.setup", "fees.collect", "fees.concession.request", "fees.concession.approve", "fees.refund.request", "fees.refund.approve",
  "fees.cashbook", "fees.export", "transport.view", "transport.manage", "transport.fees.view", "reports.stationery", "reports.uniforms",
  "reports.fees", "reports.transport", "reports.students", "approvals.view", "circulars.manage", "outbox.view", "settings.manage",
  "users.manage", "roles.manage", "audit.view", "parent.portal", "driver.portal",
];
const CATALOG_KEY = "permissionCatalog";

/**
 * Bring an existing installation's roles up to date when new modules ship: permissions that are NEW to the system are
 * added to the roles that hold them by default, and new system roles are created. Permissions the Super Admin removed
 * from a role earlier are never re-added (only permissions the install has not seen before are granted). Idempotent.
 */
export async function syncRoles(): Promise<{ added: number; createdRoles: string[] }> {
  const roles = await db.role.findMany();
  if (!roles.length) return { added: 0, createdRoles: [] }; // not set up yet: setup/seed create the roles
  const row = await db.setting.findFirst({ where: { key: CATALOG_KEY, branchId: null } });
  const known = new Set<string>(Array.isArray(row?.value) ? (row!.value as string[]) : BASELINE);
  const fresh = ALL_PERMISSIONS.filter((p) => !known.has(p));
  let added = 0;
  const createdRoles: string[] = [];
  for (const key of ROLE_KEYS) {
    const def = DEFAULT_ROLES[key];
    const role = roles.find((r) => r.key === key);
    if (!role) {
      await db.role.create({ data: { key, name: def.name, description: def.description, permissions: def.permissions } });
      createdRoles.push(key);
      continue;
    }
    const grant = def.permissions.filter((p) => fresh.includes(p) && !role.permissions.includes(p));
    if (grant.length) {
      await db.role.update({ where: { id: role.id }, data: { permissions: [...role.permissions, ...grant] } });
      added += grant.length;
    }
  }
  if (row) await db.setting.update({ where: { id: row.id }, data: { value: ALL_PERMISSIONS } });
  else await db.setting.create({ data: { key: CATALOG_KEY, branchId: null, value: ALL_PERMISSIONS } });
  return { added, createdRoles };
}
