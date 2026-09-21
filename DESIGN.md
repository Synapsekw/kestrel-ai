# Design system: Contour

Contour is the selected Kestrel direction: charcoal surfaces, warm amber for the next action, and
quiet green for completed work. A site manager at a Windows laptop spends most of a session looking
at sand-coloured aerial imagery; the dark chrome keeps that imagery foremost. Instrument Sans and
plain task language carry the interface. CSS custom properties in `frontend/src/index.css` are exposed
through `frontend/tailwind.config.ts` and the shared `frontend/src/ui/` primitives.

## Colour

| Role | Hex | Use |
|---|---|---|
| ground | #1d2322 | app background |
| side | #191f1d | navigation rail |
| panel | #262d2b | inspector, forms, floating surfaces |
| well | #303936 | selected regions, tracks, neutral pills |
| canvas | #151b19 | image work area |
| ink | #edf0e9 | body and control text |
| muted | #a3aea6 | secondary text and metadata |
| dim | #738078 | disabled and nonessential decoration |
| line | #38423e | quiet separators |
| line-strong | #56645c | emphasized separators |
| control-line | #839188 | essential input boundaries |
| accent | #e5af64 | primary action and focus |
| accent-hover | #efbf7b | primary action hover |
| accent-fg | #29241b | text and checkmarks on amber |
| accent-soft | #373226 | active navigation |
| accent-ink | #edc991 | text on accent-soft and action links |
| accent-line | #665236 | accent surface borders |
| ok | #aed1b1 | success text and completed steps |
| ok-soft | #283b2e | success surfaces |
| warn | #eec779 | warning text |
| warn-strong | #e5af64 | thumbnail review badge, with accent-fg text |
| warn-soft | #3e3422 | warning surfaces |
| danger | #f6a299 | error text and destructive emphasis |
| danger-soft | #412a28 | error surfaces |
| inverse | #151b19 | floating selection bars and tooltips |
| inverse-fg | #edf0e9 | text on inverse and photography overlays |

Body/control text targets 4.5:1 contrast; essential control boundaries and focus target 3:1.
`ui/contrast.test.ts` reads the actual palette. Filled semantic success and danger elements use dark
`text-ground`; filled amber uses `text-accent-fg`. Stored box class colours remain unchanged.
Native controls use a dark colour scheme. Fine separators need not carry the brighter input border.

## Typography and geometry

One bundled family: Instrument Sans, with Segoe UI and system sans fallbacks. Body and controls are
13–14px; secondary metadata 11–12px; section headings 16–18px; principal page headings 24–28px.
File names and paths use the monospace stack; counts use tabular numerals. Use weights 400, 500 and
600, with tight tracking only for headings.

Controls use 7px corners and panels/thumbnails 10px. Borders are 1px. Use spacing and fine separators
instead of nested cards. Floating surfaces receive shadows; ordinary screen sections do not.
The shared primitives remain Button, IconButton, Input, Textarea, Select, Checkbox, Switch, Field,
Pill, Alert, Toast, Progress, Skeleton, EmptyState, Segmented, Kbd, Dialog, Icon and Disclosure.

## Shell and workspaces

An open project starts with an 82px navigation rail: icons and short labels, active amber state,
completed-step checks, and an explicit expand control. Expansion shows full labels, counts and the
project name at 224px. Locked links retain explanations on hover/focus. Projects, project settings
and app settings stay reachable. The header identifies project and screen and retains Jobs.
Long names truncate; the rail scrolls on short windows. Width changes are immediate.

The editor has a single 310px right inspector. Drawing class stays visible above an All classes
disclosure containing class counts and hotkeys. Review actions, confidence, no-machinery state and
regions share the inspector's scroll area. The image toolbar groups filename/navigation separately
from view/history controls. At small widths the inspector stacks below a usable canvas. Existing
label, selected-region, pan, rotation and shortcut semantics are unchanged.

Home makes the real next action its focal point, beside a recent image when available. One metadata
request uses limit=3 with newest imports first; it never follows a cursor. The hero uses one bounded
1024px display image, and the other two previews use thumbnails. Image or metadata
failure leaves a quiet fallback and a working next action. Totals and running jobs remain real.
Images retains virtualized/paginated reads and all filters, selection and bulk actions; each
thumbnail has a separate filename caption and deliberate selection/focus treatment.

## Motion

Use cubic-bezier(.23,1,.32,1): 140ms hover/press, 180ms reveals, 220ms drawers. Animate transform and
opacity, never layout properties. Keyboard class/region selection and rail width changes are
immediate. Reduced motion removes movement. Existing job progress animation conveys running state;
no decorative loops are added. Loading chrome mirrors the final layout.

## Copy and budgets

Screen names remain Projects, Home, Images, Label, Datasets, Train, Detect, Review, Models, Export,
Project settings and App settings. Use suggestions, accept as labels, and flight where appropriate.
Buttons name the action. A/R continue to accept/reject visible suggestions using existing handlers.
Training, inference, import and export remain background jobs with progress. No dataset traversal,
whole-image-set read, new endpoint, runtime dependency, or fabricated aggregate is introduced.
