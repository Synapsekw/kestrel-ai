# Contour UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Apply the selected Contour experience to the actual application while preserving its workflows.

**Architecture:** Re-theme shared semantic tokens and primitives, adapt the shell to compact navigation,
and consolidate editor chrome into one inspector. Add a bounded real-image resume view to Home.

**Tech Stack:** Existing React 18, TypeScript, Tailwind 3, Zustand, Konva, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-09-21-contour-ui-design.md

## Global Constraints

- No backend/contract behavior changes, new UI runtime dependencies, or fictional production data.
- Training, inference, import and export remain existing background jobs with progress.
- Home reads at most three metadata records, one existing display URL capped at 1024px, and two thumbnail URLs; no automatic next-page fetch.
- Existing editor display image bounds and virtualized/paginated image lists remain unchanged.
- Stored box class colors stay unchanged. Keep existing shortcut meanings, rotation, and middle-button pan.
- Work only in .claude/worktrees/contour-ui on task/contour-ui; stage explicit paths.
- Ground #1d2322; sidebar #191f1d; panel #262d2b; well #303936; canvas #151b19.
- Ink #edf0e9; muted #a3aea6; dim #738078; line #38423e; strong line #56645c.
- Accent #e5af64; accent hover #efbf7b; accent foreground #29241b.
- Accent soft #373226; accent ink #edc991; accent line #665236.
- Hover and press 140ms, reveals 180ms, drawers 220ms, ease cubic-bezier(.23,1,.32,1).

## Budget and DAG

Spec Budget and Execution DAG are binding. Production implementation and browser-fixture preparation
can overlap without shared files. Reviews/fixes/gate/integration are sequential. No whole-dataset work.

### Task 1: Apply Contour to the real UI

**Files:** frontend/src/index.css, frontend/tailwind.config.ts, frontend/src/ui/* (contrast/state
adjustments only), frontend/src/app/{Brand,Sidebar,Header,Shell,NextStepBar}.tsx and related tests;
frontend/src/screens/{HomeScreen,EditorScreen,DataManagerScreen}.tsx and related tests;
frontend/src/editor/{ClassSidebar,RegionList,EditorToolbar}.tsx and tests; new
frontend/src/editor/EditorInspector.tsx and its test if extracted;
frontend/src/data/{ImageGrid,FilterBar,SelectionBar}.tsx as needed; DESIGN.md, PRODUCT.md.
New Home helper/test may be placed in frontend/src/app/ for the bounded metadata request.

**Interfaces:** Preserve existing router paths, store/actions/types and ui component APIs. Add
accent-fg as a semantic Tailwind token for amber fills. A navigation toggle is a labeled button with
aria-expanded. Inspector is a named region whose controls use existing handlers. Home's list helper
uses the existing list contract with limit=3 and never follows next_cursor.

- [x] Write focused behavioral tests before implementation. New navigation test expands/collapses
  while all routes and locked explanations remain accessible. Inspector test changes active class and
  invokes existing decision callbacks while the class list is folded. Home test asserts outgoing
  limit=3 and successful next-action rendering when preview fetch fails. Preserve relevant regressions.
- [x] Run new tests red and report exact failures. Existing helpers renderWithProviders/fakeClient
  support request routing; inspect their APIs rather than adding production test hooks.
- [x] Implement the spec. For the bounded fetch use the real contract API:
  `api.GET("/api/v1/projects/{projectId}/images", {params:{path:{projectId},query:{limit:3}}})`.
  Confirm the source-defined endpoint and response type before using this sketch.
- [x] Check amber-filled text/checkmarks across Button, Checkbox, Switch, Brand, Pills and steps.
  Add contrast checks that read actual palette definitions and fail on unreadable role pairs.
- [x] Run focused tests green, frontend lint and build. Inspect the diff for regressions, keep
  existing tests meaningful, and update stale assertions only where the selected design changes them.
- [x] Commit explicit task paths and write an implementer report with changes, test commands/results,
  red evidence, issues and any deviations. Do not run the whole backend gate concurrently.

### Task 2: Verify, review, and integrate

**Files:** frontend/e2e/contour.spec.ts if meaningful regression coverage is needed; docs/evidence/ui/
2026-09-21-contour/ screenshots and verification notes; docs/progress.md; vault session/homepage at end.

**Interfaces:** Task 1 production routes and controls; existing Prism/mock test setup. No changing
production logic to make fixture screenshots work.

- [x] Prepare browser fixtures outside production src. Use project-shaped sample data, local preview
  images, and explicit limits. Serve on unique loopback ports so no other task's app is tested.
- [x] Inspect actual rendered Home, Images, Label, Train, Review, settings, and Jobs; exercise nav toggle,
  inspector controls, accept/undo, class selection, image filters, responsive widths, reduced motion.
- [x] Dispatch a task reviewer with spec, brief, implementer report and full task diff; resolve findings.
- [x] Run the required gate once serially: contract check; ruff; pytest; frontend lint/test/build;
  conditional cargo test. Capture evidence, investigate failures, rerun only affected checks after fixes.
- [ ] Dispatch a final branch reviewer with the entire diff and test evidence, resolve any real findings.
- [ ] Commit docs/evidence by exact paths, rebase onto main if needed, merge only the tested state,
  remove this worktree and branch with verified path/junction handling, then execute /wrapup.
- [ ] Report the delivered design and numbered operator walkthrough. Clarify installer unchanged.
