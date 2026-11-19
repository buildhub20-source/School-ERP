import "server-only";
import { stationeryPendingReminder } from "@/server/stationery/automations";
import { feeTermDues, feeReminders, feeLateFees, feeDailySummary } from "@/server/fees/automations";
import { transportDocExpiry, transportServiceDue } from "@/server/transport/automations";
import { greetingsAndCirculars } from "@/server/communication/automations";
import { nightlyBackup } from "@/server/system/backup";
import { scheduledReports } from "@/server/system/scheduled-reports";
import { dataRetention } from "@/server/system/retention";
import { retryFailedMessages } from "@/server/system/message-retry";
import { libraryOverdueReminders } from "@/server/library/service";
import { assetWarrantyAlerts } from "@/server/assets/service";
import { hostelOverdueReturns } from "@/server/hostel/service";
import { hrAttendanceReminder, hrExpiryAlerts } from "@/server/hr/service";
import { attendanceReminder } from "@/server/attendance/service";

/** Scheduled jobs (event-driven automations are called directly from the module services). */
export const JOBS: Record<string, (config: Record<string, unknown>) => Promise<string>> = {
  "stationery.pendingReminder": stationeryPendingReminder,
  "fees.termDues": feeTermDues,
  "fees.reminders": feeReminders,
  "fees.lateFee": feeLateFees,
  "fees.dailySummary": feeDailySummary,
  "transport.docExpiry": transportDocExpiry,
  "transport.serviceDue": transportServiceDue,
  "all.greetings": greetingsAndCirculars,
  "all.backup": nightlyBackup,
  "reports.scheduled": scheduledReports,
  "all.retention": dataRetention,
  "all.messageRetry": retryFailedMessages,
  "library.overdue": libraryOverdueReminders,
  "assets.warranty": assetWarrantyAlerts,
  "hostel.lateReturn": hostelOverdueReturns,
  "hr.attendanceReminder": hrAttendanceReminder,
  "attendance.reminder": attendanceReminder,
  "hr.expiry": hrExpiryAlerts,
};
