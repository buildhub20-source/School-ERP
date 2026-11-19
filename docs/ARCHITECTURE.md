# Architecture & conventions

Source of truth for requirements: `School Management System — Proposal.pdf` (project root).

## Stack
- Next.js 15 (App Router, React 19, server components + server actions), TypeScript strict
- **Data (POC build): JSON, no database.** `src/lib/json-db` is a drop-in replacement for the Prisma client: `db` from `src/lib/db.ts` still exposes `db.<model>.findMany/create/update/…`, `$transaction` and the audit extension, but answers from in-memory tables loaded from `data/demo-data.json` (mock data) and saved to `.poc/data.json`. Table shapes, relations, defaults and unique keys come from `prisma/schema.prisma` (via the generated client's metadata). Not supported, and throws: raw SQL other than row locks (`SELECT … FOR UPDATE` / advisory locks are no-ops), cursor pagination, groupBy `having`. Write cross-table figures as ordinary queries plus code (see `src/server/system/analytics.ts`).
- Original build: PostgreSQL 18 via Prisma 6 (schema changes are versioned migrations in `prisma/migrations`); restore `new PrismaClient()` in `src/lib/db.ts` to go back
- Tailwind CSS v4, lucide-react icons, recharts (charts), leaflet/react-leaflet (maps), @zxing/browser (camera scanning)
- pdfkit (PDF), exceljs (Excel), qrcode, nodemailer (SMTP), web-push (VAPID), node-cron (scheduler)

## Folder layout
```
src/
  app/
    (auth)/login            sign-in (password, parent/driver OTP, 2FA)
    (staff)/<module>/...    staff pages, one folder per module, each with its own actions.ts
    parent/...              parent portal (mobile-first PWA)
    driver/...              driver/attendant app (mobile-first PWA)
    api/...                 route handlers: file downloads (PDF/Excel), webhooks, JSON for the PWAs
  components/ui             shared UI kit (import server-safe parts from "@/components/ui", client parts from "@/components/ui/client")
  components/layout         shells, nav (components/layout/nav.ts lists every staff page)
  lib/                      framework-level helpers (db, auth, action wrapper, settings, pdf, excel, messaging, automations, reports)
  server/<module>/          business logic per module (service.ts, core.ts, automations.ts, reports.ts, import-template.ts)
prisma/seed.ts + prisma/seed-modules/<module>.ts   idempotent demo data
tests/<module>.test.ts      vitest (runs against the dev database)
```

## Rules every module follows
1. **Business logic lives in `src/server/<module>/`**, not in pages or actions. Pages only read; actions validate and call services.
2. **Mutations are server actions created with `defineAction`** (`src/lib/action.ts`): `defineAction({ perm, schema, revalidate }, async (input, { user, branchId }) => …)`. It handles auth, permission, zod validation, the audit context and user-friendly errors. Throw `AppError("message")` for messages shown to the user. Use the `zs` helpers for form fields (FormData strings → typed values). Arrays/objects from client components are sent as JSON strings and parsed with `zs.json(schema)`.
3. **Every write is audited automatically** by the Prisma extension in `src/lib/db.ts` (who, when, before/after) as long as it runs inside `defineAction` (or `runWithContext`). Never write to `AuditLog` by hand except for auth events.
4. **Branch scoping**: every query on branch-owned data filters by `branchId` (from the session). Students, items, buses, payments… all carry `branchId`.
5. **Permissions** come from `src/lib/permissions.ts`. Pages call `requireUser(perm)`; API routes call `requireUserOrThrow(perm)`; conditional UI uses `hasPerm(user, perm)`. Never check role keys for access, check permissions (the Super Admin edits them).
6. **Parents only see their own children**: use `requireParent()`, `parentChild(id)` and `assertParentOf(studentId)` from `src/server/parent.ts`.
7. **Money**: `Decimal(12,2)` in the DB; convert with `toNum()`, round with `round2()`, display with `money()` (UI) or `pdfMoney()` (PDF, uses "Rs."). Dates: `@db.Date` columns are UTC midnight; use `today()`, `dateOnly()`, `isoDate()`, `fmtDate()` from `src/lib/format.ts` (school timezone is Asia/Kolkata).
8. **Fee account changes go through `src/server/fees/core.ts`** (`createFeeLine`, `recalcFee`, `recordPayment`, `confirmPendingPayment`, `reversePayment`, `generateDues`, `reapplyConcessions`). Never update `StudentFee.balance` directly.
9. **Notifications** go through `src/lib/messaging/notify.ts`: `notifyUsers`, `notifyPermission(perm, msg, branchId)`, `notifyGuardians(studentId, msg)`, `sendExternal(channel, to, msg)`. Without provider keys messages land in the Outbox with status SANDBOX. Parent-facing messages pass `template` (a TemplateKey, mapped to DLT/WhatsApp templates) and a Tamil version in `ta`; users whose language is Tamil receive it.
10. **Automations**: metadata in `src/lib/automations/catalog.ts`. Event automations check `isAutomationEnabled(key)` / `automation(key)` (config) at the point of the triggering action. Scheduled jobs are registered in `src/lib/automations/jobs.ts` and implemented in `src/server/<module>/automations.ts`; they must be idempotent (safe to run twice a day) and return a one-line summary.
11. **Reports**: each module exports `ReportDef[]` from `src/server/<module>/reports.ts` (`src/lib/reports/types.ts`). The generic UI at `/reports/[key]` renders filters, a table, an optional chart and PDF/Excel export — modules do not build their own report pages.
12. **Document numbers** come from `nextNumber` / `nextCode` (`src/lib/counters.ts`) — atomic, gap-free per key.
13. **PDF** documents use `createPdf()` (letterhead from Settings → School profile) and `pdfTable()`; Excel uses `buildWorkbook()` / `readSheet()`; respond with `pdfResponse()` / `xlsxResponse()`.
14. **UI**: use the kit — `PageHeader`, `Card/CardHeader/CardBody`, `Table/THead/TBody/TR/TH/TD/EmptyRow`, `Badge/StatusBadge`, `StatCard`, `Tabs`, `Pagination + pageParams`, `Field/Input/Select/Textarea/Checkbox/FormGrid`, `Button/LinkButton`; client: `ActionForm`, `ModalForm`, `ActionButton` (confirm / reason prompt), `useAction`, `FilterBar/SearchField/FilterSelect/FilterDate`, `useToast`. **Server components cannot pass functions to client components**: from a page use a string `successMessage`, or `successMessage="@result"` to show the string (or `data.message`) the action returns; function forms of `successMessage`/`onSuccess`/`redirectTo` only work inside "use client" files. Every list page is filterable via URL params and paginated. Every page must work at 375 px width (tables scroll horizontally; forms stack).
15. **Bulk import** pages reuse `components/shared/excel-import.tsx` (check-then-import) and register their template in `src/server/<module>/import-template.ts`.

## Running
```
npm run dev            # http://localhost:3000 (scheduler runs inside the server)
npm run db:push        # apply schema changes
npm run db:seed        # idempotent demo data   |   npm run db:reset  wipes and reseeds
npm test               # vitest
npx tsc --noEmit       # typecheck
```
