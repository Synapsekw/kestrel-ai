# Design system: Site office

Light, stone-grey neutrals tinted toward the imagery, one safety-orange accent for the primary action
and the current step, green for done, amber for "needs review". Implemented as CSS custom properties in
`frontend/src/index.css`, exposed as Tailwind colour names in `frontend/tailwind.config.ts`, and used
through the components in `frontend/src/ui/`.

## Colour (hex; Tailwind name in brackets)

| Role | Value | Tailwind | Use |
|---|---|---|---|
| ground | #f5f5f1 | `bg-ground` | app background |
| sidebar | #ebece6 | `bg-side` | sidebar, editor side panels |
| panel | #ffffff | `bg-panel` | cards, inputs, popovers, table rows |
| well | #e6e7e1 | `bg-well` | segmented controls, progress tracks, skeletons |
| hover | rgb(30 32 26 / 0.06) | `bg-hover` | hover wash on ghost buttons and nav |
| ink | #1f221d | `text-ink` | body text |
| muted | #6a6f66 | `text-muted` | secondary text, labels |
| dim | #a9ada4 | `text-dim` | disabled text |
| line | #dcddd6 | `border-line` | default borders |
| line-strong | #c3c6bd | `border-line-strong` | hovered borders, checkbox border |
| accent | #d9480f | `bg-accent` | primary buttons, current step, focus ring |
| accent-hover | #c23f0b | `bg-accent-hover` | primary button hover |
| accent-soft | #fbeadf | `bg-accent-soft` | next-step banner, running pill |
| accent-ink | #8a2f08 | `text-accent-ink` | text on accent-soft |
| accent-line | #f0cdb8 | `border-accent-line` | border of accent-soft surfaces |
| ok | #2f7d4f | `text-ok` / `bg-ok` | done, succeeded |
| ok-soft | #dff1e5 | `bg-ok-soft` | success pill and alert background |
| warn | #b98200 | `text-warn` | needs review, warnings (text) |
| warn-strong | #e0a400 | `bg-warn-strong` | review badge on thumbnails |
| warn-soft | #fbf0c7 | `bg-warn-soft` | warning pill and alert background |
| danger | #b42318 | `text-danger` / `bg-danger` | destructive actions, errors |
| danger-soft | #fde8e6 | `bg-danger-soft` | error alert background |
| inverse | #1f221d | `bg-inverse` | selection bar, toasts, tooltips |
| inverse-fg | #f5f5f1 | `text-inverse-fg` | text on inverse |
| canvas | #232722 | `bg-canvas` | the editor's image area |

Class colours for boxes stay as stored per project (orange, yellow, green, cyan, blue, purple, pink, red).

Strategy: Restrained. Orange is on the primary button, the current step, the focus ring and links,
nowhere else. Semantic green, amber and red are not accents.

## Typography

One family: Instrument Sans (variable, bundled from `@fontsource-variable/instrument-sans`), fallback
"Segoe UI", system-ui. Numbers in tables and counters use `tabular-nums`. File names and paths use the
monospace stack (`font-mono`) at the same size as the surrounding text.

Scale (rem at 16px root): 12 (captions, table meta), 13 (dense UI: tables, editor chrome), 14 (body,
forms, buttons), 16 (section titles, `font-semibold`), 20 (screen titles, `font-semibold`,
`tracking-tight`). Nothing larger inside the app. Weights 400, 500 (buttons, nav), 600 (titles).

## Radius, borders, shadow

- `rounded-md` (7px) on controls, `rounded-lg` (10px) on panels and thumbnails, `rounded-full` on pills.
- Borders 1px `border-line`. No side stripes. No nested cards.
- Shadow only on things that float: popovers, the jobs drawer, toasts, hovered thumbnails
  (`shadow-float`).

## Spacing and layout

- Sidebar 224px, header 48px, screen padding 24px, gap 16px between blocks, 8px inside rows.
- Screens are left-aligned with a max width of 72rem for forms and prose; lists and grids fill the width.
- Tables: 36px rows, header in `text-muted` 12px, zebra off, hover wash on rows.

## Components (`frontend/src/ui/`)

Button (primary, secondary, ghost, danger; sm, md; `loading`), IconButton, Input, Textarea, Select
(native select, styled, chevron), Checkbox, Switch, Field (label, hint, error), Pill (neutral, ok, warn,
danger, accent; optional live dot), Alert (info, ok, warn, danger), Toast + `toast()` store, Progress,
Skeleton, EmptyState, Segmented, Kbd, Dialog, Icon (`name` from a fixed set), Disclosure ("More
options").

Every interactive component has default, hover, focus-visible (2px accent ring, offset 2), active
(`scale-[.97]`), disabled (opacity 45, no hover) states.

## Motion

- `--ease-out: cubic-bezier(.23,1,.32,1)`; 140ms hover/press, 180ms reveals, 220ms drawers and dialogs.
- Press: `active:scale-[.97]` on buttons and checkboxes.
- Reveal: selection bar, alerts, toasts, dialogs enter with opacity 0 to 1 and translateY(6px) to 0,
  or scale .97 to 1 for dialogs. Exits are 120ms.
- Running work: a shimmer on progress bars; a pulsing dot in the running pill. Nothing else loops.
- Lists load with skeleton rows, never a spinner in the middle of the content.
- No animation on keyboard-triggered actions in the editor. `prefers-reduced-motion` removes movement,
  keeps opacity.

## Copy

Screen names: Projects, Home, Images, Label, Datasets, Train, Detect, Review, Models, Project settings,
App settings. Suggestions (not proposals), accept as labels (not promote), flight (not group) where the
group is a flight. Buttons name the action: "Import images", "Start training", "Run detection",
"Accept 12 boxes as labels".
