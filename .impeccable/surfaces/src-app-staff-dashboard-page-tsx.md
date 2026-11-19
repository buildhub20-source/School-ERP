---
version: 1
slug: "src-app-staff-dashboard-page-tsx"
primary_target: "src/app/(staff)/dashboard/page.tsx"
related_targets: ["src/components/ui","src/components/layout"]
---

# Staff app shell, dashboard and shared components

Scope: the staff app shell (sidebar, top bar, section navigation), the dashboard, and the shared UI kit every staff page uses (cards, stat tiles, tables, badges, buttons, forms, filters, tabs, page header, modals, empty states), plus the parent/driver portal shells through the shared tokens. Mode: Operate.

Audience and job: school office staff (admin, accountant at the fee counter for hours, store and transport managers), equally on desktop and phone, many older or non-technical. Each morning the dashboard must show today's work and alerts first: approvals waiting, overdue fees, low stock, teacher requests, uniform orders ready, expiring bus documents and service, fees falling due.

Constraints: keep every route, behaviour, data and English copy identical (covered by e2e tests); restyle through the shared kit and theme tokens so 100+ pages change together; 375px wide must work; English and Tamil (longer labels); print/PDF stays light; any school's uploaded logo, or none.

Pinned by the user: the visual reference is a dark admin console with a soft gold accent (user's screenshot): grouped sidebar with small section headings and a solid gold active pill, a centred pill-shaped segmented navigation in the top bar, big page titles with a gold primary pill button at top right, a rounded search-and-filter bar with segmented status chips, rounded cards with soft dot status chips and grouped icon buttons, and a light/dark switch. Dark is the default; light is offered through the switch.

## Direction contract

THESIS: A calm, dark counter-console where gold marks only what the clerk should press or look at next; it refuses the stock white-card indigo admin template the app shipped with.

OWN-WORLD: Near-black neutral ground, one step lighter graphite panels with hairline borders, large soft radii; soft gold as the single action and selection colour with dark text on it; state as small glowing dots plus words (green paid, amber due, red overdue), never colour alone; one workhorse system sans, tabular figures for money; light theme mirrors it on white and pale grey.

STORY: The clerk opens the dashboard, reads what needs action today in one ranked list, clicks straight into it, then sees money and stock figures; every module page feels like the same tool.

FIRST VIEWPORT: Left: grouped sidebar (Overview, Operations, Insights, Communication, Administration) with the active module as a gold pill. Top bar: search, the current module's sub-pages as a centred segmented pill bar, theme switch, bell, avatar. Content: "Dashboard" title with the date and gold quick actions at right; a full-width "Needs attention today" panel of ranked alert rows (dot, count, label, go); then four money/stock stat tiles; then the collection chart and defaulters.

FORM: User-pinned reference (dark gold admin console), adapted as the product's shell; it replaces the direction the roll assigned from my own seven grounded candidates (index 5: Southern Railway station signage), before any catalog challenger was weighed. seed: seed:72cdf7a8fbc221e9.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Cited adaptations

- Section pill bar sits as a second row of the sticky header rather than centred in the first: modules have up to 12 sub-pages and the first row carries global search.
- Filters stay native selects (rounded pill style) instead of segmented status chips: the filter bar is a GET form whose behaviour and URL parameters are covered by e2e tests, and many filters have 5-15 options; From/To dates sit inline with an in-field label.
- Theme switch moves into the account menu below 640px to save header width.
- Dashboard shows four primary figure tiles plus a compact strip for the other four figures (same labels, values and links), so the attention list and chart stay near the first screen.
- Secondary header actions keep their text labels instead of becoming grouped icon-only buttons, per Product Principle 1 (clarity for older, non-technical staff: no meaning hidden behind an icon). On phones the primary action spans the full row first and the secondary actions share the row below in equal widths.
