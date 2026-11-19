import "server-only";
import type { ReportDef } from "./types";
import { stationeryReports } from "@/server/stationery/reports";
import { uniformReports } from "@/server/uniforms/reports";
import { feeReports } from "@/server/fees/reports";
import { transportReports } from "@/server/transport/reports";
import { studentReports } from "@/server/students/reports";
import { branchReports } from "@/server/system/branch-report";
import { libraryReports } from "@/server/library/reports";
import { assetReports } from "@/server/assets/reports";
import { hostelReports } from "@/server/hostel/reports";
import { hrReports } from "@/server/hr/reports";
import type { SessionUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";

export const REPORTS: ReportDef[] = [...studentReports, ...stationeryReports, ...uniformReports, ...feeReports, ...transportReports, ...libraryReports, ...assetReports, ...hostelReports, ...hrReports, ...branchReports];

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}

/** Whether the user may open this report (permission, plus the role limit when the report has one). */
export function canSeeReport(user: SessionUser, r: ReportDef) {
  return hasPerm(user, r.perm) && (!r.roles || r.roles.includes(user.roleKey));
}
