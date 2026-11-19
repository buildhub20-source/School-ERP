/** Every automation from the proposal. Timing and parameters are editable by the Super Admin (Settings → Automations). */
export type Schedule =
  | { kind: "event" } // runs when the triggering action happens
  | { kind: "daily"; defaultTime: string } // HH:MM, school time (IST)
  | { kind: "interval"; minutes: number };

export type AutomationMeta = {
  key: string;
  area: "Stationery" | "Uniforms" | "Fees" | "Transport" | "Students" | "Library" | "Assets" | "Hostel" | "HR" | "All";
  trigger: string;
  action: string;
  schedule: Schedule;
  defaultConfig: Record<string, unknown>;
  configHelp?: Record<string, string>;
};

export const AUTOMATIONS: AutomationMeta[] = [
  { key: "stationery.lowStock", area: "Stationery", trigger: "Stock falls below reorder level", action: "Alerts the Store Manager and drafts a purchase order to the usual supplier", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "stationery.issued", area: "Stationery", trigger: "Request approved and issued", action: "Deducts stock, notifies the teacher, logs it against the class budget", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "stationery.pendingReminder", area: "Stationery", trigger: "Request pending over 2 days", action: "Reminds the approver", schedule: { kind: "daily", defaultTime: "09:00" }, defaultConfig: { days: 2 }, configHelp: { days: "Days a request can stay pending before a reminder" } },
  { key: "uniforms.newYear", area: "Uniforms", trigger: "New academic year", action: "Opens parent pre-orders and suggests next sizes from each student's profile", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "uniforms.ready", area: "Uniforms", trigger: "Order marked Ready", action: "Notifies the parent to collect it", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "fees.termDues", area: "Fees", trigger: "New term starts", action: "Generates fee dues for every student from the fee structure", schedule: { kind: "daily", defaultTime: "06:00" }, defaultConfig: { daysBeforeTermStart: 0 }, configHelp: { daysBeforeTermStart: "Generate dues this many days before the term starts" } },
  { key: "fees.reminders", area: "Fees", trigger: "7 days, 1 day before due date", action: "Sends SMS / WhatsApp / email reminders with a pay-now link", schedule: { kind: "daily", defaultTime: "10:00" }, defaultConfig: { daysBefore: [7, 1] }, configHelp: { daysBefore: "Days before the due date to remind, e.g. [7, 1]" } },
  { key: "fees.lateFee", area: "Fees", trigger: "Due date passes", action: "Adds late fee (if enabled) and moves the student to the defaulter list", schedule: { kind: "daily", defaultTime: "00:30" }, defaultConfig: {} },
  { key: "fees.onlineReceipt", area: "Fees", trigger: "Payment received online", action: "Marks it paid, generates the receipt and sends it to the parent instantly", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "fees.dailySummary", area: "Fees", trigger: "End of day", action: "Emails the day's collection summary to the Accountant and Principal", schedule: { kind: "daily", defaultTime: "19:00" }, defaultConfig: {} },
  { key: "transport.feeOnAssign", area: "Transport", trigger: "Student assigned to a stop", action: "Adds the transport fee to the student's fee account", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "transport.docExpiry", area: "Transport", trigger: "Bus document expires in 30 days", action: "Alerts the Transport Manager, repeats weekly until renewed", schedule: { kind: "daily", defaultTime: "08:00" }, defaultConfig: { daysBefore: 30, repeatEveryDays: 7 }, configHelp: { daysBefore: "Start alerting this many days before expiry", repeatEveryDays: "Repeat the alert every N days until renewed" } },
  { key: "transport.serviceDue", area: "Transport", trigger: "Service due by date or km", action: "Creates a maintenance reminder", schedule: { kind: "daily", defaultTime: "08:15" }, defaultConfig: { daysAhead: 7, kmAhead: 500 }, configHelp: { daysAhead: "Remind this many days before the service date", kmAhead: "Remind this many km before the service odometer reading" } },
  { key: "transport.nearStop", area: "Transport", trigger: "Bus near a stop (with GPS)", action: "Notifies parents at that stop", schedule: { kind: "event" }, defaultConfig: { meters: 500 }, configHelp: { meters: "Distance from the stop that counts as near" } },
  { key: "students.promotion", area: "Students", trigger: "Student promoted to next class", action: "Carries forward fees, transport and size profile; flags pending dues", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "attendance.absentAlert", area: "Students", trigger: "Student marked absent in the morning register", action: "Tells the parents the same morning (SMS / app); if the mark is corrected, tells them it was a mistake", schedule: { kind: "event" }, defaultConfig: { notifyLate: false }, configHelp: { notifyLate: "Also tell parents when their child is marked late" } },
  { key: "attendance.reminder", area: "Students", trigger: "Class attendance not marked by mid-morning", action: "Reminds each class teacher whose class is not marked, and gives the office the list (skips holidays and weekly offs)", schedule: { kind: "daily", defaultTime: "10:00" }, defaultConfig: {} },
  { key: "students.leave", area: "Students", trigger: "Student leaves school", action: "Checks for pending dues, uniform orders and bus seat; frees the seat", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "library.overdue", area: "Library", trigger: "Book not returned by its due date", action: "Reminds the student's parents (or the staff borrower) to return it, with the fine so far", schedule: { kind: "daily", defaultTime: "08:30" }, defaultConfig: { everyDays: 3 }, configHelp: { everyDays: "Remind again every N days while the book is overdue" } },
  { key: "assets.warranty", area: "Assets", trigger: "Asset warranty about to end", action: "Alerts the asset managers once, so a fault can be claimed before the warranty ends", schedule: { kind: "daily", defaultTime: "09:00" }, defaultConfig: { daysBefore: 30 }, configHelp: { daysBefore: "Alert this many days before the warranty ends" } },
  { key: "hostel.feeOnAllocate", area: "Hostel", trigger: "Student given a hostel bed", action: "Adds the hostel fee for each remaining term to the student's fee account", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "hostel.outpassNotify", area: "Hostel", trigger: "Resident leaves or returns on an outpass", action: "Tells the parents when their child leaves the hostel and when they are back", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "hostel.absentAlert", area: "Hostel", trigger: "Resident absent at roll call", action: "Alerts the hostel managers straight away", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "hostel.lateReturn", area: "Hostel", trigger: "Resident late back from an outpass", action: "Alerts the hostel managers once per outpass", schedule: { kind: "interval", minutes: 60 }, defaultConfig: {} },
  { key: "hr.leaveRequested", area: "HR", trigger: "Staff member applies for leave", action: "Tells the leave approvers, and adds it to the Approvals inbox", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "hr.leaveDecided", area: "HR", trigger: "Leave approved or rejected", action: "Tells the staff member, and the substitute who will cover for them; approved leave is marked on the attendance register", schedule: { kind: "event" }, defaultConfig: {} },
  { key: "hr.attendanceReminder", area: "HR", trigger: "Staff attendance not marked by mid-morning", action: "Reminds the office to mark today's staff register (skips holidays and weekly offs)", schedule: { kind: "daily", defaultTime: "10:30" }, defaultConfig: {} },
  { key: "hr.expiry", area: "HR", trigger: "Staff document expiring or probation ending", action: "Alerts HR once, so documents are renewed and probation is confirmed on time", schedule: { kind: "daily", defaultTime: "08:45" }, defaultConfig: { daysBefore: 30 }, configHelp: { daysBefore: "Alert this many days before the date" } },
  { key: "all.greetings", area: "All", trigger: "Birthday, holiday, event", action: "Sends greetings or circulars to selected parents and staff", schedule: { kind: "daily", defaultTime: "07:00" }, defaultConfig: { birthdays: true, events: true } },
  { key: "all.backup", area: "All", trigger: "Every night", action: "Backs up the database", schedule: { kind: "daily", defaultTime: "01:00" }, defaultConfig: {} },
  { key: "all.retention", area: "All", trigger: "Every night", action: "Removes old GPS points, outbox messages, read notifications and expired sessions (business records are never deleted)", schedule: { kind: "daily", defaultTime: "02:00" }, defaultConfig: { gpsDays: 90, messagesDays: 365, notificationsDays: 180, auditDays: 0 }, configHelp: { gpsDays: "Keep bus GPS points for N days (0 = forever)", messagesDays: "Keep outbox messages for N days (0 = forever)", notificationsDays: "Keep read notifications for N days (0 = forever)", auditDays: "Keep the audit log for N days (0 = forever)" } },
  { key: "all.messageRetry", area: "All", trigger: "Every 15 minutes", action: "Retries SMS, WhatsApp and email messages that failed to send (login OTPs and emails with attachments are not retried)", schedule: { kind: "interval", minutes: 15 }, defaultConfig: { maxAttempts: 3, withinHours: 24 }, configHelp: { maxAttempts: "Total tries per message, including the first", withinHours: "Only retry messages from the last N hours" } },
  { key: "reports.scheduled", area: "All", trigger: "Every Monday and at month-end", action: "Emails a summary report to the principal", schedule: { kind: "daily", defaultTime: "07:30" }, defaultConfig: { weekly: true, monthEnd: true } },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key);
