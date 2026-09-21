# Contour UI redesign

## Decision and scope

The operator selected Contour on September 21 after comparing three interactive visual directions.
Apply the selected charcoal/amber language to the real Kestrel application. This selection authorizes
implementation of the presented visual direction. Keep the actual workflows, contracts, and persisted
project state. The standalone concept is a visual reference, not production logic or sample data to copy.

Reference: C:/Users/D/.codex/visualizations/2026/09/21/01a0c43b-ec9a-7c83-ae7c-56d9b4b3bbe4/kestrel-directions/
(contour-review.png, contour-home.png, app.js, styles.css). Inspect the two PNGs before implementation.

## Visual system

- Ground #1d2322; sidebar #191f1d; panel #262d2b; well #303936; canvas #151b19.
- Ink #edf0e9; muted #a3aea6; dim #738078; line #38423e; strong line #56645c.
- Accent #e5af64; accent hover #efbf7b; accent foreground #29241b.
- Accent soft #373226; accent ink #edc991; accent line #665236.
- Semantic success, warning and error palettes must have legible text against dark surfaces. Target
  4.5:1 for body/control text; 3:1 for essential control boundaries/focus. Stored box class colors stay
  unchanged. Photography overlays may keep dedicated light-on-dark text.
- Use existing Instrument Sans and shared ui primitives. Body/control labels 13–14px, secondary
  metadata 11–12px, section headings 16–18px, page headings 24–28px. No decorative display font.
- Corners 7px controls / 10px panels; fine separators. Use spacing and hierarchy rather than nested
  cards. Shadows belong to floating surfaces. Update DESIGN.md and PRODUCT.md to reflect the selected
  Contour direction without changing audience, task language, or data promises.
- Hover and press 140ms, reveals 180ms, drawers 220ms, ease cubic-bezier(.23,1,.32,1).
  Animate transform/opacity; no new layout-property animations. Reduced motion removes movement.
  Keep class/region keyboard selection immediate. No decorative loops.

## Shell

Default to an approximately 82px navigation rail in an open project, with icons and readable short
labels. Supply an explicit expand/collapse control; expanded navigation shows full labels, counts,
and project name. Keep every route reachable, locked step explanations, visible active state and
aria-current semantics. Projects/App settings/Project settings remain discoverable. Keep long project
names from widening the shell. Header identifies the project and screen and retains Jobs.
No animated rail-width changes. At small window widths keep essential navigation and content usable.

## Editor

Replace simultaneous left class sidebar and right region sidebar with one right inspector, roughly
300–320px wide, preserving canvas-space gains from the compact shell. Keep a visibly labeled active
class chooser available without searching, plus access to all class counts/hotkeys. Regions and
review decisions remain accessible in the same inspector, using a disclosure/tab only when it
improves space. Show chosen class even when its full list is folded.

Move review/accept/reject/confidence controls into the contextual inspector when useful to remove
toolbar wrapping; preserve every existing operation, save/error/empty state, previous/next navigation,
zoom/fit, undo/redo, no-machinery toggle, help shortcuts, selected/hover box synchronization, class
hotkeys, rotation and middle-button pan. Do not change shortcut meanings: A/R currently apply to
visible suggestions as implemented. Do not copy the concept's different selected-only semantics.
At 1024x768 the main editor canvas must remain usefully visible; at very small widths prefer a
stacked/scrollable inspector over inaccessible controls. Empty and loading layouts match final chrome.

## Home and image browsing

Make Home's current next action the main focal point with a real image preview when one is available.
Keep actual nextStep logic, project folder access, progress totals, active jobs, errors and empty state.
Use recent image previews from a single existing list request with limit=3 and no cursor traversal.
Thumbnail failure/absence must not break project Home; provide a quiet fallback. No fake photographs,
flight aggregates, metrics, progress, confidence, or marketing copy in production.

Polish Images around the real list: quieter filters, clear hierarchy, thumbnails and filenames separated
where helpful, deliberate hover/selection/focus, accessible bulk actions and retained virtualization.
Preserve filter behavior, list/grid toggle, pagination, import and dataset actions. Avoid introducing
new query semantics merely to match the mockup. All other screens inherit the shared theme and receive
only needed spacing/contrast fixes, not unrelated workflow rewrites.

## Budget

Training, inference, import and export remain existing background jobs with progress. No new background
job type, API endpoint, dataset traversal, or whole-image-set read. Home reads at most three metadata
records and three thumbnail URLs; no automatic next-page fetch. Existing editor display image bounds
and virtualized/paginated image lists remain unchanged. Add no UI runtime dependency.

## Execution DAG

Context and approved direction → implementation brief → production UI + focused tests → browser
verification and task review → fixes → full repository gate → final branch review → merge and cleanup.
Independent batch: the implementation worker edits application files while the controller prepares
isolated browser fixtures/evidence and checks backend/contract baselines. Only one implementation
worker edits the shared checkout at a time. Critical path: UI implementation → regression tests →
visual review → complete gate → final integration.

## Acceptance

1. Application uses Contour on all routes, including readable forms/dialogs/jobs and semantic statuses.
2. Compact/expanded navigation preserves route access, active/locked states and keyboard usability.
3. Editor uses a single inspector and all prior labeling behavior remains available.
4. Home uses real bounded imagery gracefully; empty projects still have a clear next action.
5. Interactions and reduced motion work; verify at desktop and laptop widths with real DOM rendering.
6. Focused tests and required full gate pass. Capture Home, Images, Editor, Train, Review, settings
   and Jobs evidence. Run cargo tests only if frozen sidecar exists.
7. Merge to main, remove worktree/branch, record wrapup and give an operator walkthrough. Do not
   rebuild/install the desktop binary unless separately requested; the source/dev UI is the deliverable.
