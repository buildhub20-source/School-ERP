---
name: School Management System
description: A calm, dark counter-console for a school office, where soft gold marks only what to press or look at next.
colors:
  gold: "#e9c95f"
  gold-hover: "#e0ba45"
  gold-pressed: "#d1a52c"
  gold-ink-light: "#8f6a12"
  on-gold: "#231a05"
  dark-canvas: "#0e0e10"
  dark-surface: "#17171a"
  dark-surface-2: "#1e1e22"
  dark-line: "#2a2a30"
  dark-rail: "#121214"
  dark-ink: "#f2f2f3"
  dark-muted: "#a1a1aa"
  light-canvas: "#f4f4f5"
  light-surface: "#ffffff"
  light-surface-2: "#f4f4f5"
  light-line: "#e4e4e7"
  light-ink: "#18181b"
  light-muted: "#5f5f69"
  status-paid: "#10b981"
  status-due: "#f59e0b"
  status-overdue: "#f43f5e"
  status-info: "#0ea5e9"
  chart-1-dark: "#e9c95f"
  chart-2-dark: "#5aaef0"
  chart-3-dark: "#3fc792"
  chart-4-dark: "#f08a5a"
  chart-5-dark: "#a98cf5"
  chart-1-light: "#c9971f"
  chart-2-light: "#2f8fd6"
  chart-3-light: "#1f9e6f"
  chart-4-light: "#d86a3a"
  chart-5-light: "#8b6ae0"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  figure:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "1.4"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  nav-group:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Noto Sans Tamil, Latha, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
rounded:
  pill: "9999px"
  field: "12px"
  card: "16px"
  sheet: "24px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.gold-hover}"
  button-primary-active:
    backgroundColor: "{colors.gold-pressed}"
  button-secondary:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.dark-surface-2}"
  button-sm:
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "32px"
  button-lg:
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  card:
    backgroundColor: "{colors.dark-surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.dark-canvas}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.field}"
    padding: "8px 14px"
    height: "40px"
  filter-field:
    backgroundColor: "{colors.dark-canvas}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  segmented-bar:
    backgroundColor: "{colors.dark-surface-2}"
    rounded: "{rounded.pill}"
    padding: "4px"
  segmented-item-active:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  nav-item-active:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  nav-item:
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  status-chip:
    rounded: "{rounded.pill}"
    padding: "2px 10px"
    typography: "{typography.caption}"
  icon-chip:
    backgroundColor: "{colors.dark-surface-2}"
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.field}"
    size: "32px"
  modal:
    backgroundColor: "{colors.dark-surface}"
    rounded: "{rounded.sheet}"
    padding: "20px 24px"
---

# Design System: School Management System

## Overview

**Creative North Star: "The Counter Console"**

A calm, dark counter-console for a school office. The ground is near-black neutral, panels sit one step lighter in graphite with hairline borders and large soft radii, and soft gold is the only colour that asks for anything: the button to press, the page you are on, the link to follow. Everything else is quiet graphite and readable type, because the accountant at the fee counter looks at this for hours.

Dark is the default (class `dark` on `<html>`, set from the `theme` cookie); a light mirror on white and pale zinc is one switch away, and print and PDFs are always light. The dark theme works by remapping the Tailwind slate and status palette variables on screen only, so 100+ pages that use slate and status utilities change together without per-page edits. The world was adapted from a user-pinned dark gold admin console and replaces the stock white-card indigo admin template the app shipped with.

Density is moderate: 14px body, 40px controls, 16 to 20px card padding. State is always a small light plus a word, never colour alone. Labels stay visible; nothing a non-technical clerk needs is hidden behind an icon. The interface carries no school brand of its own: any uploaded logo sits on a neutral tile, or a neutral school glyph stands in.

**Key Characteristics:**
- Near-black canvas, graphite panels, hairline lines; light theme mirrors on white and pale zinc.
- One accent, soft gold (#e9c95f), with dark ink (#231a05) on it, used only for action, selection and links.
- Pills everywhere you click: buttons, nav items, segmented bars, filters, chips.
- State as glowing dot plus word: green paid, amber due, red overdue, blue follow up.
- One system sans with Tamil fallbacks; tabular figures for every amount.
- Flat-by-default panels with a faint card shadow; real shadows only on floating layers.

## Colors

One soft gold over neutral zinc-graphite, with four status hues that only ever appear beside a word.

### Primary
- **Counter Gold** (#e9c95f, brand-300): the primary button fill, the sidebar active pill, the active tab in segmented tabs, the portal bottom-bar active pill, the focus ring and caret (dark theme). Same fill in both themes so the primary action never moves.
- **Gold Hover / Pressed** (#e0ba45 / #d1a52c, brand-400 / brand-500): primary button hover and active fills; brand-500 is also the native `accent-color` for checkboxes and radios.
- **Gold Ink** (light theme #8f6a12, brand-700; dark theme remaps brand-700 to #e9c95f): link text ("Report", "All", "Mark all read", "View all") and the active section-nav label. Readable gold on each ground.
- **Gold Glaze** (`--gold-soft`: gold mixed 22% into white in light, 16% into #17171a in dark): background of the active section sub-page pill, a quieter selection than the solid pill.
- **Ink on Gold** (#231a05): the only text colour allowed on a gold fill.

The full gold scale lives in `src/app/globals.css` (brand-50 #fdf8e9 to brand-950 #2b2008). In dark, brand-50/100/200 become dark gold glazes and brand-600 to 900 become light readable golds.

### Neutral
- **Night Canvas** (#0e0e10 dark / #f4f4f5 light): page background; also the fill of inputs and filter fields, so fields read as wells cut into the panel.
- **Graphite Panel** (#17171a dark / #ffffff light): cards, modals, menus, the portal bottom bar. Dark mode also repaints any `bg-white` to this.
- **Raised Graphite** (#1e1e22 dark / #f4f4f5 light): hover rows, table heads (at 70%), segmented bar tracks, icon chips, avatar and logo tiles.
- **Hairline** (#2a2a30 dark / #e4e4e7 light): every border and divider; chart grid.
- **Rail** (#121214 dark / #ffffff light): the staff sidebar, a half-step below the canvas.
- **Ink** (#f2f2f3 dark / #18181b light): primary text, figures.
- **Muted** (#a1a1aa dark / #5f5f69 light): secondary text, inactive nav, labels, icons at rest, chart axis text.

### Status
- **Paid Green** (#10b981 dot; emerald-50 glaze / emerald-700 text in chips), **Due Amber** (#f59e0b), **Overdue Red** (#f43f5e), **Follow-up Blue** (#0ea5e9). Chip tints become 14% glazes on #17171a in dark, and text shades become light (emerald-700 to #6ee7b7, rose-700 to #fda4af, amber-700 to #fcd34d, sky-700 to #7dd3fc). Violet (waived, sandbox) and slate (cancelled, draft) complete the chip set.

### Charts
Five series from CSS variables, gold first: dark #e9c95f, #5aaef0, #3fc792, #f08a5a, #a98cf5; light #c9971f, #2f8fd6, #1f9e6f, #d86a3a, #8b6ae0. Tooltips use the panel, hairline and a 12px radius.

### Named Rules
**The Gold Means Go Rule.** Gold appears only on primary actions, selection states (active nav, active tab, active sub-page) and links. Avatars, logo tiles, stat icon chips, stop numbers and decorative icons stay neutral graphite. If gold is on something you cannot press or are not currently on, it is wrong.

**The Dot and Word Rule.** State is always a small light plus a word ("Paid", "Act now", "Soon", "Follow up"). Never colour alone, never an icon's colour alone.

**The Light Paper Rule.** Print and PDF output is always light: the dark remap lives inside `@media screen`, and print forces a white body with #18181b text.

## Typography

**Display Font:** system sans stack (ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue) with Noto Sans Tamil and Latha for Tamil
**Body Font:** the same stack
**Label/Mono Font:** none distinct; figures use tabular numerals (`tnum`), set globally on tables

**Character:** One workhorse sans in every role, chosen so English and Tamil render in the platform's best native face. Hierarchy comes from size and weight, not from a second family.

### Hierarchy
- **Display** (700, 24px phones / 28px from 640px, 36px line, -0.025em, balanced wrap): page titles ("Dashboard", "Fees").
- **Figure** (600, 24px, -0.025em, tabular): stat tile values; compact strip values at 18px 600; attention-row counts at 16px 600.
- **Title** (600, 15px): card and panel headings ("Needs attention today"); modal titles at 16px.
- **Body** (400, 14px, 20px line): table cells, descriptions, menus, nav items (500). Form controls are 16px on phones (prevents iOS zoom) and 14px from 640px.
- **Label** (500, 13px): stat labels, small buttons, section sub-page pills.
- **Caption** (400 to 500, 12px): hints under figures, chips, table headers (600), description-list terms.
- **Nav group** (600, 11px, 0.08em, uppercase, muted at 80%): sidebar group headings only (Operations, Insights, Communication, Administration).

### Named Rules
**The Tabular Money Rule.** Every amount, count and pagination range uses tabular figures so columns of rupees align.

## Layout

The staff shell is a fixed 256px rail on the left from 1024px (a 288px drawer, max 85vw, over a 60% black scrim below that), and a sticky 64px top bar on a blurred 85% canvas holding global search (max 576px), theme switch, bell and account. When a module has two or more sub-pages they appear as a second header row: a horizontally scrolling segmented pill bar that scrolls the active pill into view. Content is centred at max 1280px with 12px side padding on phones and 24px from 640px, 24px / 32px top padding.

Page header: title left, actions right, wrapping; 24px below on phones, 32px from 640px. On phones the primary action spans the full row first and secondary actions share the row below in equal widths.

Dashboard rhythm: attention panel full width, then a 2-up (4-up from 1024px) stat grid with 12/16px gaps, a compact strip 12/16px below, then a 3-column grid (chart spans 2) with 16/20px gaps, sections 24px apart. Spacing follows a 4px base (4, 8, 12, 16, 20, 24, 32).

The parent and driver portals are mobile-first PWAs: a sticky 56px header (logo tile, title, user, theme, settings, sign out), content at max 1024px with 16px padding, and a fixed bottom tab bar (safe-area padded) whose labels wrap to two lines rather than truncate. From 768px the tabs move to a segmented pill bar under the header. Every surface must work at 375px wide.

## Elevation & Depth

Mostly flat, depth by tone: canvas, rail, panel and raised graphite step lightness by a few percent, and hairlines do the separating. Panels carry one faint card shadow so they lift off the canvas without looking stacked. Strong shadows belong only to things that float above the page.

### Shadow Vocabulary
- **Card** (light `0 1px 2px rgb(24 24 27 / 0.05), 0 2px 8px -2px rgb(24 24 27 / 0.06)`; dark `0 1px 2px rgb(0 0 0 / 0.4), 0 6px 16px -6px rgb(0 0 0 / 0.5)`): every card, stat tile, strip and the attention panel.
- **Floating** (Tailwind `shadow-2xl`): menus, search results, notifications, modals, toasts, mobile drawer.
- **Status halo** (`0 0 0 4px` at 20% of the status hue): the glowing dot in attention rows.

### Named Rules
**The Float-Only Shadow Rule.** Only layers above the page (menus, dialogs, toasts, drawers) get a heavy shadow; anything in the page flow uses the card shadow or none.

## Shapes

Large and soft. Everything clickable is a full pill (9999px): buttons, nav items, segmented bars and their items, search and filter fields, chips, icon buttons (40px circles). Containers use 16px corners (cards, tiles, panels, menus, empty states), form inputs and small tiles 12px (inputs, selects in forms, icon chips, logo tiles), and modals 24px (top corners only when they rise as a bottom sheet on phones). Borders are always 1px hairlines; empty states use a dashed hairline.

## Components

### Buttons
Pill-shaped and labelled; a press scales to 0.98 over 150ms.
- **Shape:** full pill (9999px); sizes 32px (14px padding, 13px), 40px (20px, 14px), 48px (24px, 16px); weight 500.
- **Primary:** Counter Gold fill, Ink on Gold text, faint shadow; hover brand-400, pressed brand-500; disabled at 50% opacity. One per header.
- **Secondary:** panel fill, ink text, hairline border; hover raised graphite with a slate-300 border.
- **Danger / Success:** tinted glazes (rose-50 / emerald-50 fill, 700 text, 200 border), never solid red or green.
- **Ghost:** muted text, raised-graphite hover. **Link:** gold-ink text, underline on hover.
- **Focus:** 2px gold outline, 2px offset (global `:focus-visible`).

### Chips
- **Style:** pill, 12px 500, 2px 10px padding, inset 1px ring in the tone's 200 shade over its 50 glaze, 700/800 text.
- **Status:** StatusBadge adds a 6px dot before the word; the status-to-tone map lives in `badge.tsx`.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Graphite Panel.
- **Shadow Strategy:** card shadow (see Elevation).
- **Border:** 1px hairline; header separated by a hairline.
- **Internal Padding:** 16px phones, 20px from 640px; header 14px vertical.

### Stat Tiles
Label row with a neutral 32px icon chip (raised graphite, muted icon, 12px corners), 24px tabular figure, 12px muted hint. Linked tiles reveal an arrow and a slate-300 border on hover. Secondary figures go in a compact strip: one card split by hairlines, 2-up then 4-up.

### Inputs / Fields
- **Style:** 40px, canvas fill (a well in the panel), hairline border, 12px corners in forms; search, filter selects and date filters are pills. Date filters carry an in-field 12px muted label.
- **Focus:** border to brand-400 plus a 2px gold ring at 30%.
- **Error / Disabled:** rose-400 border with 12px rose-600 message; disabled at 60% opacity. Required marker is a rose asterisk.

### Tables
14px, hairline row dividers at 70%, head on raised graphite at 70% with 12px 600 muted headers, 12px cell padding (16/20px at row ends), right-aligned numbers tabular, hover row tint. Rows may carry a 60% status glaze highlight.

### Navigation
- **Sidebar:** 14px 500 items with an 18px line icon (1.75 stroke), muted at rest, raised-graphite hover; active is a solid gold pill with Ink on Gold. Grouped under small uppercase group headings.
- **Section bar:** segmented pill track (raised graphite, hairline, 4px inset) with 13px items; active sub-page is the gold glaze with gold-ink 600 text.
- **Tabs:** same track; active tab is the solid gold pill; counts in a small inner pill.
- **Portal bottom bar:** icon in a 28 x 48px pill (solid gold when active) above an 11px label that wraps to two lines.

### Needs Attention List (signature)
A ranked panel of today's work: each row is an 8px glowing dot, the label (14px 500), a status word in the hue (11px 500: "Act now", "Soon", "Follow up"), a 12px muted detail, a 16px tabular count and a chevron that nudges right on hover. Red first, then amber, then blue. From 1024px it splits into two columns filled top to bottom so it still reads in rank order. Empty state: a green check and "All clear".

### Modals and Toasts
Modal: graphite panel, 24px corners, 60% black scrim with a 2px blur, hairline header and footer, rises as a bottom sheet on phones. Toast: panel with a hairline tinted by kind, bottom centre on phones and bottom right from 640px.

## Do's and Don'ts

### Do:
- **Do** keep gold (#e9c95f) to primary actions, active navigation and tab states, and links; put Ink on Gold (#231a05) on every gold fill.
- **Do** say every state as a dot (or chip) plus a word.
- **Do** keep text labels on secondary actions; icon-only is for universally understood utilities (close, bell, settings, sign out) that carry an aria-label.
- **Do** let primary navigation labels wrap rather than truncate; Tamil labels run longer than English.
- **Do** use tabular figures for amounts, and right-align numeric table columns.
- **Do** style through the shared kit and theme variables (`canvas`, `surface`, `surface-2`, `line`, `ink`, `muted`, `rail`, `brand`) so both themes and all pages follow.
- **Do** keep print and PDF output light.
- **Do** keep logo tiles neutral so any school's uploaded logo, or none, looks right.

### Don't:
- **Don't** put gold on avatars, logo tiles, stat icon chips, stop numbers or decorative icons.
- **Don't** signal state by colour alone, or by an icon's colour alone.
- **Don't** use solid red or green buttons; danger and success are tinted glazes.
- **Don't** put light text on gold.
- **Don't** add heavy shadows to in-flow panels.
- **Don't** let the dark remap leak into print.
