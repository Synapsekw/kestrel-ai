# Site office UI: design

Date 2026-09-19. Owner decision: direction A "Site office" of the three shown in the directions page
(A site office, B control room, C guided). Product and design context: `PRODUCT.md`, `DESIGN.md` at
the repo root (the design system itself lives in `DESIGN.md`; this spec covers what changes in the app).

## Goal

The app must be usable by someone who has never trained a model, without documentation: they should
always see where the project stands and what to do next, every control should look and behave the same
on every screen, and the interface should feel finished (hover, press, focus, loading and finished
states; icons; a real mark). No backend change. No contract change.

## Not in scope

Dark theme, touch layouts, new features beyond the project home and the "Label" resolver, changes to
the editor's canvas behaviour, changes to job semantics.

## 1. Foundation

### Tokens

`frontend/src/index.css` declares the colour tokens of `DESIGN.md` as CSS custom properties (RGB
triplets so Tailwind opacity modifiers work) and the easing variable. `frontend/tailwind.config.ts`
maps them to colour names (`ground`, `side`, `panel`, `well`, `hover`, `ink`, `muted`, `dim`, `line`,
`line-strong`, `accent`, `accent-hover`, `accent-soft`, `accent-ink`, `accent-line`, `ok`, `ok-soft`,
`warn`, `warn-strong`, `warn-soft`, `danger`, `danger-soft`, `inverse`, `inverse-fg`, `canvas`), sets
`fontFamily.sans` to Instrument Sans Variable with the Segoe UI and system-ui fallbacks, adds
`boxShadow.float`, `borderRadius.md = 7px`, `borderRadius.lg = 10px`, and the keyframes `reveal`
(opacity 0, translateY 6px to opacity 1, translateY 0), `pop` (opacity 0, scale .97 to 1), `shimmer`
and `pulse-dot`. `@fontsource-variable/instrument-sans` is added to the frontend dependencies and
imported in `main.tsx`. `body` gets `bg-ground text-ink`.

All `slate-*`, `orange-*`, `emerald-*`, `amber-*`, `red-*`, `sky-*` classes disappear from `src/`
(the lint step greps for them; see section 6). Class colours of boxes stay inline styles.

### Components, `frontend/src/ui/`

One file per component, one test file per component with behaviour worth testing (not snapshot tests).

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost" \| "danger"` (default secondary), `size: "sm" \| "md"` (default md), `loading?: boolean`, `icon?: IconName`, all button attributes | `loading` disables the button, shows a spinner before the label and keeps the label. `active:scale-[.97]`. `type="button"` by default. |
| `IconButton` | `icon: IconName`, `label: string` (aria-label and tooltip), `size`, `variant` | Square. |
| `Input`, `Textarea` | native attributes, `invalid?: boolean` | Height 36px (md). Mono variant through `className="font-mono"`. |
| `Select` | native select attributes | Native `<select>` with the chevron drawn by the wrapper; keeps keyboard and test behaviour of a native select. |
| `Checkbox` | native attributes, `label?: string` | 16px box, tick scales in. |
| `Switch` | `checked`, `onChange(checked)`, `label` | `role="switch"`. |
| `Field` | `label`, `htmlFor`, `hint?`, `error?`, `children` | Label above, hint below in muted, error in danger with `role="alert"` only when present. |
| `Pill` | `tone: "neutral" \| "ok" \| "warn" \| "danger" \| "accent"`, `live?: boolean` | Live adds the pulsing dot. |
| `Alert` | `tone: "info" \| "ok" \| "warn" \| "danger"`, `title?`, `onDismiss?`, children | `role="alert"` for danger, `role="status"` otherwise. Enters with `reveal`. |
| `Progress` | `value` (0 to 1) or indeterminate, `running?: boolean` | Shimmer while running. |
| `Skeleton` | `className` | Well-coloured block with a slow shimmer. `SkeletonRows({ rows, columns })` helper. |
| `EmptyState` | `icon`, `title`, `children`, `action?` | Centred, max width 28rem. |
| `Segmented` | `options: {value,label}[]`, `value`, `onChange` | Used for Grid / List. |
| `Kbd` | children | |
| `Dialog` | `open`, `title`, `onClose`, `children`, `footer?`, `width?` | Focus trap, Escape, backdrop click closes, `pop` entrance. Existing dialogs move onto it. |
| `Disclosure` | `label` (default "More options"), `defaultOpen?`, children | Chevron rotates 90 degrees. |
| `Icon` | `name: IconName`, `size?` | Inline SVG, `stroke="currentColor"`, 1.75 stroke, from a fixed set: `folder`, `images`, `label`, `datasets`, `train`, `detect`, `review`, `models`, `settings`, `home`, `search`, `chevron-down`, `chevron-right`, `check`, `x`, `plus`, `import`, `play`, `trash`, `undo`, `redo`, `fit`, `one-to-one`, `keyboard`, `grid`, `list`, `warning`, `info`, `external`, `spinner`, `arrow-left`, `arrow-right`. |
| `Toaster` + `toast(kind, text, options)` | store in `src/ui/toastStore.ts` | Bottom right, max 3, 6 s auto-dismiss (paused on hover), enter with `reveal`, exit 120 ms. Job completion toasts come from one hook `useJobToasts(projectId)` in the shell: "Import finished: 40 images", "Training finished: model v2 registered", "Detection finished: 415 boxes on 40 images", failures in danger tone with a "Show log" action that opens the jobs drawer. |
| `Tooltip` | `label`, children | Title attribute is not enough for disabled elements; a small CSS tooltip on hover and focus, 400 ms delay. |

Every component: focus-visible ring `ring-2 ring-accent ring-offset-2 ring-offset-ground`, disabled
`opacity-45 pointer-events-none`. Transitions on `background-color, border-color, color, transform,
box-shadow, opacity` only, 140 ms, `--ease-out`.

## 2. Shell and navigation

- Sidebar 224px on `bg-side`. Top: the mark (orange square, hard-hat line icon) and "Kestrel AI".
  Then "Projects" (folder icon). Then, when a project is open, its name as the group title, and the
  entries in pipeline order, each with a step indicator on the left and a count on the right:

  | Entry | Step state | Count | Route |
  |---|---|---|---|
  | Home | none (house icon) | | `/p/:id` |
  | Images | 1 | images | `/p/:id/data` |
  | Label | 2 | labeled / images | `/p/:id/label` (resolver, section 3) |
  | Datasets | 3 | datasets | `/p/:id/datasets` |
  | Train | 4 | trained models | `/p/:id/train` |
  | Detect | 5 | | `/p/:id/query` |
  | Review | 6 | boxes waiting | `/p/:id/review` |

  Step indicator: 18px circle. Done: green fill, white tick. Current: orange ring, orange number on
  `accent-soft`. Upcoming: grey ring, muted number. Locked (needs an earlier step): dim number, entry
  in `text-dim`, tooltip says why ("Import images first", "Label some images first", "Create a dataset
  first", "Train a model or add a starter model first").

  Done and current come from `ProjectProgress` through `stepStates(progress)` in
  `src/app/pipeline.ts`: Images done when images > 0; Label done when labeled > 0 (current when images
  > 0 and labeled < images); Datasets done when datasets > 0; Train done when trainedModels > 0 (a
  starter or imported model counts for unlocking Detect); Detect done when a detection run exists
  (query runs > 0, added to progress); Review current when pendingReview > 0. Locked: Label, Datasets
  need images; Train needs datasets; Detect needs models; Review needs a run or pending boxes. The
  current step is the first step that is not done and not locked, except that Review is current
  whenever pendingReview > 0.

  Below the pipeline: "Models" (registry icon) and "Project settings". At the bottom: "App settings".
  Active entry: `bg-panel` with a 1px `shadow-sm`, text ink. Hover: `bg-hover`.

- Progress loading moves out of `NextStepBar` into `useProjectProgress(projectId)` in
  `src/app/useProjectProgress.ts` (same fetches plus query runs; refreshes on job completion, route
  change and the existing `tick`), consumed by the shell, the next-step bar and the project home.
  A store in `src/store/progress.ts` holds the last value per project so the sidebar does not flash.

- Header 48px: breadcrumb "Project name / Screen" in muted with the screen in ink; right side: the
  running-jobs pill (`Pill tone="accent" live` "Training v2 · epoch 12 of 50" for the newest active
  job, or "1 job running" when the message is empty; nothing when idle) and the "Jobs" ghost button
  with the drawer. Jobs drawer: `bg-panel`, `shadow-float`, slides in 220 ms from the right.

- Next-step bar becomes a banner on `accent-soft` under the header on every project screen except the
  editor: bold "Next: ..." text, one-line explanation, six step ticks on the right, and a primary
  button that goes where `nextStep.to` points. Hidden when `nextStep` is null and on the Home screen
  (Home has its own card).

- Screen titles: 20px semibold with the primary action on the right of the same line, as today.

## 3. New screens and routes

- `/p/:projectId` Home (`src/screens/HomeScreen.tsx`): the project name as title, the folder in mono
  muted under it; a "Where this project stands" table (Images, Labeled x of y, Marked empty, Datasets,
  Models with trained count, Waiting for review, Last detection run); the next-step card (same
  content as the banner, primary button); "Running now" list of active jobs with progress bars, or
  "Nothing running". Opened after creating or opening a project (Projects screen navigates here).

- `/p/:projectId/label` (`src/screens/LabelResolverScreen.tsx`): fetches the first unlabeled,
  not-marked-empty image (`labeled=false` filter, page size 1, sort by file); if found, sets the
  navigation context to the unlabeled list and redirects to the editor; if every image is labeled,
  redirects to Images with a status "All 40 images are labeled" (query param `?notice=all-labeled`
  read by the Images screen); if the project has no images, redirects to Images. Shows a skeleton
  while resolving.

- Existing paths stay (`data`, `edit/:imageId`, `review`, `datasets`, `models`, `train`, `query`,
  `settings`); only labels change.

## 4. Screen by screen

Common to all: `text-2xl` titles become 20px semibold; every raw `<button>`, `<input>`, `<select>`,
`<textarea>` becomes the matching `ui` component; every inline error paragraph becomes `Alert`;
every "Loading…" paragraph becomes a `Skeleton`; status colours use the semantic tokens; `title`
tooltips on disabled controls become `Tooltip`.

- Projects: two columns above 56rem: left "Recent projects" as a list (name, folder in mono, Open
  primary, Remove ghost, the inline confirm as today), right "Create a project" form (Name, Folder
  with Browse, Classes in a textarea under `Disclosure("Edit the class list")` with the default eight
  shown as pills above it) and "Open an existing project folder". Empty recent list: `EmptyState`
  "No projects yet" pointing at the form.

- Images (Data Manager): title "Images"; the keyboard hint moves into a `Kbd` legend behind a
  keyboard icon button; FilterBar fields become `Field` + `Input`/`Select`, "Group" labelled "Flight
  or tile"; the Grid/List switch becomes `Segmented`; thumbnails get a status badge top right
  (Labeled green, Review amber, Empty neutral) and the box count bottom right on a dark gradient
  caption with the file name; the selection bar is `bg-inverse` with `reveal`; the import banner is
  an `Alert`. Import dialog and Add-to-dataset dialog move onto `Dialog` (fields on `Field`, advanced
  settings under `Disclosure`). The table view: 36px rows, muted 12px header, checkbox cell, hover
  wash, focus row with a 2px accent inset ring.

- Label (editor): toolbar and panels on `bg-side`, canvas area on `bg-canvas`; toolbar buttons are
  `Button size="sm" variant="ghost"` with icons (arrow-left, arrow-right, fit, one-to-one, undo, redo,
  keyboard); the file name and position in the middle; "Saved / Saving" as a `Pill`. Class sidebar:
  class swatch as a 10px rounded square, the hotkey as `Kbd`, active class with `bg-panel` and an
  accent left-aligned ring (not a side stripe: a full 1px accent border). Region list rows 32px: box
  number, class `Select` sm, review `Pill`, delete icon button on hover. Suggestion state pills:
  Suggestion (warn), Accepted (ok), Edited (neutral), Rejected (neutral, line-through). Pre-annotation
  status and the confidence floor stay where they are, restyled. Keyboard shortcut popover on
  `Dialog`-less popover (existing), restyled with `Kbd`.

- Review: title "Review", explanation line, the queue list uses the same thumbnails as Images, back
  link keeps the run filter.

- Datasets: list on the left (name, images, split, created, a `Pill` for "writing" or "incomplete"),
  detail on the right; the new-dataset form on `Field`s with `Disclosure` for the split options.

- Models: table (name, kind pill, base, mAP50 tabular, created), starter models as a row of three
  choices with a "Add to project" secondary button each, import weights under `Disclosure`. Model
  detail: artifacts with a "Show in folder" button (kept as-is functionally), export buttons secondary.

- Train: form on `Field`s in a two-column grid; Epochs, Image size, Batch, Patience, Augmentation and
  Device under `Disclosure("More options")` with the existing one-line help per field; "Start
  training" primary with a play icon; progress card: `Progress running`, loss and ETA in a muted row,
  log under `Disclosure("Show log")`. Tiny-dataset warning as `Alert warn`.

- Detect (Query): title "Detect"; source picker as a segmented "This project's model / Cloud model";
  image picker on `Field`s; tiling under `Disclosure`; "Estimate" secondary, "Run detection" primary;
  run card: `Progress running`, counts, "Review results" primary when finished, "Accept N boxes as
  labels" secondary with the existing confirmation and undo; the "0 boxes" outcome as `Alert warn`.
  Run history as a table.

- Project settings and App settings: sections as titled blocks with a 1px line between, not cards;
  the provider cards become rows (name, key status pill, Test, Remove); the classes editor rows use
  `Input` sm and a colour swatch.

- Jobs drawer: cards become rows (type icon, name, state pill, progress, elapsed, Cancel / Show log).

- Splash: `bg-ground`, the mark, "Starting the backend" and a thin indeterminate `Progress`.

- Error boundary: `Alert danger` with the log path and a "Restart" primary button.

## 5. Motion

As in `DESIGN.md`. In code: `transition-colors duration-140 ease-out` on hover states,
`active:scale-[.97]` on buttons and checkboxes, `animate-reveal` on things that appear (selection bar,
alerts, toasts, the next-step banner when its text changes), `animate-pop` on dialogs, `animate-shimmer`
on running progress and skeletons, `animate-pulse-dot` on the live dot. `motion-reduce:animate-none`
and `motion-reduce:transition-none` everywhere a transform moves. Nothing in the editor animates on a
hotkey; region list rows and class rows have no enter animation.

## 6. Testing and verification

- Unit: a test per `ui` component with behaviour (Button loading disables and keeps the label; Dialog
  closes on Escape and returns focus; Toaster shows, dismisses, caps at three; Switch toggles with
  Space; Disclosure hides content until opened; Tooltip appears on focus). `pipeline.test.ts` covers
  step states for every progress shape. `useProjectProgress` and the Home screen tested with the
  existing fixture pattern (`src/test/fixtures.ts`, `renderWithProviders`). `LabelResolverScreen`
  tested for the three outcomes.
- Existing unit tests: updated where labels changed (Data Manager to Images, Query to Detect, Editor
  to Label, Settings to Project settings, Promote to Accept as labels, proposal to suggestion). No
  test is deleted.
- e2e: updated for the same label changes; `boot.spec.ts` gains "the sidebar shows the pipeline with
  Images done after an import" and "Label opens the first unlabeled image". All 48 stay green.
- Lint: `pnpm lint` plus a script `scripts/check-tokens.mjs` that fails when `src/` contains a
  `slate-`, `orange-`, `emerald-`, `amber-`, `red-`, `sky-` Tailwind class outside `src/ui/tokens.ts`.
- Visual verification: the app on the mock server, one screenshot per screen saved to
  `docs/evidence/ui/2026-09-19-site-office/`, reviewed against this spec; then the packaged flow
  (import, label, dataset, train 1 epoch, detect, review) on the real backend by the existing
  walk-through driver with its text selectors updated.

## 7. Risks and decisions

- The G2 results-export worktree (`g2-results-export`) changes TrainForm, ProvidersSection,
  SourcesSection and the navigation store. This work restyles the same files; the later of the two
  merges resolves conflicts, which are class-string conflicts and a few new elements. Decision: build
  on `ui-site-office` from `wave1-s2-trial` now and resolve at merge time rather than wait.
- Renaming screens changes test selectors in unit and e2e tests and in the walk-through driver. Done
  in the same commit as each rename.
- The Label resolver adds one request when the sidebar entry is used; the editor itself is unchanged.
