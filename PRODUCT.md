# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **School office staff** (School Admin, Accountant, Store Manager, Transport Manager, Super Admin/principal): run the school's daily administration. They use the system **equally on office desktops/laptops and on phones**. Many are **older or non-technical clerks and accountants**, and the accountant often sits at the **fee counter for hours** collecting payments.
- **Teachers**: request stationery and view their class, mostly on phones.
- **Parents**: check and pay fees, order uniforms, track the school bus, read circulars, on phones (installable PWA), in English or Tamil.
- **Bus drivers and attendants**: run trips, share GPS, mark boarding and use the offline emergency sheet, on phones (PWA).

## Product Purpose
One website for a school's daily administration: stationery, uniforms and accessories, fees and transport, joined by a central dashboard, role-based logins, automations, notifications and reports. Built from `School Management System — Proposal.pdf` (the source of truth). Success means the office stops juggling registers and spreadsheets: dues are collected and reconciled, stock never runs out unnoticed, parents know what they owe and where the bus is.

## Positioning
A single system for an Indian (Tamil Nadu) school's office that covers the four money-and-stock operations end to end (stationery, uniforms, fees, transport) with one student profile, automations that act on their own, and parent/driver mobile apps in English and Tamil.

## Operating Context
- Daily fee counter collection (cash/cheque/UPI/card), day-end cash book closing, receipts printed or sent by SMS/WhatsApp/email.
- Store issuing stationery against teacher requests; uniform orders through Ordered → Paid → Ready → Delivered.
- Morning/afternoon bus trips with live GPS; parents watching the bus approach.
- Monday and month-end summary reports to the principal; PDF/Excel exports for the office.
- Indian formats: ₹ amounts, en-IN dates, Asia/Kolkata time.

## Capabilities and Constraints
- Next.js 15 (App Router) + PostgreSQL/Prisma + Tailwind CSS v4. Shared UI kit in `src/components/ui`; staff shell in `src/components/layout`.
- 100+ staff pages, all filterable and paginated; every page must work at 375 px wide.
- Parent and driver apps are mobile-first installable PWAs with their own shells.
- English and Tamil UI (`src/lib/i18n`); Tamil labels are longer than English.
- Role-based permissions editable by the Super Admin; data is scoped by branch.
- Behaviour, routes, data and English copy are established and covered by end-to-end tests; visual changes must not change them.

## Brand Commitments
- No fixed school brand yet: the product is sold to schools, and each school uploads its own logo and name in Settings → School profile (shown on the login page, letterheads, receipts and ID cards). The interface must look right with any school's logo, or none.
- Demo data uses "Green Valley Matriculation Higher Secondary School".

## Evidence on Hand
- Seeded demo school with real-shaped data (169 students, fees, stock, buses, routes) in the local database.
- No real school's logo, photography, testimonials or customer names exist; none may be invented.

## Product Principles
1. **Clarity for non-technical staff.** Large, legible text, obvious primary actions, plain labels, no hidden gestures; nothing a clerk has to guess.
2. **Built for long sessions.** The fee counter and store desk are used for hours: calm surfaces, fast keyboard-friendly entry, no motion or noise that tires the eyes.
3. **One student, one system.** Every module reads from the same student profile; navigation should make moving between modules for one student effortless.
4. **Works on any device the school has.** Desktop and phone are equal first-class surfaces.
5. **Money must be unmistakable.** Amounts, dues and statuses are always readable at a glance and never ambiguous.

## Accessibility & Inclusion
- Older users: comfortable base text size, strong contrast, generous hit targets.
- Bilingual English/Tamil: layouts must tolerate longer Tamil strings without breaking.
