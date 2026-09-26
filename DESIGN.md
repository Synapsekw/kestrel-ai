# Design system: Aero glass

Aero glass is Kestrel's direction (umbrella decision D9): a deep indigo backdrop, translucent panels,
frosted glass only where controls float over imagery, a violet → indigo primary gradient, teal for
success, Space Grotesk for the interface and JetBrains Mono for figures. The approved mockups are
`.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html` (tab D) and
`ws-images.html`, `ws-maps.html`, `ws-clouds.html`. Tokens live in `frontend/src/index.css`, are exposed
through `frontend/tailwind.config.ts`, and are used through the primitives in `frontend/src/ui/`.
See every primitive live at `http://127.0.0.1:1420/gallery.html` under `pnpm -C frontend dev`
(`?effects=reduced`, `?motion=reduced` preview the two modes). `pnpm -C frontend lint` runs
`scripts/check-tokens.mjs`, which fails raw palette colours, arbitrary colours, radii, fonts and
shadows, raw durations, blur outside the primitives, retired Contour names, and opacity modifiers on
translucent tokens.

## Colour

Opaque colours are RGB triplets (`--ink: 242 241 251`), used as `text-ink`, `bg-accent/20`.
Translucent surfaces are complete `rgba()` values and take **no** opacity modifier
(`bg-surface/80` silently draws nothing; lint fails it).

| Token | Value | Use |
|---|---|---|
| `--backdrop` | indigo radial top right, teal radial bottom left, on `#0e0f1c` | `body`, painted once, fixed |
| `bg` | #0e0f1c | solid base, canvas behind imagery, sticky table header, reduced-effects glass |
| `surface` / `surface-2` / `field` | white 5.5% / 8% / 6% | cards and panes / wells, tracks, neutral chips / inputs |
| `hover` / `rail` | white 5% / 3% | row hover / icon rail |
| `glass`, `glass-line`, `glass-ink` | rgba(14,15,28,.55), white 14%, #f2f1fb | floating panels over imagery |
| `line` / `line-strong` / `card-line` | white 8% / 20% / 9% | separators, borders |
| `control-line` | #767496 | boundaries that are a control's only affordance (checkbox, switch track, slider track) |
| `ink` / `muted` / `dim` | #f2f1fb / #a7a6c4 / #6e6d8e | text; dim is for disabled and decoration |
| `accent`, `accent-ink`, `accent-fg`, `accent-soft` | #8f7bff, #c9bfff, #fff, violet 18% | focus, active, links, selected rows |
| `ok` / `danger` / `warn` (+ `-soft`) | #5fe3c0 / #ff8aa0 / #ffc46b | success, errors and destructive actions and the Defect tag, warnings |
| `info` | #8aa4ff | the reviewed status, the Object tag |
| `tip` / `tip-fg` | #1b1a33 / #fff | tooltips, toasts, native option lists |
| `grad-primary` / `grad-brand` / `grad-ink` / `grad-ai` | violet→indigo / violet→teal / violet→teal (90°) / violet→teal tint | primary buttons and active tools / logo tile / tab indicator / AI provenance |

Severity colours are data, not tokens (default 1 Minor #3fb68e, 2 Moderate #e2bf2e, 3 Major #ff9c3a,
4 Critical #ff5a4f; the scale is editable in the Catalogue). Status: open `accent`, reviewed `info`,
closed `ok`. Colours from data (severity, catalogue types) reach CSS only as `--c` on a `style` prop.

Contrast is tested in `ui/contrast.test.ts`, compositing each translucent surface over `bg`: text 4.5:1,
control boundaries and focus 3:1, with no exceptions. White labels on the primary button reach 4.5:1
at both gradient stops (`--primary-from` #7258ff, `--primary-to` #3766ff).

Retired Contour names and their replacements: `ground`/`canvas` → `bg`, `side` → `rail`,
`panel` → `surface`, `well` → `surface-2`, `inverse`/`inverse-fg` → `tip`/`tip-fg`,
`warn-strong` → `warn`, `accent-hover` → `accent-ink`, `accent-line` → `line-strong`.

## Typography

Space Grotesk (UI and display) and JetBrains Mono (ids, figures, key caps, coordinates, file names),
bundled as `@fontsource-variable/*` files; nothing is fetched at runtime (the packaged CSP forbids it).
The scale: `text-2xs` 10.5/14 500 (chip counts, meta), `text-xs` 11.5/16 500 (labels), `text-sm`
12.5/18 (body, table rows), `text-base` 13.5/20 (forms), `text-lg` 16/22 600 (card and section
titles), `text-xl` 20/26 600 (page titles), `text-kpi` 30/33 600 −0.02em (StatTile values). Figures
always use `tabular-nums`. Sentence case everywhere; no all-caps labels. Key caps are rendered only by
`KeyChord` (`ui/Kbd.tsx`), the one chord-to-key-cap renderer (Tooltip, Menu, CommandPalette).

## Radii and elevation

`rounded-panel` 16px (cards, panes, dialogs), `rounded-control` 10px (buttons, fields, glass groups),
`rounded-chip` full (pills, badges, tracks), `rounded-sm` 6px (thumbnails, menu rows). Key caps
(`Kbd`, 4px) and type swatches (`TypeChip`, `Combobox`, 3px) keep the mockup's 3–4px, not `rounded-sm`.
`shadow-elev-1` (cards: an inset top highlight and a soft drop), `shadow-elev-2` (hovered cards,
popovers, dialogs, toasts), `shadow-glow` (primary button, active tool; dropped in reduced effects).
Any hand-made glow in a primitive carries `reduce-effects:shadow-none` so it drops too.

## Glass and blur rules

- Blur exists only in `GlassPanel variant="float"` (`.glass-float`, 12px), which Dialog, Popover,
  Menu, CommandPalette and FloatingToolbar use. It is for controls floating over imagery.
- Cards, panes, list panes, dashboards and `DataTable` are translucent **without** blur: over a smooth
  gradient the blur is invisible and costs GPU.
- Never put blur on a scrolling container of a long list.
- Nothing around glass may keep a lasting opacity or transform effect: an animation that ends with
  fill-mode `both`/`forwards` makes its element a backdrop root, and glass inside it blurs nothing.
  Entrances fill `backwards`; page transitions must not hold an opacity/transform effect either.
- A floating panel that is not `GlassPanel` (a drawer, dropdown, context menu or map overlay) uses the
  opaque `bg-glass-solid`, never the 5.5% `bg-surface`.
- Tooltip, Popover and Menu are placed by `placeFloating` (`ui/floating.ts`), the one placement
  algorithm (flip to the other side, then clamp into the viewport).

## Motion

Tokens: `--dur-instant` 0 (keyboard selection, the rail), `--dur-fast` 120ms (hover, press, colour),
`--dur-base` 180ms (reveals, page transition, tooltip), `--dur-slow` 260ms (drawers, inspector,
dialog), `--dur-emphasis` 350ms (tab indicator, segmented thumb, severity bars), `--dur-count` 600ms
(count-up, sparkline draw); `--ease-out` (default), `--ease-spring` (pin and badge pop only),
`--ease-in-out` (page cross-fade); stagger 40ms, items 9+ arrive with item 8 (`.stagger` +
`style={stagger(i)}`). Tailwind: `duration-fast|base|slow|emphasis|count`, `ease-out|spring|in-out`.
`ui/motion.ts` mirrors them for JavaScript (`dur`, `easing`, `useReducedMotion`).

Rules: animate only `transform` and `opacity` (bars and fills move a full-width bar with translateX;
sparklines grow a clip with scaleX). Nothing on an interaction path waits for motion or runs longer
than 400ms. Loops (live dot, shimmer, indeterminate bar) run only while real work runs; a finite pulse
(at most 3 cycles) on create or select is allowed; no indefinite pulse on static data; no decorative
sweeps.

Reduced motion (the OS setting, or Settings → Reduce motion, `<html data-motion="reduced">`): every
duration but `--dur-fast` is 0, the stagger is 0, count-up shows the final value, sparklines draw at
once, indicators jump, loops stop. The Tailwind variant is `reduce-motion:`, which honours both
triggers; Tailwind 3.4's built-in `motion-reduce:` cannot see `data-motion`, so lint fails a bare
`motion-reduce:`.

## Reduced effects

`<html data-effects="full|reduced">`, set by `frontend/src/app/effects.ts` before the first paint.
Reduced: glass is opaque `#16172a` with no blur, the backdrop is one static gradient, glows are gone,
`--elev-1` stays; motion is untouched (a separate setting). Settings → Appearance → Visual effects:
Auto (default), Full, Reduced, stored in `localStorage` `kestrel.effects`. Auto starts reduced on a
software renderer (SwiftShader, Microsoft Basic Render), otherwise full; on the first Overview render a
2-second frame probe (after a 300ms warm-up, only while the window is visible; a window hidden
mid-probe gives no decision, and gaps over 500ms are dropped) switches to reduced when
p95 > 24ms, remembers that, and offers Undo, which chooses Full for good.

## Shell

A 64px icon rail (the logo tile, Projects, Models, Catalogue, Jobs, a spacer, Settings) with tooltips on
the right; the active entry is `accent-soft` with a 3px gradient bar. A 56px top bar: the breadcrumb
(`Projects / ● Name / Tab`, the dot a `StatusDot`, live while a job runs), the search field that opens
the command palette (Ctrl K), the route's context actions, the agent button and the running-jobs pill.
Project tabs (`Tabs asLinks`, counts in mono) sit under it: Overview, Images, Maps, Point clouds,
Findings, Measurements, Reports; they hide on the full-bleed Maps and Point clouds workspaces. A tab
change fades and rises 6px over `--dur-base`, with no exit animation.

## Workspaces

Maps and Point clouds are full-bleed; Images has a browser, a canvas and an inspector. The canvas sits
on `bg`. Every control over imagery floats as glass: the tool palette (`FloatingToolbar`, top left,
tooltips "Box · B"), the zoom group (top right), the info bar, the hint bar (bottom centre), layer and
type popovers (`Popover`, `Combobox`). The inspector (`InspectorPane`) is 340px on the right and stacks
below the content under 1100px. One keymap covers the app (`ui/keymap.ts`, spec §5.6): global keys,
review keys (A accept, X reject, 1–9 severity, T type, Tab next), and per-workspace tool keys that never
equal a global or review key; M always drops a finding marker, L always measures a length, D always runs
AI detection. The keymap also has a `findings` scope, reserved empty, that S1 fills (J, K, Shift+O/R/C).
Keys never fire while typing, and a focused primitive (slider, table, menu, picker) keeps the keys it
handles.

## Data visualisation

`StatTile`: label, a 30px value that counts up once (on mount or change), a delta coloured by which
direction is good, chips, and a `Sparkline` (≤ 60 points, a 2px accent line over a 12% fill, bottom
right). Severity bars: an 8px `surface-2` track per level, the fill in the level's colour, growing with
translateX over `--dur-emphasis` with the stagger; a click filters the Findings tab. Legends and map
pins use the severity colours; critical pins get a thicker ring, never a pulse. Tables are `DataTable`.

## App identity

The Kestrel mark (`frontend/src/assets/kestrel-mark.svg`, the single geometry master) sits on a 36px
`grad-brand` tile with a 12px radius at the top of the rail. The native icons (`icons:generate`) keep
their current artwork until a follow-up regenerates them on the brand gradient.

## Copy

Screen names: Projects, Models (Library, Datasets, Training), Catalogue (Types, Severity), Jobs,
Settings; project tabs as in Shell. Words: a **finding** is a defect with a type, a severity and a
status (Open, Reviewed, Closed); a **suggestion** or **detection** is a model output awaiting review;
**accept** and **reject**; **Add data**. Buttons name the action ("Close finding", not "OK"). Finding
numbers are `F-0217` in mono. Errors say what happened and what to do next.

## Budgets

- Motion: ≤ 400ms on any interaction path; loops only while work runs; reduced motion honoured.
- Blur: floating glass only; the Findings table, lists and dashboards are never blurred.
- Frames: p95 ≤ 20ms at full effects on the dev machine (the e2e frame check); Auto reduces above 24ms.
- Lists: `DataTable` renders only the visible window of 44px rows and pages by cursor; sparklines ≤ 60
  points; the palette debounces search by 120ms and aborts superseded requests.
- Long work (training, inference, import, export, dataset build, migration, report PDF) is a background
  job with progress; no screen reads a full image set.
