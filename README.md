# School Management System

One website for the school's daily administration: **stationery**, **uniforms & accessories**, **fees** and **transport**, joined by a central dashboard, role-based logins, automations, notifications and reports. It is built from `School Management System — Proposal.pdf`.

## What's inside

| Area | Highlights |
| --- | --- |
| Students | Single student profile used by every module, parents and guardians (one parent login covers all of their children), class history, siblings, leaving school with checks, Excel import/export, promotion and year close |
| Student attendance | Daily class register marked by the class teacher (one tap per child, everyone starts present), parents told of absences the same morning (with a correction if a mark is fixed), office overview of marked/unmarked classes, monthly grid per class, attendance on the student profile and in the parent app, attendance report with a "below 75%" filter, mid-morning reminder for unmarked classes |
| Stationery | Items and stock, teacher requests with approve / partly approve / reject and issue, reorder levels with auto-draft purchase orders, suppliers and price comparison, QR labels and phone-camera scanning, class kits, budgets, damage/loss/returns, stock audits |
| Uniforms | Size-wise stock matrix, student size profiles with next-size suggestions, uniform sets by class and gender, parent pre-orders, order status tracking (Ordered → Paid → Ready → Delivered), exchanges and returns, ID card printing with QR codes, seasonal planning |
| Fees | Fee structure per class and term, instalments, concessions and scholarships with approval, late fee rules, counter collection (cash/cheque/UPI/card/net banking), online payments, PDF receipts with QR verification, defaulters, daily cash book and day-end closing, refunds and adjustments, Excel/Tally export |
| Transport | Buses, drivers and attendants, routes and stops on a map, student allocation with capacity check, stop/distance-wise transport fees, document expiry tracking, maintenance and fuel, live GPS tracking, boarding attendance (tap or ID-card scan), offline emergency contact sheet |
| Library | Catalogue with accession-numbered copies and QR labels, issue/return desk (scan or type), renewals, lost books, late fines added to the student's fee account, overdue reminders to parents, library rules, reports |
| Assets | Asset register with QR tags, locations and owners, straight-line depreciation and book value, moves, repairs, physical verification rounds, disposal with gain/loss, warranty alerts, reports |
| Hostel | Hostels and rooms, bed allocation with capacity and boys/girls checks, hostel fees per term on the fee account, room changes and leaving, outpasses with parent SMS, night/morning roll call with absent alerts, mess menu, reports |
| Dashboard & reports | Live dashboard tiles, approvals inbox, analytics, reports with PDF/Excel export, weekly and month-end summary emails |
| Portals | Parent app and driver/attendant app (installable PWA, mobile-first, English and Tamil) |
| Security | Role-based permissions editable by the Super Admin, strong passwords, optional two-step login (authenticator app), OTP login for parents and drivers, idle sign-out, audit trail of every change, nightly backups |

## Run it (POC: mock JSON data, no database)
This build has **no backend database and no external services**. All data is mock data in JSON:
```bash
npm install
npm run poc          # http://localhost:3100
npm run poc:reset    # discard all changes (next start reloads the original mock data)
```
- **Data**: `data/demo-data.json` is the mock school (Green Valley, 169 students, fees and payments, stationery, uniforms, 5 buses and routes, library, assets, hostel, HR, 89 tables). It is never modified.
- **Your changes** are saved to `.poc/data.json` within a second of each change, so they survive a refresh or restart. **Settings → Backups → Reset demo data** (or `npm run poc:reset`) goes back to the original data. A fresh start moves all demo dates forward to today, so "today", "overdue" and "this month" stay meaningful.
- **How it works**: `src/lib/json-db` is a drop-in replacement for the Prisma client. Every page and service still calls `db.student.findMany(…)` and friends, and the JSON engine answers from memory using the table definitions in `prisma/schema.prisma` (relations, defaults, unique keys, cascades, transactions with rollback). Prisma is only used for its generated types and schema metadata, never to connect.
- **No real services**: online payments use the sandbox checkout (no money moves), SMS/email/WhatsApp go to the in-app Outbox, parent/driver OTP is always `123456`, backups save the JSON file (`backups/backup-….json.gz`).
- **Simulated GPS** (`MOCK_GPS=true`, `src/server/transport/simulator.ts`): every bus drives its route in 6-minute loops (pickups before noon, drops after), so Transport → Live tracking and the parent Bus page move, and near-stop alerts reach parents. A trip started in the driver app is never touched by the simulator.
- **Logins**: `superadmin@school.test` / `Admin@12345`, other staff (table below) `Staff@12345`, parent `9840000002`, drivers `9000000101` / `9000000102`, OTP `123456`.
- **Options**: `POC_PORT=4000 npm run poc`, `npm run poc -- --prod` (production build). Map tiles load from OpenStreetMap, so maps need internet; everything else works offline.
- **Checks**: `npm test` (91 workflow tests, run on a throwaway copy of the mock data) and `npx tsx tests/e2e/full.mjs` (every page as every role in local Chrome/Edge, against the running POC).

Requirements: Node.js 20+.

### Demo logins
| Role | Login | Password |
| --- | --- | --- |
| Super Admin | superadmin@school.test | Admin@12345 |
| Librarian | library@school.test | Staff@12345 |
| Hostel Warden | hostel@school.test | Staff@12345 |
| School Admin | admin@school.test | Staff@12345 |
| Accountant | accounts@school.test | Staff@12345 |
| Store Manager | store@school.test | Staff@12345 |
| Transport Manager | transport@school.test | Staff@12345 |
| Teacher | anitha@school.test | Staff@12345 |
| Parent / Driver | mobile number + OTP, e.g. parent 9840000008 | Local demo: set `DEMO_OTP="123456"` in `.env` and use 123456 (ignored on an https site or when SMS is configured). In development the OTP is also shown on the login screen |

**Change every demo password before real use**, or start without demo data.

### First run without demo data (real school)
> **POC build:** this section describes the original PostgreSQL setup. In this build the data layer is the JSON engine (`src/lib/json-db`); going back to PostgreSQL means restoring `new PrismaClient()` in `src/lib/db.ts` (the rest of the code uses ordinary Prisma calls that work on both).

```bash
npx prisma migrate deploy
npm run setup -- --email principal@yourschool.in --name "Your Name" --school "Your School Name"   # asks for the password
```
This creates the roles, the main branch, the automation defaults and your Super Admin account only. Then sign in and set up Settings → School profile, Years & classes (academic year, terms, classes, sections) and Users, and bring in existing records with Students → Bulk import (students, stationery stock, uniform stock, fee dues).

## Configuration (.env)
| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL, used in SMS/email links, receipt QR codes and ID cards |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Online payments. Empty = built-in sandbox checkout (no money moves). Webhook URL: `<APP_URL>/api/payments/webhook` |
| `SMTP_*` | Email (receipts, summaries, reports). Empty = written to the Message outbox |
| `MSG91_*` | SMS (including OTPs). Empty = written to the Message outbox. `MSG91_TEMPLATES` maps each message type to its DLT template id (see below) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATES` | WhatsApp Business Cloud API. Empty = outbox. `WHATSAPP_TEMPLATES` maps message types to approved template names |
| `PAYMENTS_SANDBOX` | `true` allows the no-money sandbox checkout on a production build (staging/demo only). Never set it on the live site |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Mobile push notifications. Generate with `npx web-push generate-vapid-keys` |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `PG_DUMP_PATH` | Nightly backups (database dump + `uploads/` archive) |
| `BACKUP_ENCRYPTION_KEY` | Optional passphrase: backups are encrypted (AES-256-GCM, `.enc`). Keep it safe — without it backups cannot be restored. Decrypt with `npm run backup:decrypt -- <file.enc>` |
| `BACKUP_COPY_COMMAND` | Optional off-site copy, run for each backup file with `{file}` = its path, e.g. `aws s3 cp {file} s3://school-backups/` or `rclone copy {file} gdrive:school-backups` |
| `RUN_SCHEDULER` | `true` runs automations inside the web server; set `false` and run `npm run worker` when you run several web servers |

Settings → Integrations shows which services are connected and can send a test message.

## Tamil
Parents, drivers and staff choose English or Tamil (parent/driver Settings, or My account). The parent and driver apps, login and menus are translated (`src/lib/i18n/dict.ts`); messages are sent in Tamil when a Tamil version exists (circulars have optional Tamil title and message fields). PDFs (receipts, statements, ID cards, reports) print Tamil text with the embedded Noto Sans Tamil font (`assets/fonts`, SIL Open Font License); keep the `assets/` folder when deploying.

## Message templates (SMS DLT and WhatsApp)
Every outgoing message has a type: `OTP`, `FEE_REMINDER`, `FEE_RECEIPT`, `UNIFORM_READY`, `UNIFORM_PREORDER`, `BUS_NEAR_STOP`, `BUS_BOARDING`, `STUDENT_ABSENT`, `CIRCULAR`, `GREETING`, `GENERAL`.
Register one DLT template per type with your SMS provider (and a Tamil one with the suffix `_TA` if parents use Tamil), then set
`MSG91_TEMPLATES='{"OTP":"<id>","FEE_REMINDER":"<id>","FEE_REMINDER_TA":"<id>",…,"GENERAL":"<id>"}'`.
Variables are sent in order as `var1`, `var2`, `var3` = title, message, link (OTP: `var1` = code, `var2` = school name).
For WhatsApp, create approved templates with body parameters `{{1}}` title, `{{2}}` message, `{{3}}` link, in `en` and `ta`, and set `WHATSAPP_TEMPLATES`.
Messages are sent in each parent's chosen language (Settings in the parent app) when a Tamil version exists.

## Automations
All automations from the proposal run on their own and are configured in **Settings → Automations** (on/off, time of day, days before, distances…). Each one shows its last run and can be run on demand. Event automations (low stock, request issued, order ready, online payment receipt, transport fee on allocation, bus near stop, promotion, student leaving) run at the moment the triggering action happens. Daily ones (pending-request reminders, term dues, fee reminders, late fees, daily collection summary, document expiry, service due, greetings and circulars, nightly backup, weekly/month-end reports) are checked every 5 minutes and run once a day after their configured time.

## Production deployment
> **POC build:** this section describes the original PostgreSQL setup. In this build the data layer is the JSON engine (`src/lib/json-db`); going back to PostgreSQL means restoring `new PrismaClient()` in `src/lib/db.ts` (the rest of the code uses ordinary Prisma calls that work on both).

```bash
npm ci
npx prisma migrate deploy   # applies versioned migrations in prisma/migrations
npm run build
npm start              # serves on port 3000
```
- Put the app behind HTTPS (Nginx/Caddy or the cloud load balancer). Cookies are `Secure` and HSTS is sent in production.
- The proxy must **overwrite** `X-Real-IP` with the client address and set `X-Forwarded-Proto` (Nginx: `proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;`). The sign-in rate limit and the audit log use this address. The rate limit is kept in memory per server; with several servers also rate-limit `/login` and `/api/auth/*` at the proxy.
- Never run `npm run db:seed` or `db:reset` on the live site: they create the demo accounts with the published passwords above (both refuse to run when `NODE_ENV=production` or `APP_URL` is https; `ALLOW_DEMO_SEED=1` overrides this for a demo/staging server). Use `npm run setup` instead.
- Parents and drivers sign in with an SMS OTP only, so **SMS (MSG91) must be configured before parents/drivers can use the live site**. In production the OTP is never shown on screen, and the Message outbox masks login codes.
- Set `APP_URL` to the public HTTPS address.
- Keep `uploads/` (photos, logo, documents) and `backups/` on persistent storage, and copy backups off the server. The nightly backup is the database only: back up `uploads/` separately (e.g. a nightly `rsync`/`aws s3 sync` of both folders to off-site storage).
- Restore a backup into an empty database: `gunzip -c backups/backup-….sql.gz | psql "$DATABASE_URL"`, and the uploaded files with `tar -xzf backups/uploads-….tar.gz` in the app folder (encrypted `.enc` files: `npm run backup:decrypt -- <file.enc>` first). Set `BACKUP_COPY_COMMAND` so every nightly backup is also copied off the server.

## Development
> **POC build:** this section describes the original PostgreSQL setup. In this build the data layer is the JSON engine (`src/lib/json-db`); going back to PostgreSQL means restoring `new PrismaClient()` in `src/lib/db.ts` (the rest of the code uses ordinary Prisma calls that work on both).

```bash
npm run dev            # dev server
npx tsc --noEmit       # type check
npm test               # unit + end-to-end workflow tests (run against the database in .env)
npm run test:e2e       # browser pass in local Chrome: every page, every role, parent & driver apps, dashboard figures
npm run db:reset       # wipe and re-seed (development only!)
npx prisma migrate dev --name <change>   # after editing prisma/schema.prisma: creates a new migration
```
Architecture and coding conventions: `docs/ARCHITECTURE.md`.
