# Ledgerly UI Design System

This document is the UI contract for authenticated Ledgerly web modules. New screens should look like one product, not a collection of independently styled plugins.

## Product shell

The authenticated shell is owned by `web/components/AppShell.tsx`.

- Desktop uses a compact utility rail, a global search bar, organization identity, account actions, and a horizontally scrollable module switcher.
- Modules must not add another permanent left sidebar. Module-local permanent sidebars are hidden by the Fusion layer.
- A module with several pages opens from its module pill into the shared module menu.
- `Ctrl/Cmd + K` focuses global search. Unmatched questions can be handed to Ledgerly AI.
- Mobile uses the drawer for full navigation and a bottom dock for Home, Create, Apps, and Menu.
- Navigation must always be driven by the frontend module registry and permissions. Do not hard-code tenant-specific links.

## Visual language

Authenticated Ledgerly is deliberately information-first.

- Canvas: soft neutral grey.
- Surfaces: white.
- Primary accent: Ledgerly green.
- Borders are preferred to large shadows.
- Cards use modest radii. Avoid oversized floating cards, decorative gradients, neon effects, glassmorphism, and large empty hero areas.
- Use colour to communicate meaning or improve scanning, not as decoration.
- Typography should be compact and readable. Page titles are generally 20–24 px inside the authenticated product.
- Dense workspaces should remain calm: use spacing, separators, grouping and typography before introducing more colour.

The canonical variables live in `web/fusion.css`:

- `--brand`
- `--brand-dark`
- `--brand-soft`
- `--ink`
- `--ink-2`
- `--muted`
- `--line`
- `--line-soft`
- `--canvas`
- `--surface`

Module-specific colours should not redefine the main application palette.

## Page structure

A normal page should contain:

1. A compact page header with title, short supporting text, and actions.
2. Optional metrics in a responsive grid.
3. Toolbars or tabs only when they help the task.
4. One or more bordered white work surfaces.
5. Tables/forms/details using the same spacing and field treatment as other modules.

Avoid duplicating the organization name, global navigation, user profile, app launcher, or global search inside module content.

## Cards and metrics

- Use a 1 px neutral border and little or no shadow.
- Metric cards should fit four across on large screens, two across on medium/small screens, and remain legible on narrow phones.
- Keep labels short and use the supporting line for context.
- Do not use a different card design for every metric.

## Forms

- Use labels and clear validation messages.
- Inputs, selects and text areas must fill their grid cell.
- Desktop forms may use two columns where useful.
- Forms collapse to one column on phones.
- Mobile controls use at least a 40 px touch height and 16 px input text to avoid browser zoom.
- Primary actions use Ledgerly green; destructive actions must be visibly destructive.

## Tables

- Tables remain real tables on desktop.
- Put wide tables inside a horizontal scroll container on narrow screens rather than shrinking text to unreadable sizes.
- Table headers use a subtle neutral background and compact uppercase labels.
- Keep row action groups together and allow them to wrap.

## Modals and drawers

- Desktop dialogs are centered, bounded, and scroll internally when needed.
- On small screens, dialogs can grow to nearly the full viewport width.
- Always preserve a visible close action.
- Do not create nested modal systems when the shared application patterns are sufficient.

## Responsive breakpoints

The Fusion layer currently uses these practical ranges:

- Above 1100 px: full desktop layouts.
- 800–1100 px: reduced grids / compact side panels.
- 560–800 px: stacked work areas and simplified toolbars.
- Below 560–680 px: phone layout, one-column forms, touch targets, bottom navigation dock.

Test new pages at approximately 1440 px, 1024 px, 768 px, 390 px and 320 px widths.

## Accessibility

- Every interactive icon requires an accessible label or visible text.
- Preserve keyboard focus outlines.
- Use semantic buttons and links.
- Do not communicate status by colour alone.
- Respect `prefers-reduced-motion`.
- Maintain readable contrast for muted text and status chips.

## CSS ownership

Global authenticated product styling is split into:

- `web/fusion.css` — shell, global primitives, mobile navigation and accessibility.
- `web/fusion-dashboard.css` — dashboard/workspace settings.
- `web/fusion-education.css` — School, Academics, Attendance, Exams and Books.
- `web/fusion-business.css` — finance, billing, contacts, HR, communications and work.
- `web/fusion-tools.css` — files, Printerly, Security and Ledgerly AI.
- `web/fusion-public.css` — authentication and public pages.

Module-local CSS may implement task-specific layout, but the Fusion files have final authority over product-level appearance.

## Review checklist

Before merging a new or redesigned screen verify that it:

- uses the shared shell rather than adding another permanent navigation shell;
- has no unnecessary decorative hero/gradient inside the authenticated application;
- works without horizontal page overflow at phone widths;
- keeps wide data tables in scroll containers;
- has usable mobile forms and touch targets;
- has visible empty, loading and error states;
- supports keyboard focus;
- uses registry/permission-aware navigation;
- follows the shared colour and card language;
- still works when organization/module availability changes.

The goal is consistency over novelty: users should be able to move from School to Finance to Academics to Printerly without feeling that they have entered a different application.
