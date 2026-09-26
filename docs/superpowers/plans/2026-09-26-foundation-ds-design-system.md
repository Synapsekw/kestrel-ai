# Foundation DS: the Aero glass design system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Worktree.** Build in `.claude/worktrees/f-ds` on branch `task/f-ds`, cut from the newest `main` with
> `scripts\start-task.ps1 f-ds` (run from `E:\Dev\Yolo\app`). Never build in the main checkout. Every
> command below runs from the worktree root `E:\Dev\Yolo\app\.claude\worktrees\f-ds` unless it says
> otherwise. The merge is `scripts\finish-task.ps1`, run from inside the worktree (Task 18).

**Goal:** Replace the Contour design system with Aero glass: the `.tD` tokens, locally bundled Space Grotesk and JetBrains Mono, motion tokens with reduced motion, the reduced-effects mode, every `frontend/src/ui/` primitive (rewritten or new), the app keymap in `ui/keymap.ts`, the `check-tokens` rules, the composited contrast test, and the `DESIGN.md` rewrite. Every existing screen keeps compiling and passing its tests.

**Architecture:** Tokens live as CSS custom properties in `frontend/src/index.css` (opaque colours as RGB triplets, translucent surfaces as complete `rgba()` values) and are exposed through `frontend/tailwind.config.ts`. Component CSS that utilities cannot express (glass, shimmer, stagger, draw-in) lives in `frontend/src/ui/ui.css`, the one place `check-tokens` allows `backdrop-filter`. Motion is CSS-first (`--dur-*`, `--ease-*`), mirrored in `ui/motion.ts` for JavaScript animation, and zeroed by `prefers-reduced-motion` or `<html data-motion="reduced">`; effects are switched by `<html data-effects="full|reduced">` from `app/effects.ts`. Each primitive has vitest tests and a section in a dev-only gallery page (`frontend/gallery.html`), screenshotted by `frontend/scripts/gallery-shots.mjs` for the visual check.

**Tech Stack:** React 18.3, TypeScript 5.9 (strict, `noUnusedLocals`), Tailwind CSS 3.4, Vite 6, vitest 3 with Testing Library and jsdom 30, react-router-dom 6.30, zustand 5, `@fontsource-variable/space-grotesk` and `@fontsource-variable/jetbrains-mono` (new), Playwright 1.63 (already installed, used by the gallery screenshot script), eslint 9 with `eslint-plugin-react-hooks` 7, prettier 3 (`printWidth: 110`).

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (F), especially §4 (the design system), §5.6 (the keymap), §16 (testing) and §18 (unit DS). The umbrella `docs/superpowers/specs/2026-09-26-inspection-platform-design.md` (D9, §8, §10 items 1, 11, 13, 14, 16, 17) is binding. The visual target is the approved mockup `.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html` (tab D, theme `.tD`) and `ws-images.html`, `ws-maps.html`, `ws-clouds.html` in the same folder (the `.superpowers/brainstorm/` folder is in the main checkout at `E:\Dev\Yolo\app`, untracked; open the files from there). Executors read the spec and the mockups.

## Global Constraints

- **Unit and position.** This is unit **DS** of F (spec §18). It needs no contract, but it is cut after C0 has merged (the index's "Cut after" column: so its gate runs on the new client). It runs in F's batch 2 beside BK, BC, BM and MG-framework, which are backend-only, so no other unit edits `frontend/` while DS is open. **SH starts only after DS is merged to `main`.** DS is on F's critical path (C0 → DS → SH → S1 → X). Rebase onto `main` before merging (`finish-task.ps1` does it).
- **Files DS may touch:** `frontend/src/ui/**`, `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/vite.config.ts` (one `build` key), `frontend/gallery.html` (new), `frontend/scripts/check-tokens.mjs`, `frontend/scripts/gallery-shots.mjs` (new), `frontend/src/app/effects.ts` + test (new; spec §4.3 names this path), `frontend/src/main.tsx` (the appearance call), `frontend/package.json` and `frontend/pnpm-lock.yaml` (the fonts), `DESIGN.md`, `AGENTS.md` item 3, `vault/decisions/` (one ADR), `docs/evidence/foundation-ds/`, `vault/sessions/` and `vault/00-north-star.md` (wrap-up). Outside those, DS makes **only** the mechanical edits named in Task 2 (the token rename across `frontend/src`), Task 4 (the `isTypingTarget` import path in seven files) and Task 17 (the `useVirtualRows` import path in two files). DS never edits `contract/`, `backend/`, `frontend/src/routes.tsx`, `frontend/e2e/`, or the layout of `app/Shell.tsx`, `app/Sidebar.tsx`, `app/Header.tsx` (SH rewrites those).
- **Old primitive APIs stay.** Every existing export of `frontend/src/ui/index.ts` keeps its name and props: `Alert`, `Button`, `IconButton`, `buttonClass`, `Checkbox`, `Dialog`, `Disclosure`, `EmptyState`, `Field`, `Icon`, `Input`, `Select`, `Textarea`, `fieldClass`, `Kbd`, `Pill` (tone `"inverse"` still accepted), `Progress`, `Segmented`, `Skeleton`, `SkeletonRows`, `Switch`, `Toaster`, `toast`, `dismissToast`, `useToastStore`, `Tooltip`, `claimJobOutcome`, `useJobToasts`, `jobToastText`, `reportedInline`, `cx`, `focusRing`, `pressable`, `transition`. New props are optional. The only moved names are `isTypingTarget` (`@/editor/hotkeys` → `@/ui/keymap`, Task 4) and `useVirtualRows`/`computeWindow` (`@/data/useVirtualRows` → `@/ui/useVirtualRows`, Task 17); both moves update every importer in the same commit.
- **Contour class names are migrated, not aliased**, except the radius and shadow aliases `rounded-md` → `--r-control`, `rounded-lg` → `--r-panel`, `shadow-float` → `--elev-2`, kept so SH can restyle screens without a big-bang edit. The rename map (Task 2) is: `ground` and `canvas` → `bg`, `side` → `rail`, `panel` → `surface` (`bg-panel/90` → `bg-glass`), `well` → `surface-2`, `inverse` → `tip`, `inverse-fg` → `tip-fg`, `warn-strong` → `warn`, `accent-hover` → `accent-ink`, `accent-line` → `line-strong`, `duration-140/180/220` → `duration-fast/base/slow`, `rounded-[10px]` → `rounded-control`, `rounded-[3px]`/`rounded-[4px]` → `rounded-sm`, `"Instrument Sans Variable"` → `"Space Grotesk Variable"`.
- **Token values are verbatim from spec §4.1 and §4.2.** Opaque colours are written as triplets (`--tip: 27 26 51` is `#1b1a33`, `--tip-fg: 255 255 255`, `--glass-ink: 242 241 251`, `--glass-solid: 22 23 42` is `#16172a`); translucent ones as `rgba(r, g, b, a)`. `--control-line` stays as a token (it is not in the spec's retired list) with the new value `118 116 150` (see Resolved ambiguities 7).
- **Motion rules (spec §4.2, umbrella §8).** Animate only `transform` and `opacity`. No interaction path waits for motion; nothing on it runs longer than 400 ms. Loops (live dot, shimmer, indeterminate bar) run only while real work runs. No indefinite pulse on static data. No map "scan" sweep. Durations come only from `--dur-*` (Tailwind `duration-instant|fast|base|slow|emphasis|count`), easings from `--ease-*` (`ease-out|spring|in-out`), delays from `.stagger` with `--i`.
- **Blur (spec F7).** `backdrop-filter` only in `.glass-float` (`GlassPanel variant="float"`), which `Dialog`, `Popover`, `Menu`, `CommandPalette` and `FloatingToolbar` use. Cards, panes, list panes and `DataTable` are never blurred.
- **React hooks lint (eslint-plugin-react-hooks 7, errors):** no synchronous `setState` in an effect body (set state in rAF, timer, observer or promise callbacks only); never read or write `ref.current` during render (effects and event handlers only); no impure calls (`Date.now()`, `performance.now()`, `Math.random()`) during render. Measured positions are written straight to the DOM (`el.style.transform = …`) in layout effects.
- **Browser storage.** Every `localStorage` access is wrapped in `try/catch`; a blocked store falls back to the default (`system` motion, `auto` effects).
- **Every primitive** ships vitest tests (`frontend/src/ui/*.test.ts(x)`), a gallery section (`frontend/src/ui/gallery/sections/<Name>.tsx`, heading level 3 and below inside it) and a visual check against the mockup. UI tasks load the design skills first: `impeccable` and `emil-design-eng`, together with the mockups (AGENTS.md item 3).
- **Barrel.** `frontend/src/ui/index.ts` exports are one statement per module, kept in case-insensitive alphabetical order by module path (`./tokens` stays last, as today), so two tasks' additions merge without conflict. If a conflict appears anyway, keep both statements.
- **Formatting.** `pnpm -C frontend lint` runs `prettier --check src` (CSS included). After writing or editing files, run `pnpm -C frontend format` and confirm with `git status` that it touched only your files.
- **Commits.** Stage by path, never `git add -A`, `git add .` or `git commit -a`. Run `git status` before each commit and confirm every staged path is yours. Conventional Commit subjects. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`, passed as a second `-m`.
- **The gate** (AGENTS.md §4), run in full in Task 18 and again by `scripts\finish-task.ps1`:
  ```
  pnpm -C contract check
  cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest
  pnpm -C frontend lint
  pnpm -C frontend test
  pnpm -C frontend build
  pnpm -C frontend e2e
  cargo test --manifest-path frontend/src-tauri/Cargo.toml   # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
  ```
  A worktree has no venv of its own; backend commands use the main checkout's interpreter (CONTRIBUTING.md → Testing). DS adds no Python package.

## Review Focus

The spec is silent on these inputs; each would bite the operator. Each line names the task whose tests pin it.

1. **A translucent token given an opacity modifier** (`bg-surface/80`, `border-line/50`). Tailwind cannot apply alpha to a complete `rgba()` value, so the element silently loses its background or border. Expected: `pnpm -C frontend lint` fails and names the line. Pinned in Task 2 (`check-tokens` case `translucent-modifier`); the migration strips the three existing uses and turns the three `bg-panel/90` status bars into `bg-glass`.
2. **A colour read by JavaScript after a token rename** (`tokenRgb("canvas")` sets the 3D viewer's clear colour; `tokenColour(...)` styles the OpenLayers layers). A missing or non-triplet token gives `NaN` colours and a black or grey viewer with no error. Expected: every token read from JavaScript exists as an RGB triplet. Pinned in Task 2 (`tokenReads.test.ts`).
3. **A key pressed while focus is inside a primitive that owns it** (← → on a `Slider` or `Tabs`, ↑ ↓ J K in a `DataTable`, a digit in `SeverityPicker`, a type hotkey in a `Combobox`, arrows in a `Menu` or `FloatingToolbar`) also reaching a window-level workspace shortcut: nudging a slider flips to the next image. Expected: the primitive consumes the key (`stopPropagation`). Pinned in Tasks 8, 10, 11, 12, 13, 14 and 17 (a window `keydown` spy in each).
4. **Fonts under the packaged CSP.** A `.woff2` inlined as `data:` by Vite, or fetched from Google, is blocked by `default-src 'self'`, and the app silently falls back to Segoe UI. Expected: both families ship as files in `dist/assets`; no Google URL anywhere. Pinned in Task 1 (`fonts.test.ts` and the build check in Step 9).
5. **The Auto effects probe misfires**: it runs while the window is hidden (rAF paused, huge frame gaps), during the first-load jank, or again on every launch, reducing effects wrongly and toasting at every start. Expected: a hidden window makes no decision; a 300 ms warm-up is excluded; the Auto outcome is remembered; the toast's Undo sets Full and is final. Pinned in Task 3 (`effects.test.ts`).

Further inputs pinned where they live: a palette whose `sources` array is a new object on every render (Task 15, the pending search must survive), an older search answering after a newer one (Task 15), `onEndReached` firing on every scroll event (Task 17), `NaN` in progress or trend data (Tasks 6 and 9), a finding whose severity level was removed from the scale (Task 10), and the tab indicator measured before the web font loads (Task 11).

## Resolved ambiguities and deviations (reviewers: do not flag these)

1. **Fonts.** The brief says "font files in the repo, not Google"; spec §4.1 names `@fontsource-variable/space-grotesk` and `@fontsource-variable/jetbrains-mono`. The plan follows the spec: the packages hold the `.woff2` files, Vite copies them into `dist/assets`, and nothing is fetched at runtime (the same mechanism Instrument Sans uses today). Added: `build.assetsInlineLimit` never inlines a font, because a `data:` font breaks under the CSP (Review Focus 4).
2. **`effects.ts` lives at `frontend/src/app/effects.ts`** (spec §4.3), although §18 lists DS's area as `ui/` etc. DS creates the file (SH has not started, so there is no collision). DS exposes `applyEffects`, `setEffectsChoice`, `readEffectsChoice` and `runAutoProbe`; **SH** adds the palette's "Toggle reduced effects", **S1** calls `runAutoProbe()` on the Overview's first render, **S2** builds Settings → Appearance. The Auto outcome is remembered in `localStorage` `kestrel.effects.auto` so the probe and its toast happen once; choosing Auto again in Settings clears it. The probe skips a 300 ms warm-up and makes no decision if the window is hidden.
3. **The "Reduce motion" override** is `<html data-motion="reduced">`, stored in `localStorage` `kestrel.motion` (`system` | `reduce`). Tailwind's `motion-reduce:` variant is redefined to honour it as well as the media query, so every existing `motion-reduce:*` class follows the setting. The Settings control is S2's.
4. **`useSeverityScale()`** (spec §4.4 says `SeverityPill` reads it, §7 owns the data): DS ships `ui/severityScale.ts` with a React context whose default is D4's four levels. The provider fed by `GET /catalogue/severity` is added by SH or S2 around the app; DS primitives work without it.
5. **The keymap table holds the workspace tool keys now.** §5.6 says workspaces "register their tool keys into the same table"; the collision test must walk real entries, and I, M and C are not built yet. So `ui/keymap.ts` declares `WORKSPACE_KEYS.images|maps|clouds|clouds.fly` verbatim from §5.6, and I, M and C bind handlers to those entries through `useToolShortcuts`. `useToolShortcuts` refuses, at runtime, a chord that belongs to a global or review entry unless the tool declares that entry's `action` (so a Select tool may bind V, an Area tool may not bind A). The Findings tab's J, K, Enter and Shift+O/R/C (§8.6) are focused-widget keys owned by `DataTable` and S1, not keymap entries (global Enter means "commit", and the table is focused, not a workspace). C's fly mode is its own scope, `clouds.fly`, checked against global keys only (review keys are suspended in fly mode). `StatusDot` gains an `idle` status (green) for the top bar's "idle" dot (§5.1).
6. **Combobox hotkeys** (§4.4 "catalogue type hotkeys are live inside it"): a hotkey fires only while the filter text is empty. Typing any other character starts filtering, and from then on every key filters.
7. **Contrast.** The approved mockup's white on violet (`--accent-fg` on the primary gradient) was 2.8–3.3:1, below the spec's 4.5:1. **Operator decision (2026-09-26):** darken the primary gradient so white text on the primary button reaches 4.5:1, keeping the violet→indigo look. The gradient stops become their own triplet tokens, `--primary-from: 114 88 255` (#7258ff, 4.61:1 with white) and `--primary-to: 55 102 255` (#3766ff, 4.66:1), and `--grad-primary` is built from them; the contrast test holds both to 4.5:1 with no named exception. `--accent` (#8f7bff) keeps its value for focus rings, links and fills; white on it is used only for non-text marks (the checkbox tick), held to 3:1 as a boundary. Text inputs keep the mockup's `--line` border; the 3:1 boundary check covers the focus ring (`--accent`) and the controls whose border is their only affordance (checkbox, switch track, slider track), which use `--control-line: 118 116 150`. `--accent-hover` is retired in addition to the spec's list (the primary button is a gradient now).
8. **Transform-only motion**: the sparkline draw-in grows a clip rectangle with `scaleX`, `Progress` and the slider fill move a full-width bar with `translateX`, the shimmer is a `translateX` pseudo-element, and the `Segmented` thumb slides with `translateX` while its width snaps. The `Tabs` indicator uses `translateX` + `scaleX` of a 100 px bar.
9. **The gallery.** The spec has none. DS adds a second Vite page, `frontend/gallery.html`, served by `pnpm -C frontend dev` at `http://127.0.0.1:1420/gallery.html`. It is not part of the production build and adds no route to `routes.tsx` (SH owns it). Sections are collected with `import.meta.glob` from `src/ui/gallery/sections/*.tsx`, so tasks never edit a shared gallery file. `scripts/gallery-shots.mjs` screenshots every section at full and reduced effects into `docs/evidence/foundation-ds/`.
10. **`InspectorLayout`** is split into `InspectorLayout` (the two-column grid that stacks below 1100 px), `InspectorPane` (header, scrolling staggered sections, footer) and `InspectorSection`. `Menu` gains a `MenuButton` convenience. `Tooltip` gains `side="left"`. `Pill` gains tone `info`. `Segmented` options gain an optional `count`.
11. **`check-tokens`** applies the `rgba(` rule only to lines containing `className` (Konva fills and OpenLayers styles build `rgba()` strings legitimately). The retired-name rule also catches `var(--ground)`-style references and `tokenRgb("canvas")`-style reads. A sixth rule, `translucent-modifier`, is added (Review Focus 1). The raw-palette rule keeps its old exemption (`src/ui/tokens.ts` only); every new rule exempts `src/ui/**`.
12. **Native app icons** (`icons:generate`) keep their current artwork. `DESIGN.md` records the target (the mark on `--grad-brand`); `Brand.tsx` is SH's.

## File map

**Create (all under `frontend/`):**

| File | Task | Responsibility |
| --- | --- | --- |
| `gallery.html`, `src/ui/gallery/main.tsx`, `src/ui/gallery/Gallery.tsx`, `src/ui/gallery/Gallery.test.tsx` | 1 | the dev-only primitive gallery |
| `src/ui/gallery/sections/Tokens.tsx` | 1 | swatches, type scale, radii, elevation |
| `scripts/gallery-shots.mjs` | 1 | section screenshots for the visual check |
| `src/ui/tailwind.test.ts`, `src/ui/fonts.test.ts` | 1 | the theme and the bundled fonts |
| `src/ui/checkTokens.test.ts`, `src/ui/tokenReads.test.ts` | 2 | the lint rules and JavaScript token reads |
| `src/ui/ui.css`, `src/ui/uiCss.test.ts` | 3 | glass, stagger, shimmer, indeterminate, draw-in |
| `src/ui/motion.ts`, `src/ui/motion.test.tsx` | 3 | motion tokens, `useReducedMotion`, the motion choice |
| `src/app/effects.ts`, `src/app/effects.test.ts` | 3 | reduced effects, Auto, the frame probe |
| `src/ui/GlassPanel.tsx`, `src/ui/GlassPanel.test.tsx`, `sections/Glass.tsx` | 3 | the glass surface |
| `src/ui/keymap.ts`, `src/ui/keymap.test.tsx` | 4 | the app keymap, chords, `isTypingTarget`, `useToolShortcuts` |
| `sections/Controls.tsx` | 5 | buttons, fields, pills, alerts |
| `src/ui/Feedback.test.tsx`, `sections/Feedback.tsx` | 6 | progress, skeleton, empty state, icons |
| `src/ui/useFocusTrap.ts`, `sections/Overlays.tsx` | 7 | the focus trap shared by every overlay |
| `src/ui/FloatingToolbar.tsx`, `src/ui/FloatingToolbar.test.tsx`, `sections/Toolbar.tsx` | 8 | floating tool groups |
| `src/ui/useCountUp.ts`, `src/ui/Sparkline.tsx`, `src/ui/StatTile.tsx`, `src/ui/Stats.test.tsx`, `sections/Stats.tsx` | 9 | dashboard figures |
| `src/ui/severityScale.ts`, `src/ui/Severity.tsx`, `src/ui/StatusDot.tsx`, `src/ui/TypeChip.tsx`, `src/ui/Severity.test.tsx`, `sections/Severity.tsx` | 10 | severity, status, type chips |
| `src/ui/useSlidingIndicator.ts`, `src/ui/Tabs.tsx`, `src/ui/Tabs.test.tsx`, `sections/Tabs.tsx` | 11 | tabs and the segmented thumb |
| `src/ui/floating.ts`, `src/ui/Popover.tsx`, `src/ui/Menu.tsx`, `src/ui/Popover.test.tsx`, `sections/Popover.tsx` | 12 | anchored glass panels and menus |
| `src/ui/Slider.tsx`, `src/ui/Slider.test.tsx`, `sections/Slider.tsx` | 13 | continuous and stepped sliders |
| `src/ui/listbox.ts`, `src/ui/Combobox.tsx`, `src/ui/Combobox.test.tsx`, `sections/Combobox.tsx` | 14 | the filterable picker |
| `src/ui/CommandPalette.tsx`, `src/ui/CommandPalette.test.tsx`, `sections/CommandPalette.tsx` | 15 | Ctrl K |
| `src/ui/Inspector.tsx`, `src/ui/Inspector.test.tsx`, `sections/Inspector.tsx` | 16 | the right-hand inspector |
| `src/ui/DataTable.tsx`, `src/ui/DataTable.test.tsx`, `sections/DataTable.tsx` | 17 | the virtualised table |
| `vault/decisions/2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier.md` | 2 | ADR |

(`sections/` above is `frontend/src/ui/gallery/sections/`.)

**Modify:** `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/vite.config.ts`, `frontend/src/ui/contrast.test.ts` (1); `frontend/scripts/check-tokens.mjs` and the token rename across `frontend/src` (2); `frontend/src/main.tsx` (3); `frontend/src/editor/hotkeys.ts`, `hotkeys.test.ts`, `useEditorHotkeys.ts`, `maps/MapReviewPanel.tsx`, `review/ImageReviewQueue.tsx`, `screens/CloudsScreen.tsx`, `screens/DataManagerScreen.tsx`, `screens/MapsScreen.tsx`, `volumes/VolumeToolbar.tsx` (4); `ui/tokens.ts`, `ui/Button.tsx`, `ui/Button.test.tsx`, `ui/Input.tsx`, `ui/Checkbox.tsx`, `ui/Switch.tsx`, `ui/Field.tsx`, `ui/Kbd.tsx`, `ui/Pill.tsx`, `ui/Alert.tsx`, `ui/Controls.test.tsx` (5); `ui/Progress.tsx`, `ui/Skeleton.tsx`, `ui/EmptyState.tsx`, `ui/Toaster.tsx`, `ui/Disclosure.tsx`, `ui/Icon.tsx` (6); `ui/Dialog.tsx`, `ui/Dialog.test.tsx`, `ui/Tooltip.tsx`, `ui/Tooltip.test.tsx` (7); `ui/Segmented.tsx` (11); `data/ImageGrid.tsx`, `data/ImageTable.tsx` and the move of `data/useVirtualRows.ts` + test (17); `ui/index.ts` (most tasks); `DESIGN.md`, `AGENTS.md` (18).

## Budget and execution DAG

**Budget.** DS adds no background job, no endpoint and no backend read. What it bounds on the client:

- `DataTable` renders `ceil(viewport / 44) + 8` rows whatever the row count (18 rows at jsdom's 600 px fallback), and asks for the next page at most once per page (`onEndReached`, cursor paging by the caller).
- `Sparkline` draws at most 60 finite points. `StatTile` count-up is one 600 ms rAF run per value change.
- `CommandPalette` debounces async sources by 120 ms, aborts a superseded search, and never shows results for an older query; per-source limits are the caller's (`/search?limit=8`).
- `Combobox` filters in memory over the catalogue's types (tens to hundreds of rows).
- The effects probe runs once per app session, in Auto only, for 2.3 s of rAF.
- No looping animation runs unless its work is running; reduced motion stops all of them.

**DAG** (a task starts when its dependencies are committed on `task/f-ds`; batches may run in parallel sub-worktrees, but one executor running them in the listed order is fine):

| Task | Depends on | Batch |
| --- | --- | --- |
| 1 Tokens, fonts, Tailwind theme, contrast test, gallery scaffold | none | B1 |
| 4 Keymap, chords, `isTypingTarget`, `useToolShortcuts` | none | B1 |
| 2 `check-tokens` rules and the Contour rename | 1 | B2 |
| 3 Motion, reduced effects, `ui.css`, `GlassPanel` | 1 | B2 |
| 5 Controls (Button, fields, Checkbox, Switch, Kbd, Pill, Alert) | 2 | B3 |
| 6 Feedback (Progress, Skeleton, EmptyState, Toaster, Disclosure, Icon) | 2, 3 | B3 |
| 9 `StatTile`, `useCountUp`, `Sparkline` | 3 | B3 |
| 10 Severity, `StatusDot`, `TypeChip` | 2 | B3 |
| 11 `Tabs`, `Segmented` thumb | 2, 3 | B3 |
| 13 `Slider` | 2 | B3 |
| 16 Inspector | 3 | B3 |
| 7 `useFocusTrap`, `Dialog`, `Tooltip` shortcut | 3, 4, 5 | B4 |
| 17 `DataTable`, `useVirtualRows` move | 4, 5, 6 | B4 |
| 8 `FloatingToolbar`, `ToolButton` | 3, 4, 7 | B5 |
| 12 `Popover`, `Menu`, `MenuButton` | 3, 7 | B5 |
| 14 `Combobox` | 12 | B6 |
| 15 `CommandPalette` | 3, 7, 14 | B7 |
| 18 `DESIGN.md`, `AGENTS.md`, visual review, gate, merge | all | B8 |

**Critical path:** 1 → 2 → 5 → 7 → 12 → 14 → 15 → 18 (the overlay chain: every floating primitive needs the focus trap, which needs the restyled controls). Sequential order for one executor: 1, 4, 2, 3, 5, 6, 9, 10, 11, 13, 16, 7, 17, 8, 12, 14, 15, 18.

## Before Task 1

- [ ] **Cut the worktree** (PowerShell, from `E:\Dev\Yolo\app`):

```powershell
git -C E:\Dev\Yolo\app checkout main
git -C E:\Dev\Yolo\app pull --ff-only
.\scripts\start-task.ps1 f-ds
Set-Location E:\Dev\Yolo\app\.claude\worktrees\f-ds
git status
```

Expected: `On branch task/f-ds`, `nothing to commit, working tree clean`. `start-task.ps1` has installed the pnpm workspaces. Then `git log --oneline -10 main` shows C0's merge (`task/f-c0`); if it does not, stop: DS is cut after C0.

- [ ] **Baseline:** `pnpm -C frontend test` passes and `pnpm -C frontend lint` prints `tokens ok`. If either fails on a clean `main`, stop and report; DS must not start on a red base.

- [ ] **Load the design skills** (`impeccable`, `emil-design-eng`) and open the four mockups in a browser from `E:\Dev\Yolo\app\.superpowers\brainstorm\1481982-1790403567\content\` (tab D in `visual-directions.html`).

---

### Task 1: Tokens, bundled fonts, the Tailwind theme, the contrast test and the gallery scaffold

**Files:**
- Modify: `frontend/package.json`, `frontend/pnpm-lock.yaml` (through `pnpm add/remove`)
- Modify: `frontend/src/index.css` (rewrite)
- Modify: `frontend/tailwind.config.ts` (rewrite)
- Modify: `frontend/vite.config.ts` (add `build.assetsInlineLimit`)
- Modify: `frontend/src/ui/contrast.test.ts` (rewrite)
- Create: `frontend/src/ui/tailwind.test.ts`, `frontend/src/ui/fonts.test.ts`
- Create: `frontend/gallery.html`, `frontend/src/ui/gallery/main.tsx`, `frontend/src/ui/gallery/Gallery.tsx`, `frontend/src/ui/gallery/Gallery.test.tsx`, `frontend/src/ui/gallery/sections/Tokens.tsx`
- Create: `frontend/scripts/gallery-shots.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--backdrop --bg --surface --surface-2 --field --hover --rail --glass --glass-line --glass-ink --glass-solid --line --line-strong --card-line --control-line --ink --muted --dim --accent --accent-ink --accent-fg --accent-soft --primary-from --primary-to --ok --ok-soft --danger --danger-soft --warn --warn-soft --info --tip --tip-fg --grad-primary --grad-brand --grad-ink --grad-ai --r-panel --r-control --r-chip --r-sm --blur-sm --blur-md --blur-lg --elev-1 --elev-2 --glow-primary`. Tailwind utilities: colours `bg text border ring fill stroke`-`bg|surface|surface-2|field|hover|rail|glass|glass-line|glass-ink|glass-solid|line|line-strong|card-line|control-line|ink|muted|dim|accent|accent-ink|accent-fg|accent-soft|ok|ok-soft|danger|danger-soft|warn|warn-soft|info|tip|tip-fg`; `bg-grad-primary|grad-brand|grad-ink|grad-ai`; `font-sans` (Space Grotesk), `font-mono` (JetBrains Mono); `text-2xs|xs|sm|base|lg|xl|kpi`; `rounded-panel|control|chip|sm` (+ aliases `md`, `lg`); `shadow-elev-1|elev-2|glow|float`; `duration-instant|fast|base|slow|emphasis|count`; `ease-out|spring|in-out`; `animate-reveal|rise|fade|pop|slide-in|pulse-dot`; the `motion-reduce:` variant honouring `data-motion="reduced"`. The gallery contract: a section file `src/ui/gallery/sections/<Name>.tsx` exports `default` (a component), `title: string` and `order: number`; its anchor id is `title` lower-cased with spaces as hyphens.

- [ ] **Step 1: Swap the font packages**

```powershell
pnpm -C frontend remove @fontsource-variable/instrument-sans
pnpm -C frontend add @fontsource-variable/space-grotesk @fontsource-variable/jetbrains-mono
```

Expected: both commands end with `Done`; `frontend/package.json` `dependencies` lists `@fontsource-variable/jetbrains-mono` and `@fontsource-variable/space-grotesk` and no `instrument-sans`.

- [ ] **Step 2: Write the failing tests**

`frontend/src/ui/contrast.test.ts` (replace the whole file):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");
type Rgba = [number, number, number, number];

/** The first definition of `--name` in index.css: the base :root block, before any override. */
function token(name: string): Rgba {
  const m = css.match(new RegExp(`(?<![\\w-])--${name}:\\s*([^;]+);`));
  expect(m, `index.css has no --${name}`).not.toBeNull();
  const value = m![1].trim();
  const triplet = value.match(/^(\d+) (\d+) (\d+)$/);
  if (triplet) return [Number(triplet[1]), Number(triplet[2]), Number(triplet[3]), 1];
  const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  expect(rgba, `--${name} is neither an RGB triplet nor rgba(): ${value}`).not.toBeNull();
  return [Number(rgba![1]), Number(rgba![2]), Number(rgba![3]), Number(rgba![4])];
}

/** A translucent colour painted over an opaque one. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

/** A surface as the eye sees it: composited over the app's solid base, --bg (spec §4.5). */
const seen = (name: string) => over(token(name), token("bg"));

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT: Array<[string, string]> = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "surface-2"],
  ["ink", "field"],
  ["ink", "glass"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["muted", "field"],
  ["muted", "glass"],
  ["muted", "tip"],
  ["accent-ink", "accent-soft"],
  ["accent-ink", "surface"],
  ["ok", "ok-soft"],
  ["danger", "danger-soft"],
  ["warn", "warn-soft"],
  ["info", "surface"],
  ["tip-fg", "tip"],
  ["glass-ink", "glass-solid"],
  ["bg", "ok"],
  ["bg", "danger"],
  ["bg", "warn"],
  // White labels on the primary button, at both ends of its gradient (operator decision 2026-09-26).
  ["accent-fg", "primary-from"],
  ["accent-fg", "primary-to"],
];

const BOUNDARY: Array<[string, string]> = [
  ["accent", "bg"],
  ["accent", "surface"],
  ["accent", "field"],
  ["control-line", "bg"],
  ["control-line", "surface"],
  ["control-line", "field"],
  ["dim", "bg"],
  ["dim", "surface"],
  ["ok", "surface"],
  ["danger", "surface"],
  ["warn", "surface"],
  ["info", "surface"],
  ["accent-fg", "accent"], // the checkbox tick, a non-text mark
];

describe("Aero glass contrast, translucent surfaces composited over --bg", () => {
  it.each(TEXT)("text %s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(token(fg), seen(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BOUNDARY)("%s stays distinct on %s at 3:1", (fg, bg) => {
    expect(contrast(token(fg), seen(bg))).toBeGreaterThanOrEqual(3);
  });

  it("keeps opaque tokens as triplets and translucent ones as rgba()", () => {
    const opaque = ["bg", "ink", "muted", "dim", "accent", "accent-ink", "accent-fg", "primary-from", "primary-to", "ok", "danger", "warn"];
    for (const name of [...opaque, "info", "tip", "tip-fg", "glass-ink", "glass-solid", "control-line"]) {
      expect(token(name)[3], name).toBe(1);
    }
    const translucent = ["surface", "surface-2", "field", "hover", "rail", "glass", "glass-line", "line"];
    for (const name of [...translucent, "line-strong", "card-line", "accent-soft", "ok-soft", "danger-soft"]) {
      expect(token(name)[3], name).toBeLessThan(1);
    }
    expect(token("warn-soft")[3]).toBeLessThan(1);
  });
});
```

`frontend/src/ui/fonts.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
const vite = readFileSync("vite.config.ts", "utf8");

describe("bundled fonts", () => {
  it("imports Space Grotesk and JetBrains Mono from the installed packages and nothing from Google", () => {
    expect(css).toContain('@import "@fontsource-variable/space-grotesk";');
    expect(css).toContain('@import "@fontsource-variable/jetbrains-mono";');
    expect(css).not.toMatch(/instrument-sans|googleapis|gstatic/i);
  });

  it("depends on the two packages and no longer on Instrument Sans", () => {
    expect(pkg.dependencies).toHaveProperty("@fontsource-variable/space-grotesk");
    expect(pkg.dependencies).toHaveProperty("@fontsource-variable/jetbrains-mono");
    expect(pkg.dependencies).not.toHaveProperty("@fontsource-variable/instrument-sans");
  });

  it("never lets Vite inline a font as data: (the packaged CSP blocks data: fonts)", () => {
    expect(vite).toMatch(/assetsInlineLimit:[^\n]*woff2/);
  });
});
```

`frontend/src/ui/tailwind.test.ts`:

```ts
// @vitest-environment node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { describe, expect, it } from "vitest";

async function generate(classes: string): Promise<string> {
  // Loaded by URL so the app's tsconfig does not pull the node-side config into its program.
  const url = pathToFileURL(resolve("tailwind.config.ts")).href;
  const config = ((await import(/* @vite-ignore */ url)) as { default: Config }).default;
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }] }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("the Aero glass Tailwind theme", () => {
  it("exposes colour, gradient, radius, elevation and type tokens as utilities", async () => {
    const css = await generate(
      "bg-surface text-ink/50 rounded-panel shadow-elev-1 bg-grad-primary text-kpi font-mono ring-offset-bg",
    );
    expect(css).toContain("background-color: var(--surface)");
    expect(css).toContain("rgb(var(--ink) / 0.5)");
    expect(css).toContain("border-radius: var(--r-panel)");
    expect(css).toContain("var(--elev-1)");
    expect(css).toContain("background-image: var(--grad-primary)");
    expect(css).toMatch(/font-size: 30px;[\s\S]*letter-spacing: -0.02em/);
    expect(css).toContain("JetBrains Mono Variable");
    expect(css).toContain("--tw-ring-offset-color: rgb(var(--bg)");
  });

  it("maps durations and easings to the motion tokens", async () => {
    const css = await generate("duration-emphasis ease-out animate-rise");
    expect(css).toContain("transition-duration: var(--dur-emphasis)");
    expect(css).toContain("transition-timing-function: var(--ease-out)");
    expect(css).toContain("animation: rise var(--dur-slow) var(--ease-out) both");
  });

  it("makes motion-reduce: honour the Settings override as well as the media query", async () => {
    const css = await generate("motion-reduce:animate-none");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(':root[data-motion="reduced"] .motion-reduce\\:animate-none');
  });
});
```

`frontend/src/ui/gallery/Gallery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery";

const sectionFiles = Object.keys(import.meta.glob("./sections/*.tsx"));

describe("primitive gallery", () => {
  it("renders every section file under its own heading", () => {
    render(
      <MemoryRouter>
        <Gallery />
      </MemoryRouter>,
    );
    expect(sectionFiles.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(sectionFiles.length);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/ui/contrast.test.ts src/ui/fonts.test.ts src/ui/tailwind.test.ts src/ui/gallery`
Expected: FAIL — `index.css has no --bg`, `@fontsource-variable/space-grotesk` import missing, `background-color: var(--surface)` not found, and `Failed to resolve import "./Gallery"`.

- [ ] **Step 4: Rewrite `frontend/src/index.css`**

```css
@import "@fontsource-variable/space-grotesk";
@import "@fontsource-variable/jetbrains-mono";
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Aero glass (DESIGN.md), values from the approved mockup's theme .tD. Opaque colours are RGB
       triplets so Tailwind's opacity modifiers work; translucent surfaces are complete rgba() values
       and never take a modifier (check-tokens: translucent-modifier). */
    color-scheme: dark;
    --backdrop:
      radial-gradient(1200px 600px at 80% -10%, #3b2a7a 0%, transparent 60%),
      radial-gradient(900px 500px at -10% 110%, #0f5b66 0%, transparent 55%), #0e0f1c;
    --bg: 14 15 28;
    --surface: rgba(255, 255, 255, 0.055);
    --surface-2: rgba(255, 255, 255, 0.08);
    --field: rgba(255, 255, 255, 0.06);
    --hover: rgba(255, 255, 255, 0.05);
    --rail: rgba(255, 255, 255, 0.03);
    --glass: rgba(14, 15, 28, 0.55);
    --glass-line: rgba(255, 255, 255, 0.14);
    --glass-ink: 242 241 251;
    --glass-solid: 22 23 42;
    --line: rgba(255, 255, 255, 0.08);
    --line-strong: rgba(255, 255, 255, 0.2);
    --card-line: rgba(255, 255, 255, 0.09);
    --control-line: 118 116 150;
    --ink: 242 241 251;
    --muted: 167 166 196;
    --dim: 110 109 142;
    --accent: 143 123 255;
    --accent-ink: 201 191 255;
    --accent-fg: 255 255 255;
    --accent-soft: rgba(143, 123, 255, 0.18);
    --ok: 95 227 192;
    --ok-soft: rgba(95, 227, 192, 0.18);
    --danger: 255 138 160;
    --danger-soft: rgba(255, 138, 160, 0.15);
    --warn: 255 196 107;
    --warn-soft: rgba(255, 196, 107, 0.15);
    --info: 138 164 255;
    --tip: 27 26 51;
    --tip-fg: 255 255 255;

    /* The primary button's gradient stops, darkened from the mockup's #9d8bff → #6a8dff so white
       labels reach 4.5:1 (operator decision 2026-09-26); still violet → indigo. */
    --primary-from: 114 88 255;
    --primary-to: 55 102 255;
    --grad-primary: linear-gradient(135deg, rgb(var(--primary-from)), rgb(var(--primary-to)));
    --grad-brand: linear-gradient(135deg, #9d8bff, #5fe3c0);
    --grad-ink: linear-gradient(90deg, #9d8bff, #5fe3c0);
    --grad-ai: linear-gradient(135deg, rgba(143, 123, 255, 0.16), rgba(95, 227, 192, 0.08));

    --r-panel: 16px;
    --r-control: 10px;
    --r-chip: 999px;
    --r-sm: 6px;

    --blur-sm: 8px;
    --blur-md: 12px;
    --blur-lg: 18px;

    --elev-1: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 10px 30px rgba(0, 0, 0, 0.25);
    --elev-2: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 20px 50px rgba(20, 10, 60, 0.5);
    --glow-primary: 0 8px 26px rgba(143, 123, 255, 0.45);
  }

  html,
  body,
  #root,
  #gallery {
    @apply h-full;
  }

  body {
    @apply font-sans text-sm text-ink antialiased;
    /* Painted once and fixed: scrolling never repaints the gradient. */
    background: var(--backdrop);
    background-attachment: fixed;
  }

  h1 {
    @apply text-xl;
  }

  code,
  kbd,
  samp {
    @apply font-mono;
  }

  ::selection {
    @apply bg-accent-soft text-accent-ink;
  }

  /* Native form controls that are not wrapped by a ui component (date inputs, colour pickers). */
  input[type="date"]::-webkit-calendar-picker-indicator {
    opacity: 0.6;
  }
}
```

- [ ] **Step 5: Rewrite `frontend/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/** An opaque token from `src/index.css`, with Tailwind's opacity modifier support. */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
/** A translucent token: a complete rgba() value. It takes no opacity modifier (check-tokens). */
const raw = (name: string) => `var(--${name})`;

export default {
  content: ["./index.html", "./gallery.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: raw("surface"),
        "surface-2": raw("surface-2"),
        field: raw("field"),
        hover: raw("hover"),
        rail: raw("rail"),
        glass: raw("glass"),
        "glass-line": raw("glass-line"),
        "glass-ink": rgb("glass-ink"),
        "glass-solid": rgb("glass-solid"),
        line: raw("line"),
        "line-strong": raw("line-strong"),
        "card-line": raw("card-line"),
        "control-line": rgb("control-line"),
        ink: rgb("ink"),
        muted: rgb("muted"),
        dim: rgb("dim"),
        accent: rgb("accent"),
        "accent-ink": rgb("accent-ink"),
        "accent-fg": rgb("accent-fg"),
        "accent-soft": raw("accent-soft"),
        ok: rgb("ok"),
        "ok-soft": raw("ok-soft"),
        danger: rgb("danger"),
        "danger-soft": raw("danger-soft"),
        warn: rgb("warn"),
        "warn-soft": raw("warn-soft"),
        info: rgb("info"),
        tip: rgb("tip"),
        "tip-fg": rgb("tip-fg"),
      },
      backgroundImage: {
        "grad-primary": "var(--grad-primary)",
        "grad-brand": "var(--grad-brand)",
        "grad-ink": "var(--grad-ink)",
        "grad-ai": "var(--grad-ai)",
      },
      fontFamily: {
        sans: ['"Space Grotesk Variable"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px", fontWeight: "500" }],
        xs: ["11.5px", { lineHeight: "16px", fontWeight: "500" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["13.5px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "22px", fontWeight: "600" }],
        xl: ["20px", { lineHeight: "26px", fontWeight: "600" }],
        kpi: ["30px", { lineHeight: "33px", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      borderRadius: {
        panel: "var(--r-panel)",
        control: "var(--r-control)",
        chip: "var(--r-chip)",
        sm: "var(--r-sm)",
        // Contour aliases, kept so screens compile until SH restyles them.
        md: "var(--r-control)",
        lg: "var(--r-panel)",
      },
      boxShadow: {
        "elev-1": "var(--elev-1)",
        "elev-2": "var(--elev-2)",
        glow: "var(--glow-primary)",
        // Contour alias for floating surfaces.
        float: "var(--elev-2)",
      },
      transitionDuration: {
        instant: "var(--dur-instant)",
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        emphasis: "var(--dur-emphasis)",
        count: "var(--dur-count)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
        "in-out": "var(--ease-in-out)",
      },
      keyframes: {
        reveal: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: {
          from: { opacity: "0", transform: "scale(.97)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "none" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".3" },
        },
      },
      animation: {
        reveal: "reveal var(--dur-base) var(--ease-out) both",
        rise: "rise var(--dur-slow) var(--ease-out) both",
        fade: "fade var(--dur-base) var(--ease-in-out) both",
        pop: "pop var(--dur-slow) var(--ease-out) both",
        "slide-in": "slide-in var(--dur-slow) var(--ease-out) both",
        // A loop: only on something that is running (StatusDot live, Pill live).
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      // The Settings "Reduce motion" override (<html data-motion="reduced">) joins the media query,
      // so every existing motion-reduce: class honours both (spec §4.2).
      addVariant("motion-reduce", [
        "@media (prefers-reduced-motion: reduce)",
        ':root[data-motion="reduced"] &',
      ]);
    }),
  ],
} satisfies Config;
```

If the third `tailwind.test.ts` case fails because Tailwind keeps its core `motion-reduce` definition, do not work around it in callers: register the variant under the name `motion-reduce` from a `plugins` entry placed **before** any other plugin and re-run; if it still fails, stop and report (the whole reduced-motion override depends on it).

- [ ] **Step 6: Keep fonts out of `data:` URLs** — in `frontend/vite.config.ts`, add a `build` key after `envPrefix`:

```ts
  envPrefix: ["VITE_", "APP_"],
  // Fonts ship as files: the packaged CSP (default-src 'self') blocks data: fonts.
  build: {
    assetsInlineLimit: (file: string) => (file.endsWith(".woff2") || file.endsWith(".woff") ? false : undefined),
  },
```

- [ ] **Step 7: Create the gallery**

`frontend/gallery.html`:

```html
<!doctype html>
<html lang="en" class="h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kestrel AI · primitives</title>
  </head>
  <body class="h-full">
    <div id="gallery" class="h-full overflow-auto"></div>
    <script type="module" src="/src/ui/gallery/main.tsx"></script>
  </body>
</html>
```

`frontend/src/ui/gallery/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import { Gallery } from "./Gallery";

// Dev-only page (not in the production build): http://127.0.0.1:1420/gallery.html
// ?effects=reduced and ?motion=reduced preview the two modes without touching saved settings.
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.effects = params.get("effects") === "reduced" ? "reduced" : "full";
if (params.get("motion") === "reduced") document.documentElement.dataset.motion = "reduced";

const root = document.getElementById("gallery");
if (!root) throw new Error("#gallery is missing from gallery.html");

createRoot(root).render(
  <StrictMode>
    <MemoryRouter>
      <Gallery />
    </MemoryRouter>
  </StrictMode>,
);
```

`frontend/src/ui/gallery/Gallery.tsx`:

```tsx
import type { ComponentType } from "react";

interface SectionModule {
  default: ComponentType;
  title: string;
  order: number;
}

// Each primitive task adds one file to ./sections; nothing else in the gallery changes.
const modules = import.meta.glob<SectionModule>("./sections/*.tsx", { eager: true });
const sections = Object.values(modules).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const slug = (title: string) => title.toLowerCase().replace(/\s+/g, "-");

/** Every ui/ primitive in one scrolling page, for the visual check against the mockups. */
export function Gallery() {
  return (
    <div className="mx-auto max-w-6xl px-8 pb-24 pt-6 text-ink">
      <h1>Kestrel primitives</h1>
      <nav aria-label="Sections" className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {sections.map((s) => (
          <a key={s.title} href={`#${slug(s.title)}`} className="text-sm text-accent-ink hover:underline">
            {s.title}
          </a>
        ))}
      </nav>
      {sections.map(({ title, default: Section }) => (
        <section key={title} id={slug(title)} aria-labelledby={`${slug(title)}-h`} className="mt-12">
          <h2 id={`${slug(title)}-h`} className="text-lg">
            {title}
          </h2>
          <div className="mt-4">
            <Section />
          </div>
        </section>
      ))}
    </div>
  );
}
```

`frontend/src/ui/gallery/sections/Tokens.tsx`:

```tsx
export const title = "Tokens";
export const order = 0;

const OPAQUE = ["bg", "ink", "muted", "dim", "accent", "accent-ink", "ok", "danger", "warn", "info", "tip"];
const TRANSLUCENT = ["surface", "surface-2", "field", "hover", "rail", "glass", "line", "line-strong"];
const TINTS = ["card-line", "accent-soft", "ok-soft", "danger-soft", "warn-soft", "control-line"];
const GRADIENTS = ["grad-primary", "grad-brand", "grad-ink", "grad-ai"];
const RADII: Array<[string, string]> = [
  ["panel 16", "rounded-panel"],
  ["control 10", "rounded-control"],
  ["chip", "rounded-chip"],
  ["sm 6", "rounded-sm"],
];

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-10 w-16 shrink-0 rounded-sm border border-line" style={{ background: value }} />
      <code className="text-2xs text-muted">--{name}</code>
    </div>
  );
}

/** `--control-line` is a triplet; every other name in TRANSLUCENT and TINTS is a complete rgba(). */
const swatchValue = (n: string) => (n === "control-line" ? `rgb(var(--${n}))` : `var(--${n})`);

export default function TokensSection() {
  return (
    <div className="grid gap-8">
      <div className="grid grid-cols-4 gap-3">
        {OPAQUE.map((n) => (
          <Swatch key={n} name={n} value={`rgb(var(--${n}))`} />
        ))}
        {[...TRANSLUCENT, ...TINTS].map((n) => (
          <Swatch key={n} name={n} value={swatchValue(n)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {GRADIENTS.map((n) => (
          <Swatch key={n} name={n} value={`var(--${n})`} />
        ))}
      </div>
      <div className="grid gap-2">
        <p className="text-kpi tabular-nums">1,284</p>
        <p className="text-xl">Page title · text-xl</p>
        <p className="text-lg">Card title · text-lg</p>
        <p className="text-base">Form text · text-base</p>
        <p className="text-sm">Body and table rows · text-sm</p>
        <p className="text-xs text-muted">Label · text-xs</p>
        <p className="text-2xs text-muted">Meta · text-2xs</p>
        <p className="font-mono text-sm tabular-nums">F-0217 · 51.49780, -0.13570 · DJI_0412.JPG</p>
      </div>
      <div className="flex flex-wrap gap-4">
        {RADII.map(([name, cls]) => (
          <div
            key={name}
            className={`grid h-16 w-28 place-items-center border border-card-line bg-surface text-2xs text-muted ${cls}`}
          >
            {name}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="grid h-20 w-44 place-items-center rounded-panel bg-surface text-2xs shadow-elev-1">
          elev-1
        </div>
        <div className="grid h-20 w-44 place-items-center rounded-panel bg-surface text-2xs shadow-elev-2">
          elev-2
        </div>
        <div className="grid h-10 w-44 place-items-center rounded-control bg-grad-primary text-sm font-semibold shadow-glow">
          glow-primary
        </div>
      </div>
    </div>
  );
}
```

`frontend/scripts/gallery-shots.mjs`:

```js
// Screenshots every gallery section at full and reduced effects for the visual check (DS plan).
// Needs the dev server: pnpm -C frontend dev. Usage: node scripts/gallery-shots.mjs [section-id]
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.GALLERY_URL ?? "http://127.0.0.1:1420/gallery.html";
const out = fileURLToPath(new URL("../../docs/evidence/foundation-ds/", import.meta.url));
const only = process.argv[2];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
for (const effects of ["full", "reduced"]) {
  await page.goto(`${base}?effects=${effects}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  );
  console.log(`${effects}: loaded fonts ${[...new Set(fonts)].join(", ") || "(none)"}`);
  const ids = await page.$$eval("section[id]", (els) => els.map((e) => e.id));
  for (const id of ids) {
    if (only && id !== only) continue;
    const path = `${out}${id}-${effects}.png`;
    await page.locator(`#${id}`).screenshot({ path, animations: "disabled" });
    console.log(`saved ${path}`);
  }
}
await browser.close();
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/contrast.test.ts src/ui/fonts.test.ts src/ui/tailwind.test.ts src/ui/gallery`
Expected: PASS, 4 files, 0 failures (the contrast file reports 24 + 13 + 1 cases: text, boundaries, the triplet check; no exceptions).

- [ ] **Step 9: Build and confirm the fonts ship as files**

Run: `pnpm -C frontend build`
Then (PowerShell): `Get-ChildItem frontend/dist/assets -Filter *.woff2 | Where-Object Name -match 'space-grotesk|jetbrains-mono' | Measure-Object | Select-Object -ExpandProperty Count`
Expected: a number ≥ 2.
Then: `Select-String -Path frontend/dist/assets/*.css -Pattern 'data:font' | Measure-Object | Select-Object -ExpandProperty Count`
Expected: `0`.

- [ ] **Step 10: Run the whole frontend suite and lint**

Run: `pnpm -C frontend test` then `pnpm -C frontend lint`
Expected: all tests pass; lint prints `tokens ok` (the old raw-palette rule is still the only rule). Screens look unstyled in places until Task 2 renames the Contour classes; that is expected and invisible to tests.

- [ ] **Step 11: Visual check**

Start `pnpm -C frontend dev` in a second terminal and leave it running for all later tasks. Run `node frontend/scripts/gallery-shots.mjs tokens`. Expected output includes `loaded fonts Space Grotesk Variable, JetBrains Mono Variable` for both modes and two saved PNGs. Open `docs/evidence/foundation-ds/tokens-full.png` beside tab D of `visual-directions.html` and check: the page background is the indigo top-right / teal bottom-left gradient on `#0e0f1c`; the KPI figure is Space Grotesk 30 px semibold; the mono line is JetBrains Mono; `grad-primary` runs violet → indigo. Do not stage the PNGs yet (Task 18 stages the final set).

- [ ] **Step 12: Commit**

```powershell
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/index.css frontend/tailwind.config.ts frontend/vite.config.ts frontend/src/ui/contrast.test.ts frontend/src/ui/fonts.test.ts frontend/src/ui/tailwind.test.ts frontend/gallery.html frontend/src/ui/gallery/main.tsx frontend/src/ui/gallery/Gallery.tsx frontend/src/ui/gallery/Gallery.test.tsx frontend/src/ui/gallery/sections/Tokens.tsx frontend/scripts/gallery-shots.mjs
git status
git commit -m "feat(ui): Aero glass tokens, bundled Space Grotesk and JetBrains Mono, and the primitive gallery" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `check-tokens` rules and the Contour rename

**Files:**
- Modify: `frontend/scripts/check-tokens.mjs` (rewrite)
- Create: `frontend/src/ui/checkTokens.test.ts`, `frontend/src/ui/tokenReads.test.ts`
- Modify (mechanically, by the codemod in Step 5): every file under `frontend/src` that uses a retired Contour class or token read. Today that is about 90 files; the step lists how to review them.
- Create: `vault/decisions/2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier.md`
- Temporary, never committed: `frontend/scripts/migrate-contour-tokens.mjs`

**Interfaces:**
- Consumes: Task 1's token names.
- Produces: `node scripts/check-tokens.mjs [root]` (root defaults to `src`), exit 1 with lines `<path>:<line>: [<rule-id>] <source>  (<why>)`, rule ids `raw-palette`, `arbitrary-colour`, `rgba-in-classname`, `backdrop`, `motion`, `arbitrary-shape`, `retired-token`, `translucent-modifier`; exit 0 printing `tokens ok`. Every new rule exempts `<root>/ui/**`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/ui/checkTokens.test.ts`:

```ts
// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-tokens.mjs");
let root = "";

function check(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "check-tokens-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const FAILING: Array<[string, string, string]> = [
  ["raw-palette", "screens/A.tsx", `export const A = () => <div className="bg-slate-500" />;`],
  ["arbitrary-colour", "screens/A.tsx", `export const A = () => <div className="bg-[#ff0000]" />;`],
  ["rgba-in-classname", "screens/A.tsx", `export const A = () => <div className="[background:rgba(0,0,0,.2)]" />;`],
  ["backdrop", "screens/A.tsx", `export const A = () => <div className="backdrop-blur-md" />;`],
  ["backdrop", "screens/a.css", `.x { backdrop-filter: blur(4px); }`],
  ["motion", "screens/A.tsx", `export const A = () => <div className="transition duration-300" />;`],
  ["motion", "screens/A.tsx", `export const A = () => <div className="delay-75 ease-[cubic-bezier(0,0,1,1)]" />;`],
  ["arbitrary-shape", "screens/A.tsx", `export const A = () => <div className="rounded-[12px]" />;`],
  ["arbitrary-shape", "screens/A.tsx", `export const A = () => <div className="shadow-[0_0_4px_black] font-[600]" />;`],
  ["retired-token", "screens/A.tsx", `export const A = () => <div className="bg-panel text-inverse-fg" />;`],
  ["retired-token", "screens/a.ts", `export const clear = tokenRgb("canvas");`],
  ["retired-token", "screens/a.css", `.x { color: rgb(var(--ground)); }`],
  ["translucent-modifier", "screens/A.tsx", `export const A = () => <div className="bg-surface/80" />;`],
  ["translucent-modifier", "screens/A.tsx", `export const A = () => <div className="border-line/50" />;`],
];

describe("check-tokens", () => {
  it.each(FAILING)("fails %s in %s", (rule, file, source) => {
    const run = check({ [file]: `${source}\n` });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`[${rule}]`);
    expect(run.stderr).toContain(`${file}:1:`);
  });

  it("passes token-only code and exempts src/ui/**", () => {
    const run = check({
      "screens/Good.tsx": `export const G = () => <div className="bg-surface text-ink/60 duration-fast ease-out rounded-panel shadow-elev-1 border-line" />;\n`,
      "ui/Glass.tsx": `export const U = () => <div className="backdrop-blur-md bg-[#fff] duration-300 rounded-[3px] bg-surface/50" />;\n`,
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("tokens ok");
  });

  it("does not mistake test ids and prose that contain a retired word", () => {
    const run = check({
      "screens/Ids.tsx": `export const I = () => <div data-testid="map-panel" title="server-side" aria-label="cloud-canvas" />;\n`,
    });
    expect(run.status).toBe(0);
  });

  it("keeps the raw-palette exemption for ui/tokens.ts only", () => {
    const run = check({ "ui/Other.tsx": `export const O = () => <div className="bg-slate-500" />;\n` });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("[raw-palette]");
  });
});
```

`frontend/src/ui/tokenReads.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("tokens read from JavaScript", () => {
  it("are RGB triplets in index.css, so canvas, WebGL and OpenLayers colours never turn NaN", () => {
    const names = new Set<string>();
    for (const file of sources("src")) {
      for (const m of readFileSync(file, "utf8").matchAll(/token(?:Rgb|Colour)\(\s*["']([a-z-]+)["']/g)) {
        names.add(m[1]);
      }
    }
    // Read through variables rather than literals: CloudViewer's overlay tones, labelLayers' MATCH_TOKEN.
    for (const name of ["accent", "ok", "warn", "danger", "ink"]) names.add(name);
    expect(names.size).toBeGreaterThan(5);
    for (const name of names) {
      expect(css, `--${name}`).toMatch(new RegExp(`(?<![\\w-])--${name}:\\s*\\d+ \\d+ \\d+;`));
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/ui/checkTokens.test.ts src/ui/tokenReads.test.ts`
Expected: FAIL — the old script ignores its argument and walks the real `src`, so most `FAILING` cases exit 0; `tokenReads` fails on `--canvas` (read by `clouds/CloudViewer.tsx`) and `--inverse`.

- [ ] **Step 3: Rewrite `frontend/scripts/check-tokens.mjs`**

```js
// Fails when a source file bypasses the design system (DESIGN.md, "Aero glass").
// Usage: node scripts/check-tokens.mjs [root]   (root defaults to src)
// Every rule but raw-palette exempts <root>/ui/**, where the primitives live.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const UTIL =
  "(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|decoration|divide|placeholder|shadow|caret)";
const RETIRED = "(?:ground|side|panel|well|canvas|accent-line|accent-hover|warn-strong|inverse-fg|inverse)";
const TRANSLUCENT =
  "(?:surface-2|surface|field|hover|rail|glass-line|glass|line-strong|line|card-line|accent-soft|ok-soft|danger-soft|warn-soft)";
const inUi = (rel) => rel.startsWith("ui/");

const RULES = [
  {
    id: "raw-palette",
    why: "use a design token, not a raw Tailwind palette colour",
    re: /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|divide|placeholder|shadow|accent)-(?:slate|orange|emerald|amber|red|sky|gray|zinc|neutral|stone|green|yellow|blue|indigo|violet|purple|pink|rose|teal|cyan|lime)-\d{2,3}\b/,
    exempt: (rel) => rel === "ui/tokens.ts",
  },
  {
    id: "arbitrary-colour",
    why: "tokens only; a colour from data goes through --c on a style prop",
    re: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[(?:#|rgba?\(|hsla?\()/,
    exempt: inUi,
  },
  {
    id: "rgba-in-classname",
    why: "tokens only; no rgba() inside className",
    re: /className=.*rgba\(/,
    exempt: inUi,
  },
  {
    id: "backdrop",
    why: "blur lives in GlassPanel (spec F7)",
    re: /\bbackdrop-(?:blur|filter|saturate)|backdropFilter/,
    exempt: inUi,
  },
  {
    id: "motion",
    why: "use duration-fast|base|slow|emphasis|count, ease-out|spring|in-out and .stagger",
    re: /\b(?:duration-\d+|ease-\[|delay-\d+)/,
    exempt: inUi,
  },
  {
    id: "arbitrary-shape",
    why: "use the radius, type and elevation tokens",
    re: /\b(?:rounded(?:-[trblse]{1,2})?-\[|font-\[|shadow-\[)/,
    exempt: inUi,
  },
  {
    id: "retired-token",
    why: "a Contour token that Aero glass removed (DESIGN.md, Colour)",
    re: new RegExp(`\\b${UTIL}-${RETIRED}\\b|--${RETIRED}\\b|token(?:Rgb|Colour)\\(\\s*["']${RETIRED}["']`),
    exempt: inUi,
  },
  {
    id: "translucent-modifier",
    why: "a translucent token is a complete rgba(); Tailwind drops the class when given an opacity modifier",
    re: new RegExp(`\\b${UTIL}-${TRANSLUCENT}\\/\\d+`),
    exempt: inUi,
  },
];

const root = process.argv[2] ?? "src";
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(name)) continue;
    const rel = relative(root, path).replace(/\\/g, "/");
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.exempt(rel) || !rule.re.test(line)) continue;
          hits.push(`${rel}:${i + 1}: [${rule.id}] ${line.trim()}  (${rule.why})`);
        }
      });
  }
}

walk(root);
if (hits.length) {
  console.error(`${hits.length} design-system violations:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("tokens ok");
```

- [ ] **Step 4: Run the rule tests, then the script on the real tree**

Run: `pnpm -C frontend exec vitest run src/ui/checkTokens.test.ts`
Expected: PASS (18 cases).

Run: `node frontend/scripts/check-tokens.mjs frontend/src`
Expected: exit 1 with roughly 100 lines tagged `[retired-token]` (e.g. `app/Sidebar.tsx:165: [retired-token] … bg-side …`), a handful of `[motion]` (`duration-140` in `data/FilterBar.tsx`, `data/ImageTable.tsx`, `datasets/DatasetList.tsx`, `library/ModelTable.tsx`, `screens/ProjectsScreen.tsx`), four `[arbitrary-shape]` (`rounded-[10px]`, `rounded-[3px]`) and three `[translucent-modifier]` (`bg-line-strong/60`, `bg-accent-soft/60`, `bg-hover/5`). None under `ui/`.

- [ ] **Step 5: Run the one-off rename**

Create `frontend/scripts/migrate-contour-tokens.mjs` (it is deleted again in this step and never committed):

```js
// One-off Contour → Aero glass rename (DS Task 2). Run once over src, then delete this file.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const U = "(bg|text|border|ring-offset|ring|divide|fill|stroke)";
const REWRITES = [
  // Near-opaque status bars over the 3D viewer, the map and the surface view become glass.
  [/\bbg-panel\/\d+\b/g, "bg-glass"],
  // Translucent tokens take no opacity modifier.
  [/\b(bg|text|border)-(line-strong|hover|accent-soft)\/\d+\b/g, "$1-$2"],
  [new RegExp(`\\b${U}-inverse-fg\\b`, "g"), "$1-tip-fg"],
  [new RegExp(`\\b${U}-inverse\\b`, "g"), "$1-tip"],
  [new RegExp(`\\b${U}-(ground|canvas)\\b`, "g"), "$1-bg"],
  [new RegExp(`\\b${U}-side\\b`, "g"), "$1-rail"],
  [new RegExp(`\\b${U}-panel\\b`, "g"), "$1-surface"],
  [new RegExp(`\\b${U}-well\\b`, "g"), "$1-surface-2"],
  [new RegExp(`\\b${U}-warn-strong\\b`, "g"), "$1-warn"],
  [new RegExp(`\\b${U}-accent-hover\\b`, "g"), "$1-accent-ink"],
  [new RegExp(`\\b${U}-accent-line\\b`, "g"), "$1-line-strong"],
  [/\bduration-140\b/g, "duration-fast"],
  [/\bduration-180\b/g, "duration-base"],
  [/\bduration-220\b/g, "duration-slow"],
  [/\brounded-\[10px\]/g, "rounded-control"],
  [/\brounded-\[(?:3|4)px\]/g, "rounded-sm"],
  [/token(Rgb|Colour)\((["'])canvas\2/g, "token$1($2bg$2"],
  [/token(Rgb|Colour)\((["'])inverse-fg\2/g, "token$1($2tip-fg$2"],
  [/token(Rgb|Colour)\((["'])inverse\2/g, "token$1($2tip$2"],
  [/Instrument Sans Variable/g, "Space Grotesk Variable"],
];

let changed = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(tsx?|css)$/.test(name)) continue;
    const before = readFileSync(path, "utf8");
    const after = REWRITES.reduce((text, [re, to]) => text.replace(re, to), before);
    if (after !== before) {
      writeFileSync(path, after);
      changed += 1;
    }
  }
}
walk(process.argv[2] ?? "src");
console.log(`rewrote ${changed} files`);
```

Run, then remove it and reformat:

```powershell
node frontend/scripts/migrate-contour-tokens.mjs frontend/src
Remove-Item frontend/scripts/migrate-contour-tokens.mjs
pnpm -C frontend format
git diff --stat -- frontend/src
```

Expected: `rewrote N files` with N between 80 and 110; `git diff --stat` lists only files whose changes are class strings, token names and the two canvas font strings in `maps/runLayer.ts` and `maps/siteAreaLayer.ts`. Skim `git diff -- frontend/src` for anything that is not a class or token rename (a hit inside prose, an id, a test fixture) and revert that hunk by hand. `src/ui/**` is included on purpose: the primitives are restyled in Tasks 5 to 7, and the rename keeps them coherent until then.

- [ ] **Step 6: Run the checks to verify they pass**

Run: `node frontend/scripts/check-tokens.mjs frontend/src`
Expected: `tokens ok`.
Run: `pnpm -C frontend exec vitest run src/ui/checkTokens.test.ts src/ui/tokenReads.test.ts`
Expected: PASS.
Run: `pnpm -C frontend test` then `pnpm -C frontend lint` then `pnpm -C frontend build`
Expected: all pass (`src/app/Sidebar.test.tsx` still finds `bg-accent-soft`, which was not renamed; `src/datasets/DatasetDetail.test.tsx` still finds `.animate-shimmer`).

- [ ] **Step 7: Record the trap as an ADR**

`vault/decisions/2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier.md`:

```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, frontend, design-system]
related: ["[[2026-09-26-foundation-design]]"]
---

# 2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier

## Context

Aero glass surfaces are translucent white over an indigo backdrop. `index.css` stores them as complete
`rgba()` values (`--surface: rgba(255, 255, 255, 0.055)`) and `tailwind.config.ts` exposes them as
`var(--surface)`. Opaque colours stay RGB triplets (`--ink: 242 241 251`) exposed as
`rgb(var(--ink) / <alpha-value>)`.

Tailwind can only apply an opacity modifier to a colour it can parse or to one with `<alpha-value>`.
For `bg-surface/80` it has neither, so the class does not produce the intended colour and the element
silently loses its background. No test or type check notices; it only shows on screen.

## Decision

- `frontend/scripts/check-tokens.mjs` rule `translucent-modifier` fails `pnpm -C frontend lint` on
  `<utility>-<translucent token>/<n>` outside `src/ui/**`.
- Tokens read from JavaScript (`tokenRgb`, `tokenColour`) must be triplets; `src/ui/tokenReads.test.ts`
  checks every literal read.

## Consequences

- A translucent surface is used as is; for a stronger or weaker tint use the next token
  (`surface` → `surface-2`) or add a token.
- Renaming or re-typing a token that JavaScript reads now fails a test instead of drawing `NaN`.

## Related

- `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/scripts/check-tokens.mjs`,
  `frontend/src/ui/tokenReads.test.ts`
```

- [ ] **Step 8: Visual check**

Not a gallery change. Reload `http://127.0.0.1:1420/gallery.html#tokens` and confirm it looks as in Task 1 (the rename did not touch the gallery).

- [ ] **Step 9: Commit**

```powershell
git status
git add frontend/scripts/check-tokens.mjs frontend/src/ui/checkTokens.test.ts frontend/src/ui/tokenReads.test.ts vault/decisions/2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier.md
git add (git diff --name-only -- frontend/src)
git status
git commit -m "refactor(ui): check-tokens enforces Aero glass tokens; rename Contour classes across the app" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Confirm in the second `git status` that `frontend/scripts/migrate-contour-tokens.mjs` is absent and every staged path is a codemod file or one of the four named files.

---

### Task 3: Motion tokens, reduced motion, reduced effects, `ui.css` and `GlassPanel`

**Files:**
- Modify: `frontend/src/index.css` (the `ui.css` import, motion tokens, reduced blocks)
- Create: `frontend/src/ui/ui.css`, `frontend/src/ui/uiCss.test.ts`
- Create: `frontend/src/ui/motion.ts`, `frontend/src/ui/motion.test.tsx`
- Create: `frontend/src/app/effects.ts`, `frontend/src/app/effects.test.ts`
- Create: `frontend/src/ui/GlassPanel.tsx`, `frontend/src/ui/GlassPanel.test.tsx`
- Create: `frontend/src/ui/gallery/sections/Glass.tsx`, `frontend/src/ui/gallery/sections/Motion.tsx`
- Modify: `frontend/src/main.tsx`, `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1 tokens; `toast(tone, text, action?)` from `@/ui/toastStore`.
- Produces:
  - CSS: `--dur-instant|fast|base|slow|emphasis|count`, `--ease-out|spring|in-out`, `--stagger-step`, `--stagger-max`; classes `.glass-float`, `.stagger` (with `style={stagger(i)}`), `.animate-shimmer`, `.animate-indeterminate`, `.spark-draw`.
  - `ui/motion.ts`: `dur: {instant, fast, base, slow, emphasis, count}` (ms), `easing: {out, spring, inOut}` (control points), `staggerTokens: {step, max}`, `stagger(index: number): CSSProperties`, `cubicBezier(x1, y1, x2, y2): (x: number) => number`, `type MotionChoice = "system" | "reduce"`, `readMotionChoice(): MotionChoice`, `setMotionChoice(choice): void`, `applyMotion(choice?): void`, `isReducedMotion(): boolean`, `useReducedMotion(): boolean`.
  - `app/effects.ts`: `type Effects = "full" | "reduced"`, `type EffectsChoice = "auto" | Effects`, `FRAME_BUDGET_MS = 24`, `readEffectsChoice()`, `setEffectsChoice(choice): Effects`, `applyEffects(): Effects`, `resolveEffects(choice, autoOutcome, renderer): Effects`, `isSoftwareRenderer(name)`, `rendererName()`, `p95(samples)`, `measureFrames(durationMs?, raf?, warmupMs?)`, `runAutoProbe(measure?): Promise<Effects | null>`, `resetAutoProbe()`.
  - `ui/GlassPanel.tsx`: `GlassPanel` (forwardRef `HTMLDivElement`) with `variant?: "pane" | "float"`, `interactive?: boolean`, `radius?: "panel" | "control"`, `as?: "div" | "section" | "aside" | "nav" | "header"`, plus every `HTMLAttributes<HTMLDivElement>`; renders `data-glass={variant}`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/ui/motion.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMotion,
  cubicBezier,
  dur,
  easing,
  readMotionChoice,
  setMotionChoice,
  staggerTokens,
  useReducedMotion,
} from "./motion";

const css = readFileSync("src/index.css", "utf8");

/** The declarations of the first block after `selector`. */
function block(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `index.css has no ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({ matches, media, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

function Probe() {
  return <p>{useReducedMotion() ? "reduced" : "full"}</p>;
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  delete document.documentElement.dataset.motion;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("motion tokens", () => {
  it("mirror index.css exactly", () => {
    for (const [name, ms] of Object.entries(dur)) expect(css).toContain(`--dur-${name}: ${ms}ms;`);
    const cssName = { out: "out", spring: "spring", inOut: "in-out" } as const;
    for (const [key, points] of Object.entries(easing)) {
      expect(css).toContain(`--ease-${cssName[key as keyof typeof cssName]}: cubic-bezier(${points.join(", ")});`);
    }
    expect(css).toContain(`--stagger-step: ${staggerTokens.step}ms;`);
    expect(css).toContain(`--stagger-max: ${staggerTokens.max};`);
  });

  it.each(["@media (prefers-reduced-motion: reduce)", ':root[data-motion="reduced"]'])(
    "%s zeroes every duration but --dur-fast, and the stagger",
    (selector) => {
      const b = block(selector);
      for (const name of ["base", "slow", "emphasis", "count"]) expect(b).toContain(`--dur-${name}: 0ms;`);
      expect(b).toContain("--stagger-step: 0ms;");
      expect(b).not.toContain("--dur-fast");
    },
  );

  it("ease-out starts fast, ends at 1 and never goes back", () => {
    const f = cubicBezier(...easing.out);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(0.5)).toBeGreaterThan(0.75);
    let last = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
  });
});

describe("useReducedMotion", () => {
  it("follows the OS setting", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("follows the Settings override live", () => {
    render(<Probe />);
    expect(screen.getByText("full")).toBeInTheDocument();
    act(() => setMotionChoice("reduce"));
    expect(screen.getByText("reduced")).toBeInTheDocument();
    expect(document.documentElement.dataset.motion).toBe("reduced");
    act(() => setMotionChoice("system"));
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("applies the saved choice at start-up", () => {
    localStorage.setItem("kestrel.motion", "reduce");
    applyMotion();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("falls back to the system choice when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMotionChoice()).toBe("system");
    expect(() => setMotionChoice("reduce")).not.toThrow();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
```

`frontend/src/app/effects.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/ui/toastStore";
import {
  applyEffects,
  isSoftwareRenderer,
  measureFrames,
  p95,
  readEffectsChoice,
  resetAutoProbe,
  resolveEffects,
  runAutoProbe,
  setEffectsChoice,
} from "./effects";

const frames = (ms: number, n = 100) => Array.from({ length: n }, () => ms);

beforeEach(() => {
  // jsdom has no WebGL; without the stub it prints "Not implemented: HTMLCanvasElement.getContext".
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.effects;
  resetAutoProbe();
  useToastStore.getState().clear();
  vi.restoreAllMocks();
});

describe("resolveEffects", () => {
  it("keeps an explicit choice", () => {
    expect(resolveEffects("full", "reduced", "SwiftShader")).toBe("full");
    expect(resolveEffects("reduced", null, null)).toBe("reduced");
  });

  it("starts Auto reduced on a software renderer and full otherwise", () => {
    expect(resolveEffects("auto", null, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe(
      "reduced",
    );
    expect(resolveEffects("auto", null, "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe(
      "reduced",
    );
    expect(resolveEffects("auto", null, "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)")).toBe("full");
    expect(resolveEffects("auto", null, null)).toBe("full");
  });

  it("remembers Auto's probe outcome", () => {
    expect(resolveEffects("auto", "reduced", "NVIDIA")).toBe("reduced");
    expect(isSoftwareRenderer("swiftshader")).toBe(true);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});

describe("the saved choice", () => {
  it("defaults to Auto and marks <html>", () => {
    expect(readEffectsChoice()).toBe("auto");
    expect(applyEffects()).toBe("full");
    expect(document.documentElement.dataset.effects).toBe("full");
  });

  it("applies and stores an explicit choice", () => {
    setEffectsChoice("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("kestrel.effects")).toBe("reduced");
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readEffectsChoice()).toBe("auto");
    expect(() => setEffectsChoice("full")).not.toThrow();
  });
});

describe("the frame probe", () => {
  it("takes the 95th percentile", () => {
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([])).toBe(0);
  });

  it("measures frame gaps after the warm-up", async () => {
    let now = 0;
    const raf = (cb: (t: number) => void) => {
      now += 20;
      queueMicrotask(() => cb(now));
    };
    expect(await measureFrames(100, raf, 40)).toEqual([20, 20, 20, 20, 20]);
  });

  it("switches Auto to reduced once, remembers it, and Undo chooses Full for good", async () => {
    applyEffects();
    expect(await runAutoProbe(async () => frames(30))).toBe("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("kestrel.effects.auto")).toBe("reduced");
    const [shown] = useToastStore.getState().toasts;
    expect(shown.text).toBe("Visual effects reduced for smoother performance");
    expect(shown.action?.label).toBe("Undo");
    shown.action!.onClick();
    expect(document.documentElement.dataset.effects).toBe("full");
    expect(readEffectsChoice()).toBe("full");
    resetAutoProbe();
    const measure = vi.fn(async () => frames(30));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });

  it("keeps full effects under the budget and probes only once per session", async () => {
    applyEffects();
    expect(await runAutoProbe(async () => frames(16))).toBe("full");
    expect(await runAutoProbe(async () => frames(40))).toBeNull();
    expect(document.documentElement.dataset.effects).toBe("full");
  });

  it("makes no decision while the window is hidden", async () => {
    applyEffects();
    const visibility = vi.spyOn(Document.prototype, "visibilityState", "get").mockReturnValue("hidden");
    const measure = vi.fn(async () => frames(200));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    expect(await runAutoProbe(async () => frames(16))).toBe("full");
  });

  it("never probes when the operator chose a mode", async () => {
    setEffectsChoice("full");
    const measure = vi.fn(async () => frames(40));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });
});
```

`frontend/src/ui/GlassPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassPanel } from "./GlassPanel";

describe("GlassPanel", () => {
  it("pane is a translucent card without blur; float is the one glass surface", () => {
    render(
      <>
        <GlassPanel data-testid="pane">a</GlassPanel>
        <GlassPanel variant="float" data-testid="float">
          b
        </GlassPanel>
      </>,
    );
    const pane = screen.getByTestId("pane");
    expect(pane).toHaveAttribute("data-glass", "pane");
    expect(pane.className).toContain("bg-surface");
    expect(pane.className).toContain("rounded-panel");
    expect(pane.className).not.toContain("glass-float");
    const float = screen.getByTestId("float");
    expect(float).toHaveAttribute("data-glass", "float");
    expect(float.className).toContain("glass-float");
    expect(float.className).toContain("rounded-control");
  });

  it("interactive adds the hover lift, and radius and element are configurable", () => {
    render(
      <GlassPanel interactive radius="control" as="aside" aria-label="Inspector">
        x
      </GlassPanel>,
    );
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(aside.className).toContain("hover:-translate-y-0.5");
    expect(aside.className).toContain("rounded-control");
    expect(aside.className).not.toContain("rounded-panel");
  });
});
```

`frontend/src/ui/uiCss.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = readFileSync("src/ui/ui.css", "utf8");
const index = readFileSync("src/index.css", "utf8");

describe("ui.css", () => {
  it("is imported by index.css", () => {
    expect(index).toContain('@import "./ui/ui.css";');
  });

  it("keeps backdrop-filter inside .glass-float only (spec F7)", () => {
    const blurring = ui.split("}").filter((rule) => /backdrop-filter:\s*blur/.test(rule));
    expect(blurring).toHaveLength(1);
    expect(blurring[0]).toContain(".glass-float {");
  });

  it("drops the blur and paints glass opaque under reduced effects", () => {
    expect(ui).toMatch(
      /:root\[data-effects="reduced"\] \.glass-float \{[^}]*backdrop-filter: none;[^}]*rgb\(var\(--glass-solid\)\)/,
    );
  });

  it("flattens the backdrop to one gradient and drops the glow under reduced effects", () => {
    const reduced = index.slice(index.indexOf(':root[data-effects="reduced"]'));
    const backdrop = reduced.match(/--backdrop:([^;]*);/)![1];
    expect(backdrop.match(/radial-gradient/g)).toHaveLength(1);
    expect(reduced).toMatch(/--glow-primary: 0 0 0 transparent;/);
  });

  it("caps the stagger at --stagger-max and beats the animate-* shorthand", () => {
    expect(ui).toContain(".stagger.stagger {");
    expect(ui).toContain("min(var(--i, 0), var(--stagger-max) - 1)");
  });

  it("stops every loop under reduced motion, by media query and by the Settings override", () => {
    for (const prefix of ["", ':root[data-motion="reduced"] ']) {
      expect(ui).toContain(`${prefix}.animate-shimmer::after`);
      expect(ui).toContain(`${prefix}.animate-indeterminate`);
    }
    expect(ui).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.animate-shimmer::after/);
  });

  it("animates only transform and opacity", () => {
    const keyframes = ui.match(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g) ?? [];
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    for (const k of keyframes) {
      const props = [...k.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === "transform" || p === "opacity"), k).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/ui/motion.test.tsx src/app/effects.test.ts src/ui/GlassPanel.test.tsx src/ui/uiCss.test.ts`
Expected: FAIL — `Failed to resolve import "./motion"`, `"./effects"`, `"./GlassPanel"`, and `ENOENT … src/ui/ui.css`.

- [ ] **Step 3: Add the motion tokens and the reduced blocks to `frontend/src/index.css`**

Add the `ui.css` import after the two font imports:

```css
@import "@fontsource-variable/space-grotesk";
@import "@fontsource-variable/jetbrains-mono";
@import "./ui/ui.css";
```

Inside the `:root` block, after `--glow-primary`, add:

```css

    /* Motion (spec §4.2); ui/motion.ts mirrors these for JavaScript. */
    --dur-instant: 0ms;
    --dur-fast: 120ms;
    --dur-base: 180ms;
    --dur-slow: 260ms;
    --dur-emphasis: 350ms;
    --dur-count: 600ms;
    --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
    --ease-spring: cubic-bezier(0.3, 1.6, 0.5, 1);
    --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --stagger-step: 40ms;
    --stagger-max: 8;
```

After the `:root { … }` block (still inside `@layer base`), add:

```css
  /* Reduced motion: the OS setting or Settings → Reduce motion. Hover and colour (--dur-fast) stay. */
  @media (prefers-reduced-motion: reduce) {
    :root {
      --dur-base: 0ms;
      --dur-slow: 0ms;
      --dur-emphasis: 0ms;
      --dur-count: 0ms;
      --stagger-step: 0ms;
    }
  }

  :root[data-motion="reduced"] {
    --dur-base: 0ms;
    --dur-slow: 0ms;
    --dur-emphasis: 0ms;
    --dur-count: 0ms;
    --stagger-step: 0ms;
  }

  /* Reduced effects (spec §4.3): one static gradient, no glows. Glass is handled in ui/ui.css. */
  :root[data-effects="reduced"] {
    --backdrop: radial-gradient(1200px 600px at 80% -10%, #3b2a7a 0%, transparent 60%), #0e0f1c;
    --glow-primary: 0 0 0 transparent;
  }
```

- [ ] **Step 4: Create `frontend/src/ui/ui.css`**

```css
/* Component CSS the Tailwind utilities cannot express. src/ui/** is the one place check-tokens allows
   backdrop-filter (spec F7: blur lives in GlassPanel and Dialog). Plain rules, no @layer: Vite inlines
   this file before Tailwind runs, and utilities (emitted later) still win ties. */

/* Glass: floating panels over imagery. */
.glass-float {
  background: var(--glass);
  border: 1px solid var(--glass-line);
  color: rgb(var(--glass-ink));
  box-shadow: var(--elev-1);
  -webkit-backdrop-filter: blur(var(--blur-md));
  backdrop-filter: blur(var(--blur-md));
}

:root[data-effects="reduced"] .glass-float {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: rgb(var(--glass-solid));
}

/* Stagger: list and card entrances, with style={stagger(i)}. Item 9 onward appears with item 8.
   The doubled class outranks the `animation` shorthand of the animate-* utilities. */
.stagger.stagger {
  animation-delay: calc(min(var(--i, 0), var(--stagger-max) - 1) * var(--stagger-step));
}

/* Shimmer: only on something whose work is running (Progress running, Skeleton while loading). */
.animate-shimmer {
  position: relative;
  overflow: hidden;
}

.animate-shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  transform: translateX(-100%);
  animation: kestrel-shimmer 1.6s linear infinite;
}

/* Indeterminate progress: a 40% bar sliding across. */
.animate-indeterminate {
  animation: kestrel-indeterminate 1.2s var(--ease-in-out) infinite;
}

/* Sparkline draw-in: the clip rectangle grows from the left (transform only). */
.spark-draw {
  transform-box: fill-box;
  transform-origin: left center;
  animation: kestrel-draw var(--dur-count) var(--ease-out) both;
}

@media (prefers-reduced-motion: reduce) {
  .animate-shimmer::after,
  .animate-indeterminate {
    animation: none;
  }
  .animate-shimmer::after {
    opacity: 0;
  }
}

:root[data-motion="reduced"] .animate-shimmer::after,
:root[data-motion="reduced"] .animate-indeterminate {
  animation: none;
}

:root[data-motion="reduced"] .animate-shimmer::after {
  opacity: 0;
}

/* Native <option> lists follow the dark theme. */
select option {
  background: rgb(var(--tip));
  color: rgb(var(--ink));
}

@keyframes kestrel-shimmer {
  to {
    transform: translateX(100%);
  }
}

@keyframes kestrel-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

@keyframes kestrel-draw {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
```

- [ ] **Step 5: Create `frontend/src/ui/motion.ts`**

```ts
import { useSyncExternalStore, type CSSProperties } from "react";

/** Durations in ms, mirroring `--dur-*` in index.css (motion.test.tsx keeps them equal). */
export const dur = { instant: 0, fast: 120, base: 180, slow: 260, emphasis: 350, count: 600 } as const;

/** Control points mirroring `--ease-out`, `--ease-spring` and `--ease-in-out`. */
export const easing = {
  out: [0.2, 0.8, 0.2, 1],
  spring: [0.3, 1.6, 0.5, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** `--stagger-step` (ms) and `--stagger-max` (items). */
export const staggerTokens = { step: 40, max: 8 } as const;

/** The `--i` index for `.stagger` (ui.css). The CSS caps it, so pass the plain index. */
export function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/** A CSS cubic-bezier timing function for JavaScript animation (count-up). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return sampleY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (hi - lo > 1e-6) {
      if (sampleX(s) < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

const QUERY = "(prefers-reduced-motion: reduce)";
const KEY = "kestrel.motion";

export type MotionChoice = "system" | "reduce";

export function readMotionChoice(): MotionChoice {
  try {
    return localStorage.getItem(KEY) === "reduce" ? "reduce" : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Sets or clears `<html data-motion="reduced">`. main.tsx calls it once with the saved choice. */
export function applyMotion(choice: MotionChoice = readMotionChoice()): void {
  if (choice === "reduce") document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
  notify();
}

/** Settings → Appearance → Reduce motion (S2). A blocked store keeps the choice for this session. */
export function setMotionChoice(choice: MotionChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice applies until the app restarts.
  }
  applyMotion(choice);
}

function mediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
}

export function isReducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduced" || (mediaQuery()?.matches ?? false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const mq = mediaQuery();
  mq?.addEventListener?.("change", listener);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener?.("change", listener);
  };
}

/** True when the OS asks for reduced motion or Settings → Reduce motion is on. Feeds JS animation. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false);
}
```

- [ ] **Step 6: Create `frontend/src/app/effects.ts`**

```ts
import { toast } from "@/ui/toastStore";

export type Effects = "full" | "reduced";
export type EffectsChoice = "auto" | Effects;

const CHOICE_KEY = "kestrel.effects";
const AUTO_KEY = "kestrel.effects.auto";

/** Auto switches to reduced when the p95 frame time exceeds this (spec §4.3). */
export const FRAME_BUDGET_MS = 24;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts this session.
  }
}

/** Settings → Appearance → Visual effects: Auto (the default), Full or Reduced. */
export function readEffectsChoice(): EffectsChoice {
  const value = read(CHOICE_KEY);
  return value === "full" || value === "reduced" ? value : "auto";
}

function readAutoOutcome(): Effects | null {
  return read(AUTO_KEY) === "reduced" ? "reduced" : null;
}

/** The WebGL renderer string, or null when WebGL is unavailable. */
export function rendererName(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  } catch {
    return null;
  }
}

export function isSoftwareRenderer(name: string | null): boolean {
  return name !== null && /swiftshader|basic render/i.test(name);
}

export function resolveEffects(
  choice: EffectsChoice,
  autoOutcome: Effects | null,
  renderer: string | null,
): Effects {
  if (choice !== "auto") return choice;
  if (autoOutcome) return autoOutcome;
  return isSoftwareRenderer(renderer) ? "reduced" : "full";
}

/** Sets `<html data-effects>` from the saved choice. main.tsx calls it once, before the first paint. */
export function applyEffects(): Effects {
  const choice = readEffectsChoice();
  const outcome = readAutoOutcome();
  const renderer = choice === "auto" && outcome === null ? rendererName() : null;
  const effects = resolveEffects(choice, outcome, renderer);
  document.documentElement.dataset.effects = effects;
  return effects;
}

/** Settings (S2) and the palette's toggle (SH). Choosing Auto forgets the probe's outcome. */
export function setEffectsChoice(choice: EffectsChoice): Effects {
  write(CHOICE_KEY, choice === "auto" ? null : choice);
  if (choice === "auto") write(AUTO_KEY, null);
  return applyEffects();
}

export function p95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

type Raf = (callback: (time: number) => void) => void;

const browserRaf: Raf = (callback) => {
  requestAnimationFrame(callback);
};

/** Frame-to-frame times over `durationMs`, after `warmupMs` whose frames are not counted. */
export function measureFrames(durationMs = 2000, raf: Raf = browserRaf, warmupMs = 300): Promise<number[]> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let first: number | null = null;
    let last = 0;
    const tick = (time: number) => {
      if (first === null) first = time;
      else if (time - first > warmupMs) deltas.push(time - last);
      last = time;
      if (time - first >= warmupMs + durationMs) resolve(deltas);
      else raf(tick);
    };
    raf(tick);
  });
}

let probed = false;

/**
 * Auto's frame-time probe. The Overview calls it on its first render (S1). It runs at most once per
 * session, only in Auto, only when Auto has not decided before, and only while the window is visible.
 * When p95 exceeds the budget it switches to reduced, remembers that, and offers Undo, which chooses
 * Full for good (spec §15: the Settings override is final).
 */
export async function runAutoProbe(
  measure: () => Promise<number[]> = () => measureFrames(),
): Promise<Effects | null> {
  if (probed || readEffectsChoice() !== "auto" || readAutoOutcome() !== null) return null;
  if (document.documentElement.dataset.effects === "reduced") return null;
  if (document.visibilityState !== "visible") return null;
  probed = true;
  const samples = await measure();
  if (document.visibilityState !== "visible") {
    probed = false;
    return null;
  }
  if (p95(samples) <= FRAME_BUDGET_MS) return "full";
  write(AUTO_KEY, "reduced");
  document.documentElement.dataset.effects = "reduced";
  toast("info", "Visual effects reduced for smoother performance", {
    label: "Undo",
    onClick: () => {
      setEffectsChoice("full");
    },
  });
  return "reduced";
}

/** Tests only: forget that this session already probed. */
export function resetAutoProbe(): void {
  probed = false;
}
```

- [ ] **Step 7: Create `frontend/src/ui/GlassPanel.tsx`**

```tsx
import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "./tokens";

export type GlassVariant = "pane" | "float";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** `pane`: a translucent card, no blur. `float`: frosted glass over imagery, the only blur (F7). */
  variant?: GlassVariant;
  /** Adds the hover lift: translateY −2px and --elev-2. */
  interactive?: boolean;
  /** Defaults: `panel` (16px) for a pane, `control` (10px) for a float. */
  radius?: "panel" | "control";
  as?: "div" | "section" | "aside" | "nav" | "header";
}

const VARIANT: Record<GlassVariant, string> = {
  pane: "border border-card-line bg-surface shadow-elev-1",
  float: "glass-float",
};

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { variant = "pane", interactive = false, radius, as = "div", className, ...rest },
  ref,
) {
  const Tag = as as "div";
  const r = radius ?? (variant === "pane" ? "panel" : "control");
  return (
    <Tag
      ref={ref}
      data-glass={variant}
      className={cx(
        VARIANT[variant],
        r === "panel" ? "rounded-panel" : "rounded-control",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-fast ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-elev-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...rest}
    />
  );
});
```

- [ ] **Step 8: Apply the appearance in `frontend/src/main.tsx`** — the whole file becomes:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { applyEffects } from "@/app/effects";
import { applyMotion } from "@/ui/motion";
import "@/index.css";

// Appearance is set before the first paint, and it must never stop the app from opening.
try {
  applyMotion();
  applyEffects();
} catch (error) {
  console.error("appearance setup failed", error);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Export from the barrel** — add to `frontend/src/ui/index.ts`, in alphabetical position:

```ts
export { GlassPanel, type GlassPanelProps, type GlassVariant } from "./GlassPanel";
export {
  applyMotion,
  cubicBezier,
  dur,
  easing,
  isReducedMotion,
  readMotionChoice,
  setMotionChoice,
  stagger,
  staggerTokens,
  useReducedMotion,
  type MotionChoice,
} from "./motion";
```

- [ ] **Step 10: Gallery sections**

`frontend/src/ui/gallery/sections/Glass.tsx`:

```tsx
import { useState } from "react";
import { GlassPanel } from "@/ui/GlassPanel";

export const title = "Glass";
export const order = 10;

const IMAGERY = "linear-gradient(135deg,#6b5c9c,#2f5f73)";
const TEXTURE = "repeating-linear-gradient(45deg,rgba(255,255,255,.08) 0 8px,transparent 8px 16px)";

export default function GlassSection() {
  const [reduced, setReduced] = useState(false);
  const toggle = () => {
    const next = !reduced;
    setReduced(next);
    document.documentElement.dataset.effects = next ? "reduced" : "full";
  };
  return (
    <div className="grid gap-4">
      <button type="button" onClick={toggle} className="w-fit text-sm text-accent-ink underline">
        {reduced ? "Show full effects" : "Show reduced effects"}
      </button>
      <div className="grid grid-cols-3 gap-4">
        <GlassPanel className="p-4">
          <p className="text-xs text-muted">pane</p>
          <p className="mt-2 text-lg">Translucent, no blur</p>
        </GlassPanel>
        <GlassPanel interactive className="p-4">
          <p className="text-xs text-muted">pane · interactive</p>
          <p className="mt-2 text-lg">Hover lifts 2px</p>
        </GlassPanel>
        <div className="relative h-40 overflow-hidden rounded-panel" style={{ background: IMAGERY }}>
          <div className="absolute inset-0" style={{ background: TEXTURE }} />
          <GlassPanel variant="float" className="absolute left-3 top-3 px-3 py-2 text-xs">
            float over imagery
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
```

`frontend/src/ui/gallery/sections/Motion.tsx`:

```tsx
import { useState } from "react";
import { stagger } from "@/ui/motion";

export const title = "Motion";
export const order = 12;

export default function MotionSection() {
  const [run, setRun] = useState(0);
  return (
    <div className="grid gap-3">
      <button type="button" onClick={() => setRun((r) => r + 1)} className="w-fit text-sm text-accent-ink underline">
        Replay the entrance
      </button>
      <ul key={run} className="grid grid-cols-6 gap-2">
        {Array.from({ length: 12 }, (_, i) => (
          <li
            key={i}
            style={stagger(i)}
            className="stagger animate-rise rounded-control border border-card-line bg-surface p-3 text-2xs text-muted"
          >
            item {i + 1}
          </li>
        ))}
      </ul>
      <p className="text-2xs text-muted">
        Items 9 to 12 arrive with item 8 (--stagger-max). With reduced motion all arrive at once.
      </p>
    </div>
  );
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/motion.test.tsx src/app/effects.test.ts src/ui/GlassPanel.test.tsx src/ui/uiCss.test.ts src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend test` and `pnpm -C frontend lint`: PASS, `tokens ok`.

- [ ] **Step 12: Visual check**

Run `node frontend/scripts/gallery-shots.mjs glass` and `node frontend/scripts/gallery-shots.mjs motion`. Compare `glass-full.png` with the floating `.glass` chips in `ws-images.html` (the info bar and zoom group over the canvas): translucent dark with a 1px light border, the texture blurred behind it. `glass-reduced.png`: the float is solid `#16172a` with no blur, and the page background shows one gradient (top right) instead of two. In the browser, hover the interactive pane (2px lift) and press "Replay the entrance" (items rise 40 ms apart; 9 to 12 with 8). Open `gallery.html?motion=reduced` and replay: everything appears at once.

- [ ] **Step 13: Commit**

```powershell
git add frontend/src/index.css frontend/src/ui/ui.css frontend/src/ui/uiCss.test.ts frontend/src/ui/motion.ts frontend/src/ui/motion.test.tsx frontend/src/app/effects.ts frontend/src/app/effects.test.ts frontend/src/ui/GlassPanel.tsx frontend/src/ui/GlassPanel.test.tsx frontend/src/main.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Glass.tsx frontend/src/ui/gallery/sections/Motion.tsx
git status
git commit -m "feat(ui): motion tokens, reduced motion, reduced effects and GlassPanel" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The app keymap, chords, `isTypingTarget` and `useToolShortcuts`

**Files:**
- Create: `frontend/src/ui/keymap.ts`, `frontend/src/ui/keymap.test.tsx`
- Modify: `frontend/src/editor/hotkeys.ts` (remove `isTypingTarget`), `frontend/src/editor/hotkeys.test.ts` (remove its block), `frontend/src/editor/useEditorHotkeys.ts`, `frontend/src/maps/MapReviewPanel.tsx`, `frontend/src/review/ImageReviewQueue.tsx`, `frontend/src/screens/CloudsScreen.tsx`, `frontend/src/screens/DataManagerScreen.tsx`, `frontend/src/screens/MapsScreen.tsx`, `frontend/src/volumes/VolumeToolbar.tsx` (import path only)
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`@/ui/keymap`):
  - `type WorkspaceScope = "images" | "maps" | "clouds" | "clouds.fly"`, `type KeyScope = "global" | "review" | WorkspaceScope`
  - `interface KeyEntry { keys: string[]; scope: KeyScope; action: string; help: string }`
  - `GLOBAL_KEYS: KeyEntry[]`, `REVIEW_KEYS: KeyEntry[]`, `WORKSPACE_KEYS: Record<WorkspaceScope, KeyEntry[]>`, `KEYMAP: KeyEntry[]` (all of them)
  - `interface KeyLike { key; ctrlKey; metaKey; altKey; shiftKey }`, `chordOf(e: KeyLike): string`, `normaliseChord(chord: string): string`, `formatChord(chord: string): string[]` (display parts: `"Ctrl+K"` → `["Ctrl", "K"]`, `"ArrowLeft"` → `["←"]`)
  - `isTypingTarget(target: EventTarget | null): boolean`
  - `interface Collision { chord: string; a: KeyEntry; b: KeyEntry }`, `findCollisions(entries: readonly KeyEntry[]): Collision[]`
  - `keysFor(scope: WorkspaceScope | null): KeyEntry[]` (global + review + the scope; for the `?` sheet)
  - `interface ToolShortcut { shortcut?: string; action?: string; onTrigger: () => void; disabled?: boolean }`, `useToolShortcuts(tools: readonly ToolShortcut[], enabled?: boolean): void`
  - Chord syntax: modifiers `Ctrl`, `Alt`, `Shift` in that order joined by `+`; letters upper-case; named keys as `KeyboardEvent.key` (`Escape`, `Enter`, `Tab`, `Space`, `Delete`, `Backspace`, `ArrowLeft` …); `Shift` is written only for letters and named keys (`"?"` and `"+"` carry it in the character).
  - Shared action ids across workspaces: `finding-marker` (M), `measure-length` (L), `ai-detect` (D), `area` (Q), `profile` (E).

- [ ] **Step 1: Write the failing test**

`frontend/src/ui/keymap.test.tsx`:

```tsx
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_KEYS,
  KEYMAP,
  REVIEW_KEYS,
  WORKSPACE_KEYS,
  chordOf,
  findCollisions,
  formatChord,
  isTypingTarget,
  keysFor,
  normaliseChord,
  useToolShortcuts,
  type KeyEntry,
  type KeyLike,
} from "./keymap";

const ev = (key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => vi.restoreAllMocks());

describe("isTypingTarget", () => {
  it("is true for inputs, textareas, selects and editable content", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("chords", () => {
  it.each<[KeyLike, string]>([
    [ev("k", { ctrlKey: true }), "Ctrl+K"],
    [ev("K", { metaKey: true, shiftKey: true }), "Ctrl+Shift+K"],
    [ev("a"), "A"],
    [ev("A"), "A"],
    [ev("A", { shiftKey: true }), "Shift+A"],
    [ev("?", { shiftKey: true }), "?"],
    [ev("+", { shiftKey: true }), "+"],
    [ev(" "), "Space"],
    [ev("Esc"), "Escape"],
    [ev("Del"), "Delete"],
    [ev("Tab", { shiftKey: true }), "Shift+Tab"],
    [ev("ArrowLeft", { altKey: true }), "Alt+ArrowLeft"],
    [ev("1", { altKey: true }), "Alt+1"],
    [ev("[", { ctrlKey: true }), "Ctrl+["],
  ])("%j is %s", (e, chord) => {
    expect(chordOf(e)).toBe(chord);
  });

  it("normalises hand-written chords and formats them for key caps", () => {
    expect(normaliseChord("ctrl+k")).toBe("Ctrl+K");
    expect(normaliseChord("shift+a")).toBe("Shift+A");
    expect(normaliseChord("Esc")).toBe("Escape");
    expect(normaliseChord("+")).toBe("+");
    expect(formatChord("Ctrl+K")).toEqual(["Ctrl", "K"]);
    expect(formatChord("Shift+ArrowLeft")).toEqual(["Shift", "←"]);
    expect(formatChord("Escape")).toEqual(["Esc"]);
    expect(formatChord("+")).toEqual(["+"]);
  });
});

describe("the app keymap (spec §5.6)", () => {
  it("writes every chord in canonical form", () => {
    for (const entry of KEYMAP) {
      for (const key of entry.keys) expect(normaliseChord(key), `${entry.scope}/${entry.action}`).toBe(key);
    }
  });

  it("has no collisions", () => {
    expect(findCollisions(KEYMAP)).toEqual([]);
  });

  it("catches a workspace key that equals a global or review key", () => {
    const bad: KeyEntry[] = [
      ...GLOBAL_KEYS,
      ...REVIEW_KEYS,
      { keys: ["F"], scope: "maps", action: "x", help: "" },
      { keys: ["3"], scope: "clouds", action: "y", help: "" },
    ];
    expect(findCollisions(bad).map((c) => c.chord).sort()).toEqual(["3", "F"]);
  });

  it("catches two entries sharing a key in one scope", () => {
    const bad: KeyEntry[] = [
      { keys: ["B"], scope: "images", action: "box", help: "" },
      { keys: ["B"], scope: "images", action: "brush", help: "" },
      { keys: ["B"], scope: "maps", action: "fine-elsewhere", help: "" },
    ];
    expect(findCollisions(bad)).toHaveLength(1);
  });

  it("lets fly mode reuse review keys but not global ones", () => {
    const fly = (key: string): KeyEntry => ({ keys: [key], scope: "clouds.fly", action: "move", help: "" });
    expect(findCollisions([...GLOBAL_KEYS, ...REVIEW_KEYS, fly("A")])).toEqual([]);
    expect(findCollisions([...GLOBAL_KEYS, ...REVIEW_KEYS, fly("F")])).toHaveLength(1);
  });

  it("gives M, L, D, Q and E one meaning in every workspace that has them", () => {
    const meaning = (scope: "images" | "maps" | "clouds", chord: string) =>
      WORKSPACE_KEYS[scope].find((e) => e.keys.includes(chord))?.action;
    for (const scope of ["images", "maps", "clouds"] as const) {
      expect(meaning(scope, "M")).toBe("finding-marker");
      expect(meaning(scope, "L")).toBe("measure-length");
    }
    expect(meaning("images", "D")).toBe("ai-detect");
    expect(meaning("maps", "D")).toBe("ai-detect");
    for (const scope of ["maps", "clouds"] as const) {
      expect(meaning(scope, "Q")).toBe("area");
      expect(meaning(scope, "E")).toBe("profile");
    }
  });

  it("lists a screen's keys for the ? sheet", () => {
    const keys = keysFor("maps").flatMap((e) => e.keys);
    expect(keys).toContain("Ctrl+K");
    expect(keys).toContain("A");
    expect(keys).toContain("Shift+N");
    expect(keys).not.toContain("W");
  });
});

describe("useToolShortcuts", () => {
  it("fires a tool's key, ignores typing and key repeat, and releases on unmount", () => {
    const onTrigger = vi.fn();
    const { unmount } = renderHook(() => useToolShortcuts([{ shortcut: "B", onTrigger }]));
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "b" });
    input.remove();
    fireEvent.keyDown(window, { key: "b", repeat: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("skips disabled tools and honours enabled=false", () => {
    const onTrigger = vi.fn();
    const { rerender } = renderHook(({ on }) => useToolShortcuts([{ shortcut: "B", onTrigger }], on), {
      initialProps: { on: false },
    });
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).not.toHaveBeenCalled();
    rerender({ on: true });
    fireEvent.keyDown(window, { key: "b" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("refuses a global or review key unless the tool is that key's action", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const area = vi.fn();
    const select = vi.fn();
    renderHook(() =>
      useToolShortcuts([
        { shortcut: "A", action: "area", onTrigger: area },
        { shortcut: "V", action: "tool-select", onTrigger: select },
      ]),
    );
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "v" });
    expect(area).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"A"'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/keymap.test.tsx`
Expected: FAIL with `Failed to resolve import "./keymap"`.

- [ ] **Step 3: Create `frontend/src/ui/keymap.ts`**

```ts
import { useEffect, useRef } from "react";

/**
 * The one app keymap (spec §5.6). Global and review keys mean the same everywhere; each workspace
 * owns only its tool keys, and none may equal a global or review key (keymap.test.tsx walks it).
 * I, M and C bind handlers to these entries through useToolShortcuts; the ? sheet and hint bars
 * render from them.
 */

export type WorkspaceScope = "images" | "maps" | "clouds" | "clouds.fly";
export type KeyScope = "global" | "review" | WorkspaceScope;

export interface KeyEntry {
  /** Canonical chords (see chordOf). */
  keys: string[];
  scope: KeyScope;
  /** What the key does; the same action keeps the same id in every scope. */
  action: string;
  /** One line for the ? sheet and hint bars. */
  help: string;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Keys never fire while focus is in a text field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // `isContentEditable` is undefined in jsdom, so compare explicitly.
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

const NAMED: Record<string, string> = { " ": "Space", Spacebar: "Space", Esc: "Escape", Del: "Delete" };

/**
 * `Ctrl+Alt+Shift+Key`: modifiers in that order, letters upper-case (so keys are case-insensitive),
 * named keys as KeyboardEvent.key. Meta counts as Ctrl. Shift is written only for letters and named
 * keys, because "?" and "+" already carry it in the character.
 */
export function chordOf(e: KeyLike): string {
  let key = NAMED[e.key] ?? e.key;
  const letter = /^[a-z]$/i.test(key);
  if (letter) key = key.toUpperCase();
  const named = key.length > 1;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey && (letter || named)) mods.push("Shift");
  return [...mods, key].join("+");
}

function splitChord(chord: string): string[] {
  if (chord === "+") return ["+"];
  if (chord.endsWith("++")) return [...chord.slice(0, -2).split("+"), "+"];
  return chord.split("+");
}

export function normaliseChord(chord: string): string {
  const parts = splitChord(chord);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return chordOf({
    key,
    ctrlKey: mods.has("ctrl"),
    metaKey: mods.has("meta") || mods.has("cmd"),
    altKey: mods.has("alt"),
    shiftKey: mods.has("shift"),
  });
}

const GLYPH: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
};

/** A chord as key-cap labels, for Kbd. */
export function formatChord(chord: string): string[] {
  return splitChord(chord).map((part) => GLYPH[part] ?? part);
}

const entry =
  (scope: KeyScope) =>
  (keys: string | string[], action: string, help: string): KeyEntry => ({
    keys: Array.isArray(keys) ? keys : [keys],
    scope,
    action,
    help,
  });
const g = entry("global");
const r = entry("review");
const i = entry("images");
const m = entry("maps");
const c = entry("clouds");
const fly = entry("clouds.fly");

export const GLOBAL_KEYS: KeyEntry[] = [
  g("Ctrl+K", "palette", "Command palette"),
  g("?", "shortcuts", "Shortcuts for this screen"),
  g("Escape", "cancel", "Cancel the draft or tool; again to deselect"),
  g("Enter", "commit", "Commit the draft or save the tool's result"),
  g("Backspace", "remove-vertex", "Remove the last vertex while drawing"),
  g("Delete", "delete", "Delete the selection"),
  g("Ctrl+Z", "undo", "Undo (while drawing, remove the last vertex)"),
  g("Ctrl+Y", "redo", "Redo"),
  g("Space", "pan-hold", "Hold to pan from any tool"),
  g("V", "tool-select", "Select tool (Orbit in point clouds)"),
  g("H", "tool-pan", "Pan tool"),
  g("F", "fit", "Fit the image, the site or the cloud"),
  g("+", "zoom-in", "Zoom in"),
  g("-", "zoom-out", "Zoom out"),
];

export const REVIEW_KEYS: KeyEntry[] = [
  r("A", "accept", "Accept the focused suggestion or detection"),
  r("X", "reject", "Reject the focused suggestion or detection"),
  r("Shift+A", "accept-all", "Accept all visible pending items"),
  r("Shift+X", "reject-all", "Reject all visible pending items"),
  r(["1", "2", "3", "4", "5", "6", "7", "8", "9"], "severity", "Set the severity level"),
  r("T", "type-picker", "Pick the type"),
  r("Tab", "next-pending", "Next pending item"),
  r("Shift+Tab", "previous-pending", "Previous pending item"),
];

export const WORKSPACE_KEYS: Record<WorkspaceScope, KeyEntry[]> = {
  images: [
    i("B", "box", "Box"),
    i("R", "rotated-box", "Rotated box"),
    i("P", "polygon", "Polygon"),
    i("S", "smart-polygon", "Smart polygon"),
    i("M", "finding-marker", "Point marker"),
    i("L", "measure-length", "Measure length"),
    i("D", "ai-detect", "AI detect"),
    i("G", "suggestions-toggle", "Show or hide suggestions"),
    i("Shift+H", "annotations-toggle", "Show or hide annotations"),
    i("N", "nothing-to-report", "Nothing to report on this image"),
    i("C", "focus-comment", "Write a comment"),
    i("ArrowLeft", "previous-image", "Previous image"),
    i("ArrowRight", "next-image", "Next image"),
    i(["Shift+ArrowLeft", "Shift+ArrowRight"], "rotate", "Rotate the rotated box"),
    i(["Alt+ArrowUp", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowRight"], "nudge", "Nudge the selection"),
    i("0", "fit", "Fit the image"),
    i("Ctrl+1", "one-to-one", "Actual size"),
    i("Ctrl+D", "duplicate", "Duplicate the selection"),
    i("[", "threshold-down", "Lower the confidence threshold"),
    i("]", "threshold-up", "Raise the confidence threshold"),
    i("Ctrl+[", "toggle-browser", "Show or hide the image browser"),
    i("Ctrl+]", "toggle-inspector", "Show or hide the inspector"),
    i("Shift+M", "grid-map", "Switch between grid and capture map"),
  ],
  maps: [
    m("L", "measure-length", "Distance"),
    m("Q", "area", "Area"),
    m("E", "profile", "Elevation profile"),
    m("U", "volume", "Volume"),
    m("M", "finding-marker", "Finding point"),
    m("G", "finding-polygon", "Finding polygon"),
    m("Z", "zone", "Zone"),
    m("K", "align-drawing", "Align a drawing"),
    m("D", "ai-detect", "AI detect in a region"),
    m("[", "previous-survey", "Previous survey"),
    m("]", "next-survey", "Next survey"),
    m("P", "play", "Play the survey timeline"),
    m("C", "compare-mode", "Cycle the compare mode"),
    m("Shift+N", "north-up", "North up"),
  ],
  clouds: [
    c("O", "orbit", "Orbit"),
    c("W", "fly", "Fly"),
    c("P", "point", "Point"),
    c("L", "measure-length", "Distance"),
    c("Z", "height", "Height"),
    c("U", "verticality", "Verticality"),
    c("Q", "area", "Area"),
    c("E", "profile", "Cross-section"),
    c("C", "clipping-box", "Clipping box"),
    c("M", "finding-marker", "Pin a finding"),
    c("I", "photo-link", "Source photo"),
    c("N", "next-ring", "Next ring"),
    c("Alt+1", "view-top", "Top view"),
    c("Alt+2", "view-front", "Front view"),
    c("Alt+3", "view-side", "Side view"),
    c("Alt+4", "view-iso", "Iso view"),
  ],
  // Fly mode (pointer lock) suspends the review keys until Esc; only global keys stay reserved.
  "clouds.fly": [
    fly("W", "move-forward", "Fly forward"),
    fly("A", "move-left", "Fly left"),
    fly("S", "move-back", "Fly back"),
    fly("D", "move-right", "Fly right"),
    fly("Q", "move-down", "Fly down"),
    fly("E", "move-up", "Fly up"),
  ],
};

export const KEYMAP: KeyEntry[] = [...GLOBAL_KEYS, ...REVIEW_KEYS, ...Object.values(WORKSPACE_KEYS).flat()];

export interface Collision {
  chord: string;
  a: KeyEntry;
  b: KeyEntry;
}

function clash(a: KeyScope, b: KeyScope): boolean {
  if (a === b) return true;
  if (a === "global" || b === "global") return true;
  if (a === "review" || b === "review") return a !== "clouds.fly" && b !== "clouds.fly";
  return false;
}

/** Pairs that would fire together: same scope, or a key that is global or review elsewhere. */
export function findCollisions(entries: readonly KeyEntry[]): Collision[] {
  const flat = entries.flatMap((e) => e.keys.map((chord) => ({ chord, e })));
  const out: Collision[] = [];
  for (let x = 0; x < flat.length; x++) {
    for (let y = x + 1; y < flat.length; y++) {
      if (flat[x].chord === flat[y].chord && clash(flat[x].e.scope, flat[y].e.scope)) {
        out.push({ chord: flat[x].chord, a: flat[x].e, b: flat[y].e });
      }
    }
  }
  return out;
}

/** The keys live on a screen: global, review, and the workspace's own (for the ? sheet). */
export function keysFor(scope: WorkspaceScope | null): KeyEntry[] {
  return [...GLOBAL_KEYS, ...REVIEW_KEYS, ...(scope ? WORKSPACE_KEYS[scope] : [])];
}

export interface ToolShortcut {
  shortcut?: string;
  /** The KeyEntry action this tool performs; required to bind a global key such as V or F. */
  action?: string;
  onTrigger: () => void;
  disabled?: boolean;
}

const SHARED = new Map<string, string>();
for (const e of [...GLOBAL_KEYS, ...REVIEW_KEYS]) for (const k of e.keys) SHARED.set(k, e.action);

function refused(tool: ToolShortcut): boolean {
  if (!tool.shortcut) return false;
  const owner = SHARED.get(normaliseChord(tool.shortcut));
  return owner !== undefined && owner !== tool.action;
}

/**
 * Binds the tools' shortcuts on window while mounted (and `enabled`). Ignores key repeat, modified
 * events that were already handled, and keys typed into text fields. A tool may not take a global or
 * review key unless it is that key's action.
 */
export function useToolShortcuts(tools: readonly ToolShortcut[], enabled = true): void {
  const latest = useRef(tools);
  useEffect(() => {
    latest.current = tools;
  });
  const signature = tools.map((t) => `${t.shortcut ?? ""}:${t.action ?? ""}`).join("|");
  useEffect(() => {
    for (const tool of latest.current) {
      if (refused(tool)) {
        console.error(`useToolShortcuts: "${tool.shortcut}" is a global or review key; not bound (spec §5.6)`);
      }
    }
  }, [signature]);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTypingTarget(e.target)) return;
      const chord = chordOf(e);
      const tool = latest.current.find(
        (t) => !t.disabled && t.shortcut !== undefined && !refused(t) && normaliseChord(t.shortcut) === chord,
      );
      if (!tool) return;
      e.preventDefault();
      tool.onTrigger();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
```

- [ ] **Step 4: Move `isTypingTarget` out of the editor**

In `frontend/src/editor/hotkeys.ts`, delete the whole `export function isTypingTarget(...) { … }` function (the eight lines after `actionForKey`). In `frontend/src/editor/hotkeys.test.ts`, change the import to `import { actionForKey, type KeyLike } from "./hotkeys";` and delete the `describe("isTypingTarget", …)` block (now in `keymap.test.tsx`). Then rewrite the imports:

```powershell
$files = "frontend/src/maps/MapReviewPanel.tsx","frontend/src/review/ImageReviewQueue.tsx","frontend/src/screens/CloudsScreen.tsx","frontend/src/screens/DataManagerScreen.tsx","frontend/src/screens/MapsScreen.tsx","frontend/src/volumes/VolumeToolbar.tsx"
foreach ($f in $files) { (Get-Content $f -Raw) -replace 'from "@/editor/hotkeys";', 'from "@/ui/keymap";' | Set-Content -NoNewline -Encoding utf8 $f }
```

In `frontend/src/editor/useEditorHotkeys.ts`, replace `import { actionForKey, isTypingTarget } from "./hotkeys";` with:

```ts
import { isTypingTarget } from "@/ui/keymap";
import { actionForKey } from "./hotkeys";
```

Check: `git grep -n "isTypingTarget" -- frontend/src` lists only `ui/keymap.ts`, `ui/keymap.test.tsx` and the seven importers, each importing from `@/ui/keymap`.

- [ ] **Step 5: Export from the barrel** (alphabetical, after `./Kbd`):

```ts
export {
  GLOBAL_KEYS,
  KEYMAP,
  REVIEW_KEYS,
  WORKSPACE_KEYS,
  chordOf,
  findCollisions,
  formatChord,
  isTypingTarget,
  keysFor,
  normaliseChord,
  useToolShortcuts,
  type KeyEntry,
  type KeyScope,
  type ToolShortcut,
  type WorkspaceScope,
} from "./keymap";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/keymap.test.tsx src/editor`
Expected: PASS. Then `pnpm -C frontend test`, `pnpm -C frontend lint` and `pnpm -C frontend build`: PASS.

- [ ] **Step 7: Visual check**

No visual surface. Confirm by hand in the running app that the editor, review queue, maps and clouds screens still ignore their shortcut keys while typing in a field (they now import the same function from `@/ui/keymap`).

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/ui/keymap.ts frontend/src/ui/keymap.test.tsx frontend/src/ui/index.ts frontend/src/editor/hotkeys.ts frontend/src/editor/hotkeys.test.ts frontend/src/editor/useEditorHotkeys.ts frontend/src/maps/MapReviewPanel.tsx frontend/src/review/ImageReviewQueue.tsx frontend/src/screens/CloudsScreen.tsx frontend/src/screens/DataManagerScreen.tsx frontend/src/screens/MapsScreen.tsx frontend/src/volumes/VolumeToolbar.tsx
git status
git commit -m "feat(ui): the app keymap with its collision test; isTypingTarget moves to ui/keymap" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Controls — Button, fields, Checkbox, Switch, Field, Kbd, Pill, Alert

**Files:**
- Modify: `frontend/src/ui/tokens.ts`, `Button.tsx`, `Input.tsx`, `Checkbox.tsx`, `Switch.tsx`, `Field.tsx`, `Kbd.tsx`, `Pill.tsx`, `Alert.tsx` (all under `frontend/src/ui/`)
- Test: `frontend/src/ui/Button.test.tsx`, `frontend/src/ui/Controls.test.tsx` (append)
- Create: `frontend/src/ui/gallery/sections/Controls.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: Task 1 tokens, Task 2's renamed classes.
- Produces: unchanged APIs of `Button`, `IconButton`, `buttonClass(variant, size, className?)`, `Input`, `Select`, `Textarea`, `fieldClass(invalid?, className?)`, `Checkbox`, `Switch`, `Field`, `Kbd`, `Pill`, `Alert`; `PillTone` gains `"info"`; `tokens.ts` gains `lift` (the hover lift). `focusRing` now offsets on `bg`; `transition` uses `duration-fast ease-out`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ui/Button.test.tsx`, inside `describe("Button", …)`:

```tsx
  it("primary carries the brand gradient and glow; every variant is a control-radius box", () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="secondary">S</Button>
        <Button variant="ghost">G</Button>
        <Button variant="danger">D</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "P" });
    expect(primary.className).toContain("bg-grad-primary");
    expect(primary.className).toContain("shadow-glow");
    for (const name of ["P", "S", "G", "D"]) {
      expect(screen.getByRole("button", { name }).className).toContain("rounded-control");
    }
    expect(screen.getByRole("button", { name: "D" }).className).toContain("text-danger");
  });

  it("buttonClass still styles links as buttons", () => {
    expect(buttonClass("primary", "sm", "extra")).toMatch(/h-7.*extra/);
  });
```

and change its import line to `import { Button, IconButton, buttonClass } from "./Button";`.

Append to `frontend/src/ui/Controls.test.tsx` (add `Kbd` and `Pill` to the imports: `import { Kbd } from "./Kbd";`, `import { Pill } from "./Pill";`):

```tsx
describe("Aero glass controls", () => {
  it("fields sit on the field token with a quiet border, and a danger border when invalid", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Input aria-label="Folder" invalid />
      </>,
    );
    const name = screen.getByLabelText("Name");
    expect(name.className).toContain("bg-field");
    expect(name.className).toContain("border-line");
    const folder = screen.getByLabelText("Folder");
    expect(folder.className).toContain("border-danger");
    expect(folder).toHaveAttribute("aria-invalid", "true");
  });

  it("Kbd is a mono key cap", () => {
    render(<Kbd>K</Kbd>);
    const cap = screen.getByText("K");
    expect(cap.tagName).toBe("KBD");
    expect(cap.className).toContain("font-mono");
  });

  it("Pill keeps the inverse tone for old callers, adds info, and pulses only when live", () => {
    render(
      <>
        <Pill tone="inverse">old</Pill>
        <Pill tone="info">reviewed</Pill>
        <Pill tone="accent" live>
          running
        </Pill>
        <Pill tone="ok" dot>
          done
        </Pill>
      </>,
    );
    expect(screen.getByText("old").className).toContain("bg-tip");
    expect(screen.getByText("reviewed").className).toContain("text-info");
    const liveDot = screen.getByText("running").querySelector('[aria-hidden="true"]')!;
    expect(liveDot.className).toContain("animate-pulse-dot");
    expect(liveDot.className).toContain("motion-reduce:animate-none");
    expect(screen.getByText("done").querySelector('[aria-hidden="true"]')!.className).not.toContain("animate");
  });

  it("Switch slides its thumb on the base duration and stops under reduced motion", () => {
    render(<Switch checked onChange={() => {}} label="Suggestions" />);
    const thumb = screen.getByRole("switch", { name: "Suggestions" }).querySelector("[data-part='thumb']")!;
    expect(thumb.className).toContain("duration-base");
    expect(thumb.className).toContain("motion-reduce:transition-none");
    expect(thumb.className).toContain("translate-x-3.5");
  });

  it("Checkbox draws a control-line box that turns accent when checked", () => {
    render(<Checkbox label="Reviewed only" />);
    const box = screen.getByRole("checkbox", { name: "Reviewed only" }).nextElementSibling!;
    expect(box.className).toContain("border-control-line");
    expect(box.className).toContain("peer-checked:bg-accent");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/ui/Button.test.tsx src/ui/Controls.test.tsx`
Expected: FAIL — `bg-grad-primary`, `bg-field`, `font-mono`, `text-info`, `[data-part='thumb']` and `border-control-line` not found.

- [ ] **Step 3: Rewrite `frontend/src/ui/tokens.ts`**

```ts
/**
 * Shared class fragments for the ui components. This is the only file allowed to name raw Tailwind
 * palette colours (it names none; `scripts/check-tokens.mjs` enforces that everywhere else).
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const transition =
  "transition-[background-color,border-color,color,transform,box-shadow,opacity] duration-fast ease-out motion-reduce:transition-none";

export const pressable = "active:scale-[.98] motion-reduce:active:scale-100";

/** The mockup's hover lift on buttons (.btn:hover translateY −1px). */
export const lift = "hover:-translate-y-px motion-reduce:hover:translate-y-0";

export const disabledClass = "disabled:opacity-45 disabled:pointer-events-none";

/** Joins class fragments, dropping empties, so callers can pass conditional strings. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 4: Rewrite `frontend/src/ui/Button.tsx`**

```tsx
/* eslint-disable react-refresh/only-export-components --
   the class helper is exported next to the component that uses it; not a fast-refresh boundary. */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import { cx, disabledClass, focusRing, lift, pressable, transition } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows a spinner before the label; the label stays readable. */
  loading?: boolean;
  icon?: IconName;
}

const VARIANT: Record<ButtonVariant, string> = {
  // The mockup's .btn.pri: the violet → indigo gradient and its glow (the glow drops in reduced effects).
  primary: cx("border-transparent bg-grad-primary text-accent-fg shadow-glow", lift),
  secondary: cx("border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2", lift),
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-2",
  danger: "border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-[34px] gap-2 px-3.5 text-sm",
};

export const buttonClass = (variant: ButtonVariant, size: ButtonSize, className?: string) =>
  cx(
    "inline-flex items-center justify-center whitespace-nowrap rounded-control border font-semibold",
    VARIANT[variant],
    SIZE[size],
    transition,
    pressable,
    focusRing,
    disabledClass,
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    icon,
    className,
    children,
    type = "button",
    disabled,
    ...rest
  },
  ref,
) {
  const iconSize = size === "sm" ? 13 : 15;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <Icon name="spinner" size={iconSize} className="animate-spin motion-reduce:animate-none" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  icon: IconName;
  /** The accessible name and the tooltip. */
  label: string;
}

/** A square button with only an icon; `label` becomes its accessible name and its title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", variant = "ghost", className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cx(size === "sm" ? "w-7 px-0" : "w-[34px] px-0", className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </Button>
  );
});
```

(`animate-spin` stays: it only runs while `loading`, which is real work.)

- [ ] **Step 5: Restyle the fields** — in `frontend/src/ui/Input.tsx` replace `fieldClass` and the three size strings:

```tsx
/** Shared field chrome: the field token, a quiet border, the accent focus ring, the invalid state. */
export const fieldClass = (invalid?: boolean, className?: string) =>
  cx(
    "w-full rounded-control border bg-field text-base text-ink placeholder:text-dim",
    "hover:border-line-strong focus:outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/20",
    "disabled:opacity-45 disabled:pointer-events-none",
    invalid ? "border-danger" : "border-line",
    transition,
    className,
  );
```

In `Input`: `dense ? "h-7 px-2 text-sm" : "h-[34px] px-3"`. In `Select`: `dense ? "h-7 pl-2 text-sm" : "h-[34px] pl-3"`. `Textarea` is unchanged apart from `fieldClass`. Update the doc comment on `InputProps.dense` to "28px for dense rows; the default is 34px."

- [ ] **Step 6: Restyle `Checkbox`, `Switch`, `Field`, `Kbd`, `Pill`, `Alert`**

`frontend/src/ui/Checkbox.tsx` — the drawn box's `className` becomes:

```tsx
          className={cx(
            "grid h-4 w-4 place-items-center rounded-[5px] border",
            onDark ? "border-white/70 bg-black/30" : "border-control-line bg-field",
            "peer-hover:border-accent",
            "peer-checked:border-accent peer-checked:bg-accent peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
            onDark ? "peer-focus-visible:ring-offset-black/40" : "peer-focus-visible:ring-offset-bg",
            "peer-disabled:opacity-45",
            "peer-active:scale-90 motion-reduce:peer-active:scale-100",
            transition,
          )}
```

and the tick `Icon` className becomes `"scale-50 text-accent-fg opacity-0 transition-[transform,opacity] duration-fast ease-out [stroke-width:3] motion-reduce:transition-none"`.

`frontend/src/ui/Switch.tsx` — the whole return becomes:

```tsx
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex items-center gap-2 rounded-control text-sm text-ink disabled:pointer-events-none disabled:opacity-45",
        focusRing,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative h-[18px] w-8 shrink-0 rounded-chip",
          checked ? "bg-accent" : "bg-surface-2 ring-1 ring-inset ring-control-line group-hover:bg-hover",
          transition,
        )}
      >
        <span
          data-part="thumb"
          className={cx(
            "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-ink shadow-elev-1",
            "transition-transform duration-base ease-out motion-reduce:transition-none",
            checked && "translate-x-3.5",
          )}
        />
      </span>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </button>
  );
```

`frontend/src/ui/Field.tsx` — the label becomes `className="text-xs font-medium text-muted"` (the mockup's `.lbl`), the hint `className="text-xs leading-relaxed text-muted"`, the error `className="text-xs text-danger"` (unchanged).

`frontend/src/ui/Kbd.tsx`:

```tsx
import type { ReactNode } from "react";
import { cx } from "./tokens";

/** A key cap (mockup kbd): mono, a 2px bottom edge. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-b-2 border-line-strong bg-hover px-1 font-mono text-2xs text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
```

`frontend/src/ui/Pill.tsx` — the tone type and map, and the size strings:

```tsx
export type PillTone = "neutral" | "ok" | "warn" | "danger" | "accent" | "info" | "inverse";

const TONE: Record<PillTone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent-ink",
  info: "bg-info/15 text-info",
  // Kept for existing callers: the tooltip surface.
  inverse: "bg-tip text-tip-fg",
};
```

with the container `"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip font-medium"` and sizes `size === "sm" ? "h-[18px] px-1.5 text-2xs" : "h-[22px] px-2.5 text-xs"`.

`frontend/src/ui/Alert.tsx` — the tone map and the box:

```tsx
const TONE: Record<AlertTone, { box: string; icon: IconName; iconColor: string }> = {
  info: { box: "border-line bg-surface text-ink", icon: "info", iconColor: "text-info" },
  ok: { box: "border-ok/25 bg-ok-soft text-ink", icon: "check", iconColor: "text-ok" },
  warn: { box: "border-warn/30 bg-warn-soft text-ink", icon: "warning", iconColor: "text-warn" },
  danger: { box: "border-danger/30 bg-danger-soft text-ink", icon: "warning", iconColor: "text-danger" },
};
```

and the container class `"flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-sm animate-reveal motion-reduce:animate-none"`.

- [ ] **Step 7: Export `lift`** — in `frontend/src/ui/index.ts` the last line becomes `export { cx, focusRing, lift, pressable, transition } from "./tokens";`.

- [ ] **Step 8: Gallery section** — `frontend/src/ui/gallery/sections/Controls.tsx`:

```tsx
import { useState } from "react";
import { Alert, Button, Checkbox, Field, IconButton, Input, Kbd, Pill, Select, Switch, Textarea } from "@/ui";

export const title = "Controls";
export const order = 20;

export default function ControlsSection() {
  const [suggestions, setSuggestions] = useState(true);
  const [reviewed, setReviewed] = useState(true);
  return (
    <div className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="plus">
          Add data
        </Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button size="sm">Small</Button>
        <IconButton icon="settings" label="Settings" />
        <Button disabled>Disabled</Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Project name" htmlFor="g-name" hint="Shown in the rail and on reports.">
          <Input id="g-name" placeholder="North quarry" />
        </Field>
        <Field label="Folder" htmlFor="g-folder" error="Choose an empty folder">
          <Input id="g-folder" invalid defaultValue="D:/Sites/north" />
        </Field>
        <Field label="Model" htmlFor="g-model">
          <Select id="g-model">
            <option>yolo11s</option>
            <option>yolo11m</option>
          </Select>
        </Field>
        <Field label="Note" htmlFor="g-note">
          <Textarea id="g-note" rows={3} placeholder="What did you see?" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Checkbox label="Reviewed only" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        <Switch checked={suggestions} onChange={setSuggestions} label="Show suggestions" />
        <span className="flex items-center gap-1 text-sm text-muted">
          Palette <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill>neutral</Pill>
        <Pill tone="accent" live>
          running
        </Pill>
        <Pill tone="ok" dot>
          done
        </Pill>
        <Pill tone="warn">warning</Pill>
        <Pill tone="danger">failed</Pill>
        <Pill tone="info">reviewed</Pill>
        <Pill tone="inverse">inverse</Pill>
      </div>
      <div className="grid gap-2">
        <Alert title="Import finished">1,204 photos are ready.</Alert>
        <Alert tone="ok">Saved.</Alert>
        <Alert tone="warn">2 files had no GPS position.</Alert>
        <Alert tone="danger" title="Couldn't open the project">
          The folder is read-only.
        </Alert>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Button.test.tsx src/ui/Controls.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 10: Visual check**

Run `node frontend/scripts/gallery-shots.mjs controls`. Against `visual-directions.html` tab D and `ws-images.html`: the primary button is the violet → indigo gradient with the soft violet glow and white 600-weight label, 34 px tall, 10 px radius (`.btn.pri`); secondary buttons are translucent with a hairline border; fields sit on the 6% white field with an 8% border and a violet focus ring (tab into one in the browser); the switch matches `.sw` (violet track when on, white thumb); `Kbd` has the 2 px bottom edge in mono; pills are full-radius chips. In `controls-reduced.png` the primary button has no glow.

- [ ] **Step 11: Commit**

```powershell
git add frontend/src/ui/tokens.ts frontend/src/ui/Button.tsx frontend/src/ui/Button.test.tsx frontend/src/ui/Input.tsx frontend/src/ui/Checkbox.tsx frontend/src/ui/Switch.tsx frontend/src/ui/Field.tsx frontend/src/ui/Kbd.tsx frontend/src/ui/Pill.tsx frontend/src/ui/Alert.tsx frontend/src/ui/Controls.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Controls.tsx
git status
git commit -m "feat(ui): Aero glass buttons, fields, checkbox, switch, key caps, pills and alerts" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Feedback — Progress, Skeleton, EmptyState, Toaster, Disclosure, Icon

**Files:**
- Modify: `frontend/src/ui/Progress.tsx` (rewrite), `Skeleton.tsx`, `EmptyState.tsx`, `Toaster.tsx`, `Disclosure.tsx`, `Icon.tsx`
- Create: `frontend/src/ui/Feedback.test.tsx`, `frontend/src/ui/gallery/sections/Feedback.tsx`

**Interfaces:**
- Consumes: `.animate-shimmer`, `.animate-indeterminate` (Task 3).
- Produces: unchanged `Progress`, `Skeleton`, `SkeletonRows`, `EmptyState`, `Toaster`, `Disclosure` APIs; `IconName` gains `catalogue`, `findings`, `measure`, `report`, `overview`, `pin`, `sparkle`, `layers`, `drawing`, `elevation` (`jobs` already exists); `ICON_NAMES: IconName[]` exported from `Icon.tsx` (for the gallery).

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Feedback.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { Icon, ICON_NAMES } from "./Icon";
import { Progress } from "./Progress";
import { Skeleton, SkeletonRows } from "./Skeleton";

const fillOf = (label: string) =>
  screen.getByRole("progressbar", { name: label }).querySelector<HTMLElement>('[data-part="fill"]')!;

describe("Progress", () => {
  it("draws the value with a transform, never a width", () => {
    render(<Progress value={0.3} label="Import" />);
    expect(screen.getByRole("progressbar", { name: "Import" })).toHaveAttribute("aria-valuenow", "30");
    expect(fillOf("Import").style.transform).toBe("translateX(-70%)");
    expect(fillOf("Import").style.width).toBe("");
  });

  it("shimmers only while its work runs", () => {
    const { rerender } = render(<Progress value={0.5} label="Train" />);
    expect(fillOf("Train").className).not.toContain("animate-shimmer");
    rerender(<Progress value={0.5} label="Train" running />);
    expect(fillOf("Train").className).toContain("animate-shimmer");
  });

  it("clamps out-of-range and NaN values", () => {
    render(
      <>
        <Progress value={1.7} label="Over" />
        <Progress value={Number.NaN} label="Broken" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Broken" })).toHaveAttribute("aria-valuenow", "0");
    expect(fillOf("Broken").style.transform).toBe("translateX(-100%)");
  });

  it("has no value when indeterminate and slides instead", () => {
    render(<Progress label="Queued" />);
    expect(screen.getByRole("progressbar", { name: "Queued" })).not.toHaveAttribute("aria-valuenow");
    expect(fillOf("Queued").className).toContain("animate-indeterminate");
  });
});

describe("Skeleton", () => {
  it("keeps the animate-shimmer marker and SkeletonRows announces loading", () => {
    const { container } = render(
      <>
        <Skeleton className="h-4 w-10" />
        <SkeletonRows rows={2} columns={3} />
      </>,
    );
    expect(container.querySelectorAll(".animate-shimmer")).toHaveLength(7);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("teaches the screen and offers the first action", () => {
    render(<EmptyState icon="findings" title="No findings yet" action={<button>Add data</button>} />);
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add data" })).toBeInTheDocument();
  });
});

describe("Icon", () => {
  it.each([
    "catalogue",
    "jobs",
    "findings",
    "measure",
    "report",
    "overview",
    "pin",
    "sparkle",
    "layers",
    "drawing",
    "elevation",
  ] as const)("draws %s", (name) => {
    const { container } = render(<Icon name={name} />);
    expect(container.querySelector(`svg[data-icon="${name}"] path`)?.getAttribute("d")).toMatch(/^M/);
  });

  it("lists every name for the gallery", () => {
    expect(ICON_NAMES).toContain("elevation");
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Feedback.test.tsx`
Expected: FAIL — `ICON_NAMES` is not exported, `[data-part="fill"]` is null, and the new icon names are not in `IconName`.

- [ ] **Step 3: Rewrite `frontend/src/ui/Progress.tsx`**

```tsx
import { cx } from "./tokens";

export interface ProgressProps {
  /** 0 to 1; undefined draws an indeterminate bar. */
  value?: number;
  /** Adds the shimmer: the work behind the bar is running. */
  running?: boolean;
  label?: string;
  className?: string;
  /** 4px instead of 6px. */
  thin?: boolean;
}

/**
 * A job's progress. The fill is a full-width bar moved with translateX (motion stays on transform),
 * shimmering only while `running`; an indeterminate bar slides, and both stop under reduced motion.
 */
export function Progress({ value, running, label, className, thin }: ProgressProps) {
  const indeterminate = value === undefined;
  const pct =
    value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cx("relative w-full overflow-hidden rounded-chip bg-surface-2", thin ? "h-1" : "h-1.5", className)}
    >
      {indeterminate ? (
        <div data-part="fill" className="animate-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-chip bg-accent" />
      ) : (
        <div
          data-part="fill"
          className={cx(
            "absolute inset-0 rounded-chip bg-accent transition-transform duration-base ease-out motion-reduce:transition-none",
            running && "animate-shimmer",
          )}
          style={{ transform: `translateX(${pct - 100}%)` }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Restyle `Skeleton`, `EmptyState`, `Toaster`, `Disclosure`**

`frontend/src/ui/Skeleton.tsx` — the block's class becomes `"rounded-sm bg-surface-2 animate-shimmer"` (the shimmer is now the `translateX` pseudo-element in `ui.css`; drop the `bg-[linear-gradient…]`, `bg-[length…]` and `motion-reduce:animate-none` fragments) and its doc comment "A surface-2 placeholder block with a slow shimmer; size it with `className`." `SkeletonRows` is unchanged.

`frontend/src/ui/EmptyState.tsx` — the container gains `animate-rise motion-reduce:animate-none`, the icon tile becomes `"grid h-11 w-11 place-items-center rounded-control bg-surface-2 text-muted"`, the title `"text-lg text-ink"`.

`frontend/src/ui/Toaster.tsx` — the toast's container class becomes:

```tsx
      className="pointer-events-auto flex min-w-[18rem] max-w-md items-center gap-2.5 rounded-control border border-glass-line bg-tip py-2 pl-3 pr-2 text-sm font-medium text-tip-fg shadow-elev-2 animate-reveal motion-reduce:animate-none"
```

and the badge tones are `"bg-ok text-bg"`, `"bg-danger text-bg"` and `"bg-tip-fg/20"` (Task 2 already renamed `ground`/`inverse`; check the file reads exactly this).

`frontend/src/ui/Disclosure.tsx` — the button's `text-[13px]` becomes `text-sm`; the chevron keeps `duration-fast` (renamed in Task 2).

- [ ] **Step 5: Add the icons** — in `frontend/src/ui/Icon.tsx`:

Add to the `IconName` union: `| "catalogue" | "findings" | "measure" | "report" | "overview" | "pin" | "sparkle" | "layers" | "drawing" | "elevation"`. Add to `PATHS`:

```ts
  // Catalogue: three type tiles and an add mark.
  catalogue: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6",
  // A finding: a flag.
  findings: "M5 21V4M5 4h11l-2 4 2 4H5",
  // Measure: a ruler.
  measure: "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  report: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6",
  // Overview: the dashboard grid.
  overview: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  pin: "M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  // AI provenance.
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z",
  layers: "M12 4 3 8.5l9 4.5 9-4.5L12 4zM3 13l9 4.5 9-4.5",
  // A drawing: a floor plan.
  drawing: "M4 4h16v16H4zM4 10h6v10M10 4v6h10",
  // Elevation: terrain with an up mark.
  elevation: "M3 19 9 11l4 5 3-3 5 6zM17 4v5M15 6l2-2 2 2",
```

After `PATHS`, add:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- a list for the gallery, not a component
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
```

- [ ] **Step 6: Gallery section** — `frontend/src/ui/gallery/sections/Feedback.tsx`:

```tsx
import { Button, Disclosure, EmptyState, Icon, Progress, Skeleton, SkeletonRows, toast } from "@/ui";
import { ICON_NAMES } from "@/ui/Icon";

export const title = "Feedback";
export const order = 30;

export default function FeedbackSection() {
  return (
    <div className="grid max-w-3xl gap-8">
      <div className="grid gap-3">
        <Progress value={0.3} label="Import" />
        <Progress value={0.68} running label="Training" />
        <Progress label="Queued" />
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-8 w-64" />
        <SkeletonRows rows={3} columns={4} />
      </div>
      <EmptyState
        icon="findings"
        title="No findings yet"
        action={
          <Button variant="primary" icon="plus">
            Add data
          </Button>
        }
      >
        Findings appear when a defect is marked on an image, a map or a point cloud.
      </EmptyState>
      <div className="flex gap-2">
        <Button onClick={() => toast("ok", "Saved")}>Toast: ok</Button>
        <Button onClick={() => toast("info", "Visual effects reduced", { label: "Undo", onClick: () => {} })}>
          Toast: with action
        </Button>
        <Button onClick={() => toast("danger", "Couldn't reach the backend")}>Toast: danger</Button>
      </div>
      <Disclosure label="More options" summary="6 settings">
        <p className="text-sm text-muted">Revealed content.</p>
      </Disclosure>
      <div className="grid grid-cols-8 gap-3">
        {ICON_NAMES.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1 text-2xs text-muted">
            <Icon name={name} size={20} className="text-ink" />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

The toasts need a mounted `Toaster`; add `<Toaster />` at the end of `Gallery.tsx`'s outer `div` (import it from `@/ui/Toaster`), since the gallery has no shell.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Feedback.test.tsx src/ui/Toaster.test.tsx src/ui/gallery src/datasets`
Expected: PASS (the `DatasetDetail` test still finds `.animate-shimmer`). Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 8: Visual check**

Run `node frontend/scripts/gallery-shots.mjs feedback`. Against `visual-directions.html` tab D (`.job .bar` and `.sev .track`): 6 px full-radius tracks on the 8% well, violet fill; in the browser the running bar's highlight sweeps (and stops with `?motion=reduced`); the indeterminate bar slides. Every new icon reads at 20 px with the 1.75 stroke of the old set; redraw any that does not before committing. Trigger each toast: dark `#1b1a33` tip surface, 10 px radius, bottom right.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/ui/Progress.tsx frontend/src/ui/Skeleton.tsx frontend/src/ui/EmptyState.tsx frontend/src/ui/Toaster.tsx frontend/src/ui/Disclosure.tsx frontend/src/ui/Icon.tsx frontend/src/ui/Feedback.test.tsx frontend/src/ui/gallery/sections/Feedback.tsx frontend/src/ui/gallery/Gallery.tsx
git status
git commit -m "feat(ui): transform-only progress and shimmer, new icons, restyled feedback" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `useFocusTrap`, the glass `Dialog`, and `Tooltip` with a shortcut

**Files:**
- Create: `frontend/src/ui/useFocusTrap.ts`
- Modify: `frontend/src/ui/Dialog.tsx` (rewrite), `frontend/src/ui/Tooltip.tsx` (rewrite)
- Test: `frontend/src/ui/Dialog.test.tsx`, `frontend/src/ui/Tooltip.test.tsx` (append)
- Create: `frontend/src/ui/gallery/sections/Overlays.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `GlassPanel` (Task 3), `formatChord` (Task 4), `Kbd` (Task 5).
- Produces:
  - `FOCUSABLE: string` (selector), `useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, initialFocus?: RefObject<HTMLElement>): (e: KeyboardEvent<HTMLElement>) => void` — while `active`, focus moves inside (`initialFocus`, else the first focusable, else the container), the returned handler cycles Tab, and focus returns to the previous element when `active` ends or the component unmounts (skipped when that element has left the page).
  - `Dialog`: unchanged props; now a `GlassPanel variant="float"` (`data-glass="float"`), 260 ms pop.
  - `Tooltip`: new optional `shortcut?: string` (a chord, rendered as key caps after the label) and `side` gains `"left"`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/ui/Dialog.test.tsx`:

```tsx
function Vanishing() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && <Button onClick={() => setOpen(true)}>Open</Button>}
      <Dialog open={open} title="Details" onClose={() => setOpen(false)}>
        <p>Body</p>
      </Dialog>
    </>
  );
}

describe("Dialog (Aero glass)", () => {
  it("is a floating glass panel", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(screen.getByRole("dialog", { name: "Import images" })).toHaveAttribute("data-glass", "float");
  });

  it("closes cleanly when its opener has left the page", async () => {
    render(<Vanishing />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

Append to `frontend/src/ui/Tooltip.test.tsx`, inside the `describe`:

```tsx
  it("shows a shortcut as key caps after the label", () => {
    render(
      <Tooltip label="Annotations" shortcut="Shift+H">
        <button>Toggle</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole("button"));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Annotations");
    expect([...tip.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Shift", "H"]);
  });

  it("opens to the left and flips right at the viewport edge", () => {
    render(
      <Tooltip label="Help" side="left">
        <button>Action</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    const rect = vi.spyOn(button.parentElement!, "getBoundingClientRect");
    rect.mockReturnValue({ left: 300, right: 320, top: 100, bottom: 120, width: 20, height: 20 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").style.left).toBe("114px");
    rect.mockReturnValue({ left: 20, right: 40, top: 100, bottom: 120, width: 20, height: 20 } as DOMRect);
    fireEvent.scroll(window);
    expect(screen.getByRole("tooltip").style.left).toBe("46px");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/ui/Dialog.test.tsx src/ui/Tooltip.test.tsx`
Expected: FAIL — no `data-glass` on the dialog, no `kbd` in the tooltip, and `side="left"` falls through to centred placement (`left` is not `114px`).

- [ ] **Step 3: Create `frontend/src/ui/useFocusTrap.ts`**

```ts
import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`: focus moves inside `ref` (`initialFocus`, else the first focusable, else the
 * container), the returned keydown handler keeps Tab inside it, and focus returns to the element that
 * had it once `active` ends or the component unmounts, unless that element has left the page.
 * Shared by Dialog, Popover and CommandPalette.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement>,
): (e: KeyboardEvent<HTMLElement>) => void {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const target = initialFocus?.current ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    return () => {
      const back = opener.current;
      opener.current = null;
      if (back && back.isConnected) back.focus();
    };
  }, [active, ref, initialFocus]);

  return (e) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
```

- [ ] **Step 4: Rewrite `frontend/src/ui/Dialog.tsx`**

```tsx
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { GlassPanel } from "./GlassPanel";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons, right-aligned. */
  footer?: ReactNode;
  width?: "md" | "lg";
  /** A short line under the title. */
  description?: ReactNode;
  /** Forwarded as `data-testid`. */
  testId?: string;
  /** Wrap the body in a form and route submit to this handler; the footer sits inside the form. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * A centred modal on floating glass: focus moves inside on open, Tab cycles within, Escape and a
 * backdrop click close, focus returns to the opener. Enters with a 260 ms pop (--dur-slow).
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = "md",
  description,
  testId,
  onSubmit,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onTab = useFocusTrap(panelRef, open);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    onTab(e);
  };

  const body = (
    <>
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-bg/60 p-4 animate-fade motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <GlassPanel
        ref={panelRef}
        variant="float"
        radius="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          "flex max-h-[calc(100%-2rem)] w-full flex-col text-ink shadow-elev-2 outline-none animate-pop motion-reduce:animate-none",
          width === "lg" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
            {body}
          </form>
        ) : (
          body
        )}
      </GlassPanel>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Rewrite `frontend/src/ui/Tooltip.tsx`**

```tsx
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { formatChord } from "./keymap";
import { Kbd } from "./Kbd";
import { cx } from "./tokens";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  /** A chord ("B", "Shift+H", "Ctrl+K") shown as key caps after the label: "Box · B". */
  shortcut?: string;
  /** Milliseconds before it shows on hover; focus shows it at once. */
  delay?: number;
  className?: string;
}

/** Portal positioning stays outside scroll clipping and follows its anchor without animation. */
function FloatingLabel({
  label,
  shortcut,
  id,
  side,
  anchor,
}: {
  label: ReactNode;
  shortcut?: string;
  id: string;
  side: TooltipSide;
  anchor: React.RefObject<HTMLSpanElement>;
}) {
  const floating = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = floating.current;
    const target = anchor.current;
    if (!element || !target) return;
    const position = () => {
      const rect = target.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const beside = side === "left" || side === "right";
      let left =
        side === "right"
          ? rect.right + 6
          : side === "left"
            ? rect.left - width - 6
            : rect.left + (rect.width - width) / 2;
      let top = beside
        ? rect.top + (rect.height - height) / 2
        : side === "top"
          ? rect.top - height - 6
          : rect.bottom + 6;
      if (side === "right" && left + width > viewportWidth - 8) left = rect.left - width - 6;
      if (side === "left" && left < 8) left = rect.right + 6;
      if (side === "top" && top < 8) top = rect.bottom + 6;
      if (side === "bottom" && top + height > viewportHeight - 8) top = rect.top - height - 6;
      element.style.left = `${Math.max(8, Math.min(left, viewportWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(top, viewportHeight - height - 8))}px`;
      element.style.visibility = "visible";
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(target);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, [anchor, side, label]);
  return createPortal(
    <span
      ref={floating}
      role="tooltip"
      id={id}
      style={{ position: "fixed", visibility: "hidden" }}
      className="pointer-events-none z-50 inline-flex w-max max-w-[calc(100vw-16px)] items-center gap-2 break-words rounded-sm bg-tip px-2 py-1 text-xs font-medium text-tip-fg shadow-elev-2"
    >
      {label}
      {shortcut && (
        <span className="inline-flex items-center gap-0.5">
          {formatChord(shortcut).map((key, i) => (
            <Kbd key={i}>{key}</Kbd>
          ))}
        </span>
      )}
    </span>,
    document.body,
  );
}

/** Disabled controls still receive hover explanations through the wrapping span. */
export function Tooltip({ label, children, side = "top", shortcut, delay = 400, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const focused = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = (immediate: boolean) => {
    clearTimer();
    if (immediate) setOpen(true);
    else
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, delay);
  };
  const hide = () => {
    clearTimer();
    setOpen(false);
  };
  const child = isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, {
        "aria-describedby": open
          ? [children.props["aria-describedby"], id].filter(Boolean).join(" ")
          : children.props["aria-describedby"],
      })
    : children;
  return (
    <span
      ref={anchor}
      className={cx("inline-flex", className)}
      onMouseEnter={() => show(false)}
      onMouseLeave={() => {
        clearTimer();
        if (!focused.current) setOpen(false);
      }}
      onFocus={() => {
        focused.current = true;
        show(true);
      }}
      onBlur={() => {
        focused.current = false;
        hide();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
      aria-describedby={open ? id : undefined}
    >
      {child}
      {open && <FloatingLabel label={label} shortcut={shortcut} id={id} side={side} anchor={anchor} />}
    </span>
  );
}
```

- [ ] **Step 6: Export from the barrel** (alphabetical; `./useFocusTrap` after `./Tooltip`):

```ts
export { Tooltip, type TooltipProps, type TooltipSide } from "./Tooltip";
export { FOCUSABLE, useFocusTrap } from "./useFocusTrap";
```

(replace the existing `export { Tooltip } from "./Tooltip";`).

- [ ] **Step 7: Gallery section** — `frontend/src/ui/gallery/sections/Overlays.tsx`:

```tsx
import { useState } from "react";
import { Button, Dialog, Field, Input, Tooltip } from "@/ui";

export const title = "Overlays";
export const order = 40;

export default function OverlaysSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Tooltip label="Box" shortcut="B" side="right">
        <Button>Right, with a key</Button>
      </Tooltip>
      <Tooltip label="Annotations" shortcut="Shift+H">
        <Button>Top, with a chord</Button>
      </Tooltip>
      <Tooltip label="Opens to the left" side="left">
        <Button>Left</Button>
      </Tooltip>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open a dialog
      </Button>
      <Dialog
        open={open}
        title="New project"
        description="A project holds photos, maps, elevation and point clouds."
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="g-project">
          <Input id="g-project" placeholder="North quarry" />
        </Field>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Dialog.test.tsx src/ui/Tooltip.test.tsx src/ui/Controls.test.tsx src/ui/gallery`
Expected: PASS (the two original Dialog tests, the four original Tooltip tests and the new ones). Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 9: Visual check**

Run `node frontend/scripts/gallery-shots.mjs overlays`, then in the browser open the dialog and hover each tooltip. Against `ws-images.html`: tooltips are the `.tip` (`#1b1a33`, white 11.5 px, small radius, soft shadow) with key caps like `.tool .tip small`; the dialog is frosted glass over a dimmed page with a 16 px radius and pops in (260 ms), and with `?effects=reduced` it is solid `#16172a`. Tab cycles inside the dialog and Esc returns focus to "Open a dialog".

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/ui/useFocusTrap.ts frontend/src/ui/Dialog.tsx frontend/src/ui/Dialog.test.tsx frontend/src/ui/Tooltip.tsx frontend/src/ui/Tooltip.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Overlays.tsx
git status
git commit -m "feat(ui): glass Dialog on a shared focus trap; Tooltip shows shortcuts and opens left" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `FloatingToolbar` and `ToolButton`

**Files:**
- Create: `frontend/src/ui/FloatingToolbar.tsx`, `frontend/src/ui/FloatingToolbar.test.tsx`, `frontend/src/ui/gallery/sections/Toolbar.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `GlassPanel` (3), `useToolShortcuts` (4), `Tooltip` with `shortcut` (7), `Icon`.
- Produces:
  - `interface ToolDef { id: string; icon: IconName; label: string; shortcut?: string; action?: string; active?: boolean; disabled?: boolean; onClick: () => void }` (`action` is the keymap action id; required to bind a global key such as V, H or F)
  - `ToolButton(props: { icon; label; shortcut?; active?; disabled?; onClick; tooltipSide? })` — `aria-pressed`, `aria-keyshortcuts`, tooltip "Label" + key caps
  - `FloatingToolbar(props: { label: string; tools?: readonly ToolDef[]; orientation?: "vertical" | "horizontal"; shortcuts?: boolean; className?: string; children?: ReactNode })` — `role="toolbar"`, glass float, binds the tools' shortcuts while mounted, arrow keys move focus
  - `ToolSeparator(props: { orientation?: "vertical" | "horizontal" })`

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/FloatingToolbar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingToolbar, type ToolDef } from "./FloatingToolbar";

function tools(onBox = vi.fn(), onPan = vi.fn()): ToolDef[] {
  return [
    { id: "select", icon: "fit", label: "Select", shortcut: "V", action: "tool-select", active: true, onClick: vi.fn() },
    { id: "box", icon: "label", label: "Box", shortcut: "B", onClick: onBox },
    { id: "pan", icon: "map", label: "Pan", shortcut: "H", action: "tool-pan", disabled: true, onClick: onPan },
  ];
}

afterEach(() => vi.restoreAllMocks());

describe("FloatingToolbar", () => {
  it("is a labelled glass toolbar whose buttons report their state and keys", () => {
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveAttribute("data-glass", "float");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Box" })).toHaveAttribute("aria-keyshortcuts", "B");
    expect(screen.getByRole("button", { name: "Pan" })).toBeDisabled();
  });

  it("binds the shortcuts while mounted and skips disabled tools", () => {
    const onBox = vi.fn();
    const onPan = vi.fn();
    const { unmount } = render(<FloatingToolbar label="Tools" tools={tools(onBox, onPan)} />);
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "h" });
    expect(onBox).toHaveBeenCalledTimes(1);
    expect(onPan).not.toHaveBeenCalled();
    unmount();
    fireEvent.keyDown(window, { key: "b" });
    expect(onBox).toHaveBeenCalledTimes(1);
  });

  it("names the tool and its key on focus: Box · B", () => {
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    fireEvent.focus(screen.getByRole("button", { name: "Box" }));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Box");
    expect(tip.querySelector("kbd")).toHaveTextContent("B");
  });

  it("moves focus with the arrow keys, skips disabled tools, and keeps the keys from the workspace", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<FloatingToolbar label="Tools" tools={tools()} />);
    const select = screen.getByRole("button", { name: "Select" });
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Box" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Box" }), { key: "ArrowDown" });
    expect(select).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/FloatingToolbar.test.tsx`
Expected: FAIL with `Failed to resolve import "./FloatingToolbar"`.

- [ ] **Step 3: Create `frontend/src/ui/FloatingToolbar.tsx`**

```tsx
import type { KeyboardEvent, ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { useToolShortcuts } from "./keymap";
import { Tooltip, type TooltipSide } from "./Tooltip";
import { cx, disabledClass, focusRing, pressable, transition } from "./tokens";

export interface ToolDef {
  id: string;
  icon: IconName;
  label: string;
  /** A chord from the workspace's keymap entries (ui/keymap.ts). */
  shortcut?: string;
  /** The keymap action this tool performs; required for a global key such as V, H or F. */
  action?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ToolButtonProps {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  tooltipSide?: TooltipSide;
}

/** One tool: the mockup's .tool — muted, the brand gradient with a glow when active. */
export function ToolButton({ icon, label, shortcut, active, disabled, onClick, tooltipSide = "right" }: ToolButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide} delay={250}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active ?? undefined}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          "grid h-9 w-[38px] place-items-center rounded-[9px]",
          active ? "bg-grad-primary text-accent-fg shadow-glow" : "text-muted hover:bg-surface-2 hover:text-ink",
          transition,
          pressable,
          focusRing,
          disabledClass,
        )}
      >
        <Icon name={icon} size={18} />
      </button>
    </Tooltip>
  );
}

export function ToolSeparator({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  return (
    <span
      role="separator"
      aria-orientation={orientation === "vertical" ? "horizontal" : "vertical"}
      className={orientation === "vertical" ? "mx-1.5 my-1 h-px bg-line-strong" : "mx-1 my-1.5 w-px self-stretch bg-line-strong"}
    />
  );
}

export interface FloatingToolbarProps {
  label: string;
  tools?: readonly ToolDef[];
  orientation?: "vertical" | "horizontal";
  /** Bind the tools' shortcuts while mounted (default). */
  shortcuts?: boolean;
  className?: string;
  /** Extra controls after the tools (a zoom readout, a separator). */
  children?: ReactNode;
}

/** A group of tools floating as glass over a work surface (mockup .pal, .zoom). */
export function FloatingToolbar({
  label,
  tools = [],
  orientation = "vertical",
  shortcuts = true,
  className,
  children,
}: FloatingToolbarProps) {
  useToolShortcuts(
    tools.map((t) => ({ shortcut: t.shortcut, action: t.action, onTrigger: t.onClick, disabled: t.disabled })),
    shortcuts,
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const previous = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    if (e.key !== previous && e.key !== next) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[(at + (e.key === next ? 1 : -1) + buttons.length) % buttons.length].focus();
  };
  return (
    <GlassPanel
      variant="float"
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cx(
        "inline-flex gap-0.5 p-[5px] animate-reveal motion-reduce:animate-none",
        orientation === "vertical" ? "flex-col" : "flex-row items-center",
        className,
      )}
    >
      {tools.map((t) => (
        <ToolButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          shortcut={t.shortcut}
          active={t.active}
          disabled={t.disabled}
          onClick={t.onClick}
          tooltipSide={orientation === "vertical" ? "right" : "bottom"}
        />
      ))}
      {children}
    </GlassPanel>
  );
}
```

- [ ] **Step 4: Export from the barrel** (alphabetical, after `./Field`):

```ts
export { FloatingToolbar, ToolButton, ToolSeparator, type ToolDef } from "./FloatingToolbar";
```

- [ ] **Step 5: Gallery section** — `frontend/src/ui/gallery/sections/Toolbar.tsx`:

```tsx
import { useState } from "react";
import { FloatingToolbar, ToolSeparator, type ToolDef } from "@/ui/FloatingToolbar";

export const title = "Toolbar";
export const order = 50;

const TOOLS: Array<Omit<ToolDef, "onClick" | "active">> = [
  { id: "select", icon: "fit", label: "Select", shortcut: "V", action: "tool-select" },
  { id: "pan", icon: "map", label: "Pan", shortcut: "H", action: "tool-pan" },
  { id: "box", icon: "label", label: "Box", shortcut: "B" },
  { id: "rbox", icon: "refresh", label: "Rotated box", shortcut: "R" },
  { id: "polygon", icon: "drawing", label: "Polygon", shortcut: "P" },
  { id: "smart", icon: "sparkle", label: "Smart polygon", shortcut: "S" },
  { id: "marker", icon: "pin", label: "Point marker", shortcut: "M" },
  { id: "length", icon: "measure", label: "Measure length", shortcut: "L" },
  { id: "detect", icon: "detect", label: "AI detect", shortcut: "D" },
];

export default function ToolbarSection() {
  const [tool, setTool] = useState("box");
  const [zoom, setZoom] = useState(100);
  return (
    <div
      className="relative h-[420px] overflow-hidden rounded-panel"
      style={{ background: "radial-gradient(600px 400px at 50% 40%, rgba(143,123,255,.07), transparent 70%), #0a0a16" }}
    >
      <FloatingToolbar
        label="Image tools"
        className="absolute left-3 top-3"
        tools={TOOLS.map((t) => ({ ...t, active: t.id === tool, onClick: () => setTool(t.id) }))}
      />
      <FloatingToolbar
        label="Zoom"
        orientation="horizontal"
        className="absolute right-3 top-3"
        tools={[
          { id: "out", icon: "minus", label: "Zoom out", shortcut: "-", action: "zoom-out", onClick: () => setZoom((z) => Math.max(10, z - 10)) },
          { id: "in", icon: "plus", label: "Zoom in", shortcut: "+", action: "zoom-in", onClick: () => setZoom((z) => z + 10) },
        ]}
      >
        <ToolSeparator orientation="horizontal" />
        <span className="w-11 text-center font-mono text-2xs">{zoom}%</span>
      </FloatingToolbar>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/FloatingToolbar.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 7: Visual check**

Run `node frontend/scripts/gallery-shots.mjs toolbar`, then in the browser press B, R, P, V and `+`/`-` (the active tool and zoom follow), and hover a tool. Against `ws-images.html` `.pal` and `.zoom`: 38 × 36 tools with 9 px radius inside a 5 px-padded glass group; the active tool is the violet → indigo gradient with a violet glow; hover is an 8% white wash; the tooltip reads "Box" with a `B` key cap to the right. In `toolbar-reduced.png` the groups are solid `#16172a`.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/ui/FloatingToolbar.tsx frontend/src/ui/FloatingToolbar.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Toolbar.tsx
git status
git commit -m "feat(ui): FloatingToolbar and ToolButton with bound shortcuts" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `StatTile`, `useCountUp` and `Sparkline`

**Files:**
- Create: `frontend/src/ui/useCountUp.ts`, `frontend/src/ui/Sparkline.tsx`, `frontend/src/ui/StatTile.tsx`, `frontend/src/ui/Stats.test.tsx`, `frontend/src/ui/gallery/sections/Stats.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `cubicBezier`, `dur`, `easing`, `useReducedMotion` (3), `GlassPanel` (3), `.spark-draw` (3).
- Produces:
  - `useCountUp(value: number, duration?: number): number` — the displayed number; animates from 0 on first mount and from the shown value on change, never on a re-render with the same value; reduced motion and non-finite values return `value` at once.
  - `SPARK_MAX = 60`, `sparkPaths(values: readonly number[], width: number, height: number, pad?: number): { line: string; area: string } | null`
  - `Sparkline(props: { values: readonly number[]; width?: number (90); height?: number (32); label?: string; className?: string })`
  - `interface StatDelta { value: number; good: "up" | "down"; label?: string }`, `StatTile(props: { label: ReactNode; value: number | null; unit?: string; delta?: StatDelta; tone?: "default" | "accent" | "ok" | "danger"; spark?: readonly number[]; sparkLabel?: string; chips?: ReactNode; format?: (n: number) => string; icon?: IconName; className?: string })`

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Stats.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARK_MAX, Sparkline, sparkPaths } from "./Sparkline";
import { StatTile } from "./StatTile";
import { useCountUp } from "./useCountUp";

function Counter({ value }: { value: number }) {
  return <output>{Math.round(useCountUp(value))}</output>;
}

function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({ matches: true, media, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useCountUp", () => {
  it("counts up on mount, holds on a re-render, and counts on from the shown value", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { rerender } = render(<Counter value={100} />);
    const shown = () => Number(screen.getByRole("status").textContent);
    expect(shown()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(shown()).toBeGreaterThan(0);
    expect(shown()).toBeLessThan(100);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(shown()).toBe(100);
    rerender(<Counter value={100} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(shown()).toBe(100);
    rerender(<Counter value={150} />);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(shown()).toBeGreaterThanOrEqual(100);
    expect(shown()).toBeLessThan(150);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(shown()).toBe(150);
  });

  it("shows the final value at once under reduced motion", () => {
    reduceMotion();
    render(<Counter value={1284} />);
    expect(screen.getByRole("status")).toHaveTextContent("1284");
  });
});

describe("sparkPaths", () => {
  it("scales the values into the box", () => {
    expect(sparkPaths([0, 10], 100, 20)?.line).toBe("M2 18 L98 2");
  });

  it("keeps at most 60 finite points and survives flat, single and broken data", () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    expect(sparkPaths(many, 90, 32)!.line.split(" L")).toHaveLength(SPARK_MAX);
    expect(sparkPaths([5, 5, 5], 90, 32)!.line).not.toContain("NaN");
    expect(sparkPaths([1, Number.NaN, Infinity, 3], 90, 32)!.line.split(" L")).toHaveLength(2);
    expect(sparkPaths([7], 90, 32)!.line).toBe("M2 16 L88 16");
    expect(sparkPaths([], 90, 32)).toBeNull();
  });
});

describe("Sparkline", () => {
  it("draws in with the clip animation, but not under reduced motion", () => {
    const first = render(<Sparkline values={[1, 3, 2]} label="Open findings, 30 days" />);
    expect(screen.getByRole("img", { name: "Open findings, 30 days" })).toBeInTheDocument();
    expect(first.container.querySelector('[data-part="clip"]')).toHaveClass("spark-draw");
    first.unmount();
    reduceMotion();
    const again = render(<Sparkline values={[1, 3, 2]} />);
    expect(again.container.querySelector('[data-part="clip"]')).not.toHaveClass("spark-draw");
  });

  it("renders nothing without data", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("StatTile", () => {
  it("shows the label, the value, the unit and a delta coloured by what is good", () => {
    reduceMotion();
    render(
      <>
        <StatTile label="Open findings" value={47} delta={{ value: 5, good: "down", label: "vs 7 days ago" }} spark={[1, 2, 3]} />
        <StatTile label="Stockpile volume" value={1234.5} unit="m³" delta={{ value: 120, good: "up" }} />
      </>,
    );
    expect(screen.getByText("Open findings")).toBeInTheDocument();
    expect(screen.getAllByText("47")).toHaveLength(2);
    expect(screen.getByText("▲ 5").className).toContain("text-danger");
    expect(screen.getByText("▲ 120").className).toContain("text-ok");
    expect(screen.getByText("m³")).toBeInTheDocument();
    expect(screen.getAllByText("1,234.5")).toHaveLength(2);
  });

  it("shows a dash, not a count, when there is no value", () => {
    render(<StatTile label="Stockpile volume" value={null} unit="m³" />);
    expect(screen.getByLabelText("No data")).toHaveTextContent("—");
    expect(screen.queryByText("m³")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Stats.test.tsx`
Expected: FAIL with `Failed to resolve import "./Sparkline"`.

- [ ] **Step 3: Create `frontend/src/ui/useCountUp.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import { cubicBezier, dur, easing, useReducedMotion } from "./motion";

const easeOut = cubicBezier(...easing.out);

/**
 * The displayed value of a number counting up to `value` over `duration` (--dur-count): from 0 on
 * first mount, from the shown value when `value` changes, never on a re-render with the same value.
 * Reduced motion and non-finite values show `value` at once. Decorative; it never blocks input.
 */
export function useCountUp(value: number, duration: number = dur.count): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? value : 0));
  const current = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      current.current = value;
      return;
    }
    const from = current.current;
    let frame = 0;
    if (from === value) {
      // Nothing to animate; only bring the state in line (after a reduced-motion toggle).
      frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = from + (value - from) * easeOut(t);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return reduced || !Number.isFinite(value) ? value : shown;
}
```

- [ ] **Step 4: Create `frontend/src/ui/Sparkline.tsx`**

```tsx
/* eslint-disable react-refresh/only-export-components --
   the path helper is exported next to the component for its tests; not a fast-refresh boundary. */
import { useId } from "react";
import { useReducedMotion } from "./motion";
import { cx } from "./tokens";

/** A sparkline draws at most this many points: the last 60 (spec §4.4). */
export const SPARK_MAX = 60;

/** Line and area paths for the last SPARK_MAX finite values, scaled into width × height. */
export function sparkPaths(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): { line: string; area: string } | null {
  const finite = values.filter(Number.isFinite).slice(-SPARK_MAX);
  if (finite.length === 0) return null;
  const pts = finite.length === 1 ? [finite[0], finite[0]] : finite;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min;
  const round = (n: number) => Math.round(n * 100) / 100;
  const x = (i: number) => round(pad + (i * (width - 2 * pad)) / (pts.length - 1));
  const y = (n: number) => round(span === 0 ? height / 2 : pad + ((max - n) * (height - 2 * pad)) / span);
  const line = pts.map((n, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(n)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)} ${height} L${x(0)} ${height} Z`;
  return { line, area };
}

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}

/** An accent line over a faint area (mockup .spark). It draws in by growing a clip rectangle. */
export function Sparkline({ values, width = 90, height = 32, label, className }: SparklineProps) {
  const reduced = useReducedMotion();
  const clipId = `spark-${useId().replace(/:/g, "")}`;
  const paths = sparkPaths(values, width, height);
  if (!paths) return null;
  const latest = values.filter(Number.isFinite).at(-1);
  return (
    <svg
      role="img"
      aria-label={label ?? `Trend, latest ${latest}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("overflow-visible", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect data-part="clip" width={width} height={height} className={reduced ? undefined : "spark-draw"} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path d={paths.area} className="fill-accent opacity-[.12]" />
        <path
          d={paths.line}
          className="fill-none stroke-accent"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
```

- [ ] **Step 5: Create `frontend/src/ui/StatTile.tsx`**

```tsx
import type { ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { Sparkline } from "./Sparkline";
import { cx } from "./tokens";
import { useCountUp } from "./useCountUp";

export interface StatDelta {
  value: number;
  /** Which direction is good: "down" for open findings (fewer is better), "up" for reviewed. */
  good: "up" | "down";
  label?: string;
}

export interface StatTileProps {
  label: ReactNode;
  /** null: no data yet; shows a dash instead of counting to 0. */
  value: number | null;
  unit?: string;
  delta?: StatDelta;
  tone?: "default" | "accent" | "ok" | "danger";
  spark?: readonly number[];
  sparkLabel?: string;
  chips?: ReactNode;
  format?: (n: number) => string;
  icon?: IconName;
  className?: string;
}

const TONE = { default: "text-ink", accent: "text-accent-ink", ok: "text-ok", danger: "text-danger" } as const;

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(2, s.length - dot - 1);
}

function DeltaLine({ delta }: { delta: StatDelta }) {
  const good = delta.value === 0 ? null : (delta.value > 0) === (delta.good === "up");
  const arrow = delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•";
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
      <span className={good === null ? "text-muted" : good ? "text-ok" : "text-danger"}>
        {arrow} {Math.abs(delta.value).toLocaleString()}
      </span>
      {delta.label}
    </p>
  );
}

/** A dashboard figure (mockup .kpi): label, a counting value, a delta, chips and a sparkline. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  tone = "default",
  spark,
  sparkLabel,
  chips,
  format,
  icon,
  className,
}: StatTileProps) {
  const target = value ?? 0;
  const shown = useCountUp(target);
  const digits = decimalsOf(target);
  const fmt =
    format ??
    ((n: number) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return (
    <GlassPanel interactive className={cx("relative min-h-[112px] overflow-hidden px-4 py-3.5", className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </p>
      <p className={cx("mt-2 text-kpi tabular-nums", TONE[tone])}>
        {value === null ? (
          <span aria-label="No data" className="text-dim">
            —
          </span>
        ) : (
          <>
            <span aria-hidden="true">{fmt(shown)}</span>
            <span className="sr-only">{fmt(target)}</span>
          </>
        )}
        {unit && value !== null && (
          <small className="ml-1 text-base font-medium tracking-normal text-muted">{unit}</small>
        )}
      </p>
      {delta && <DeltaLine delta={delta} />}
      {chips && <div className="mt-2 flex flex-wrap gap-1">{chips}</div>}
      {spark && spark.length > 0 && (
        <Sparkline values={spark} label={sparkLabel} className="absolute bottom-3 right-3" />
      )}
    </GlassPanel>
  );
}
```

- [ ] **Step 6: Export from the barrel** (alphabetical):

```ts
export { SPARK_MAX, Sparkline, sparkPaths } from "./Sparkline";
export { StatTile, type StatDelta, type StatTileProps } from "./StatTile";
export { useCountUp } from "./useCountUp";
```

- [ ] **Step 7: Gallery section** — `frontend/src/ui/gallery/sections/Stats.tsx`:

```tsx
import { useState } from "react";
import { Pill } from "@/ui/Pill";
import { StatTile } from "@/ui/StatTile";

export const title = "Stats";
export const order = 60;

const TREND = Array.from({ length: 30 }, (_, i) => 30 + Math.round(12 * Math.sin(i / 4)) + i);

export default function StatsSection() {
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(47);
  return (
    <div className="grid gap-3">
      <div className="flex gap-3 text-sm">
        <button type="button" className="text-accent-ink underline" onClick={() => setRun((r) => r + 1)}>
          Replay (remount)
        </button>
        <button type="button" className="text-accent-ink underline" onClick={() => setOpen((n) => n + 13)}>
          Add 13 open findings
        </button>
      </div>
      <div key={run} className="grid grid-cols-4 gap-3.5">
        <StatTile
          label="Open findings"
          value={open}
          delta={{ value: 5, good: "down", label: "vs 7 days ago" }}
          spark={TREND}
          sparkLabel="Open findings, last 30 days"
        />
        <StatTile label="Critical" value={6} tone="danger" delta={{ value: -3, good: "down", label: "closed this week" }} />
        <StatTile
          label="Project data"
          value={1284}
          unit="images"
          chips={
            <>
              <Pill size="sm">3 maps</Pill>
              <Pill size="sm">2 clouds</Pill>
              <Pill size="sm">1 DSM</Pill>
            </>
          }
        />
        <StatTile label="Stockpile volume" value={12480.5} unit="m³" delta={{ value: 320, good: "up" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Stats.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 9: Visual check**

Run `node frontend/scripts/gallery-shots.mjs stats`, then in the browser press "Replay" and "Add 13 open findings". Against the KPI row of `visual-directions.html` tab D (`.kpi`, `.spark`): 112 px tiles with a 16 px radius and the inset highlight; the value is 30 px Space Grotesk with tight tracking and tabular figures and counts up over 0.6 s, only on mount or change; the delta arrow is danger when the change is bad; the sparkline sits bottom right (90 × 32), violet 2 px line over a 12% fill, drawing in from the left. With `?motion=reduced` values and the sparkline appear at once. Hover lifts a tile 2 px.

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/ui/useCountUp.ts frontend/src/ui/Sparkline.tsx frontend/src/ui/StatTile.tsx frontend/src/ui/Stats.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Stats.tsx
git status
git commit -m "feat(ui): StatTile with count-up and a transform-only Sparkline" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Severity, `StatusDot` and `TypeChip`

**Files:**
- Create: `frontend/src/ui/severityScale.ts`, `frontend/src/ui/Severity.tsx`, `frontend/src/ui/StatusDot.tsx`, `frontend/src/ui/TypeChip.tsx`, `frontend/src/ui/Severity.test.tsx`, `frontend/src/ui/gallery/sections/Severity.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: tokens (1), `focusRing`, `transition` (5).
- Produces:
  - `interface SeverityLevel { level: number; name: string; colour: string }`, `DEFAULT_SEVERITY_SCALE` (1 Minor `#3fb68e`, 2 Moderate `#e2bf2e`, 3 Major `#ff9c3a`, 4 Critical `#ff5a4f`), `SeverityScaleContext` (a React context; SH or S2 provides the loaded scale), `useSeverityScale(): readonly SeverityLevel[]`, `severityOf(scale, level): SeverityLevel | null`
  - `SeverityPill(props: { level: number | null; size?: "sm" | "md"; className?: string })` — `null` → "No severity"; a level missing from the scale → "Level 5 (removed)"
  - `SeverityPicker(props: { value: number | null; onChange: (level: number | null) => void; allowNone?: boolean; label?: string; className?: string })` — radios named `"<level> <name>"` and "None"; while focused, 1–9 set a level in the scale (others pass through), 0 is None when allowed, ← → move
  - `type DotStatus = "open" | "reviewed" | "closed" | "running" | "failed" | "idle"`, `StatusDot(props: { status: DotStatus; live?: boolean; label?: string; className?: string })` — pulses only when `live` and `running`
  - `type TypeKind = "defect" | "object"`, `TypeChip(props: { name: string; colour: string; kind: TypeKind; archived?: boolean; showKind?: boolean; size?: "sm" | "md"; className?: string })`
  - Data colours pass through `style={{ "--c": colour }}` only.

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Severity.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SeverityPicker, SeverityPill } from "./Severity";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext } from "./severityScale";
import { StatusDot } from "./StatusDot";
import { TypeChip } from "./TypeChip";

describe("SeverityPill", () => {
  it("names the level and carries its colour in --c", () => {
    render(<SeverityPill level={3} />);
    expect(screen.getByText("Major").style.getPropertyValue("--c")).toBe("#ff9c3a");
  });

  it("says No severity for null and marks a level the scale no longer has", () => {
    render(
      <>
        <SeverityPill level={null} />
        <SeverityPill level={5} />
      </>,
    );
    expect(screen.getByText("No severity")).toBeInTheDocument();
    expect(screen.getByText("Level 5 (removed)")).toBeInTheDocument();
  });

  it("reads a custom scale from the provider", () => {
    render(
      <SeverityScaleContext.Provider value={[...DEFAULT_SEVERITY_SCALE, { level: 5, name: "Urgent", colour: "#ff00aa" }]}>
        <SeverityPill level={5} />
      </SeverityScaleContext.Provider>,
    );
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });
});

function Host({ allowNone = false }: { allowNone?: boolean }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <SeverityPicker value={value} onChange={setValue} allowNone={allowNone} />
      <p data-testid="value">{value ?? "none"}</p>
    </>
  );
}

describe("SeverityPicker", () => {
  it("sets the level with 1–9 while focused, ignores digits beyond the scale, and keeps its keys", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    const minor = screen.getByRole("radio", { name: "1 Minor" });
    expect(minor).toHaveAttribute("tabindex", "0");
    minor.focus();
    fireEvent.keyDown(minor, { key: "3" });
    const major = screen.getByRole("radio", { name: "3 Major" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    expect(major).toHaveAttribute("aria-checked", "true");
    expect(major).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    fireEvent.keyDown(major, { key: "7" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    expect(onWindow).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindow);
  });

  it("chooses by click and arrow, and None clears when allowed", async () => {
    render(<Host allowNone />);
    await userEvent.click(screen.getByRole("radio", { name: "2 Moderate" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "2 Moderate" }), { key: "ArrowRight" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(screen.getByTestId("value")).toHaveTextContent("none");
  });
});

describe("StatusDot", () => {
  it("pulses only when live and running", () => {
    render(
      <>
        <StatusDot status="running" live label="Job running" />
        <StatusDot status="open" live label="Open" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Job running" }).className).toContain("animate-pulse-dot");
    expect(screen.getByRole("img", { name: "Open" }).className).not.toContain("animate-pulse-dot");
  });

  it("is decorative without a label and green when idle", () => {
    const { container } = render(<StatusDot status="idle" />);
    const dot = container.firstElementChild!;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.className).toContain("bg-ok");
  });
});

describe("TypeChip", () => {
  it("shows the colour, the name and the kind", () => {
    render(<TypeChip name="Crack" colour="#ff5a4f" kind="defect" />);
    expect(screen.getByText("Crack")).toBeInTheDocument();
    expect(screen.getByText("Defect").className).toContain("text-danger");
  });

  it("marks an archived type for screen readers", () => {
    render(<TypeChip name="Excavator" colour="#8aa4ff" kind="object" archived />);
    expect(screen.getByText("Object").className).toContain("text-info");
    expect(screen.getByText("(archived)")).toHaveClass("sr-only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Severity.test.tsx`
Expected: FAIL with `Failed to resolve import "./Severity"`.

- [ ] **Step 3: Create `frontend/src/ui/severityScale.ts`**

```ts
import { createContext, useContext } from "react";

export interface SeverityLevel {
  level: number;
  name: string;
  /** #rrggbb */
  colour: string;
}

/** D4's default scale (spec §4.1, §7.1). The app-wide scale comes from GET /catalogue/severity. */
export const DEFAULT_SEVERITY_SCALE: readonly SeverityLevel[] = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

/** SH or S2 provides the loaded scale around the app; without a provider the default applies. */
export const SeverityScaleContext = createContext<readonly SeverityLevel[]>(DEFAULT_SEVERITY_SCALE);

export function useSeverityScale(): readonly SeverityLevel[] {
  return useContext(SeverityScaleContext);
}

export function severityOf(scale: readonly SeverityLevel[], level: number | null): SeverityLevel | null {
  return level === null ? null : (scale.find((s) => s.level === level) ?? null);
}
```

- [ ] **Step 4: Create `frontend/src/ui/Severity.tsx`**

```tsx
import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { severityOf, useSeverityScale, type SeverityLevel } from "./severityScale";
import { cx, focusRing, transition } from "./tokens";

/** A colour from data travels only as --c on a style prop (spec §4.5). */
const colourVar = (colour: string) => ({ "--c": colour }) as CSSProperties;

export interface SeverityPillProps {
  level: number | null;
  size?: "sm" | "md";
  className?: string;
}

/** A severity: dot and name on a tint of its colour. */
export function SeverityPill({ level, size = "md", className }: SeverityPillProps) {
  const s = severityOf(useSeverityScale(), level);
  const text = level === null ? "No severity" : s ? s.name : `Level ${level} (removed)`;
  return (
    <span
      data-level={level ?? "none"}
      style={s ? colourVar(s.colour) : undefined}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip font-semibold",
        size === "sm" ? "h-[18px] px-1.5 text-2xs" : "h-[22px] px-2.5 text-xs",
        s ? "bg-[color:color-mix(in_srgb,var(--c)_18%,transparent)] text-ink" : "bg-surface-2 text-muted",
        className,
      )}
    >
      {s && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[color:var(--c)]" />}
      {text}
    </span>
  );
}

export interface SeverityPickerProps {
  value: number | null;
  onChange: (level: number | null) => void;
  /** Adds a "None" option (catalogue default severity). */
  allowNone?: boolean;
  label?: string;
  className?: string;
}

/**
 * The inspector's severity grid (ws-images .sevseg), four tiles per row. While focused, 1–9 choose a
 * level in the scale (digits beyond it pass through untouched), 0 chooses None when allowed, ← → move.
 */
export function SeverityPicker({ value, onChange, allowNone = false, label = "Severity", className }: SeverityPickerProps) {
  const scale = useSeverityScale();
  const group = useRef<HTMLDivElement>(null);
  const options: Array<SeverityLevel | null> = allowNone ? [...scale, null] : [...scale];
  const levelOf = (o: SeverityLevel | null) => o?.level ?? null;
  const checked = options.findIndex((o) => levelOf(o) === value);

  const choose = (next: number | null) => {
    onChange(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-level="${next ?? "none"}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let next: number | null;
    if (/^[1-9]$/.test(e.key)) {
      const level = Number(e.key);
      if (!scale.some((s) => s.level === level)) return;
      next = level;
    } else if (e.key === "0" && allowNone) {
      next = null;
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = e.key === "ArrowRight" ? 1 : -1;
      next = levelOf(options[(Math.max(0, checked) + step + options.length) % options.length]);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    choose(next);
  };

  return (
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx("grid grid-cols-4 gap-1", className)}>
      {options.map((s, i) => {
        const on = levelOf(s) === value;
        const tabIndex = (checked < 0 ? i === 0 : on) ? 0 : -1;
        if (!s) {
          return (
            <button
              key="none"
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={tabIndex}
              data-level="none"
              onClick={() => choose(null)}
              className={cx(
                "col-span-4 h-8 rounded-[9px] border text-xs font-semibold",
                on ? "border-line-strong bg-surface-2 text-ink" : "border-line bg-field text-muted hover:text-ink",
                transition,
                focusRing,
              )}
            >
              None
            </button>
          );
        }
        return (
          <button
            key={s.level}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${s.level} ${s.name}`}
            tabIndex={tabIndex}
            data-level={s.level}
            style={colourVar(s.colour)}
            onClick={() => choose(s.level)}
            className={cx(
              "flex h-[42px] flex-col items-center justify-center gap-px rounded-[9px] border text-xs font-semibold",
              on
                ? "-translate-y-px border-[color:var(--c)] bg-[color:var(--c)] text-bg shadow-[0_6px_18px_color-mix(in_srgb,var(--c)_45%,transparent)]"
                : "border-line bg-field text-muted hover:border-[color:var(--c)] hover:text-ink",
              transition,
              focusRing,
            )}
          >
            <span className="font-mono text-[13px]">{s.level}</span>
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create `frontend/src/ui/StatusDot.tsx` and `frontend/src/ui/TypeChip.tsx`**

```tsx
import { cx } from "./tokens";

/** Finding statuses, job states and the top bar's idle project (spec §4.1 status colours). */
export type DotStatus = "open" | "reviewed" | "closed" | "running" | "failed" | "idle";

const TONE: Record<DotStatus, string> = {
  open: "bg-accent ring-accent/25",
  reviewed: "bg-info ring-info/25",
  closed: "bg-ok ring-ok/25",
  idle: "bg-ok ring-ok/25",
  running: "bg-accent ring-accent/25",
  failed: "bg-danger ring-danger/25",
};

export interface StatusDotProps {
  status: DotStatus;
  /** Pulses, but only while `status` is running (a loop only while work runs). */
  live?: boolean;
  /** An accessible name; without one the dot is decorative (put the status in text beside it). */
  label?: string;
  className?: string;
}

export function StatusDot({ status, live = false, label, className }: StatusDotProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-status={status}
      className={cx(
        "inline-block h-2 w-2 shrink-0 rounded-full ring-[3px]",
        TONE[status],
        live && status === "running" && "animate-pulse-dot motion-reduce:animate-none",
        className,
      )}
    />
  );
}
```

```tsx
import type { CSSProperties } from "react";
import { cx } from "./tokens";

export type TypeKind = "defect" | "object";

export interface TypeChipProps {
  name: string;
  /** #rrggbb from the catalogue; travels as --c. */
  colour: string;
  kind: TypeKind;
  archived?: boolean;
  showKind?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** A catalogue type (ws-images .type): colour square, name, and the Defect or Object tag. */
export function TypeChip({ name, colour, kind, archived = false, showKind = true, size = "md", className }: TypeChipProps) {
  return (
    <span
      style={{ "--c": colour } as CSSProperties}
      className={cx("inline-flex min-w-0 items-center gap-2", size === "sm" ? "text-xs" : "text-sm", archived && "opacity-60", className)}
    >
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[color:var(--c)] shadow-[0_0_10px_var(--c)]" />
      <span className="min-w-0 truncate font-semibold text-ink">{name}</span>
      {archived && <span className="sr-only">(archived)</span>}
      {showKind && (
        <span
          className={cx(
            "shrink-0 rounded-chip px-2 text-2xs font-semibold",
            kind === "defect" ? "bg-danger-soft text-danger" : "bg-info/15 text-info",
          )}
        >
          {kind === "defect" ? "Defect" : "Object"}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Export from the barrel** (alphabetical):

```ts
export { SeverityPicker, SeverityPill, type SeverityPickerProps, type SeverityPillProps } from "./Severity";
export {
  DEFAULT_SEVERITY_SCALE,
  SeverityScaleContext,
  severityOf,
  useSeverityScale,
  type SeverityLevel,
} from "./severityScale";
export { StatusDot, type DotStatus } from "./StatusDot";
export { TypeChip, type TypeKind } from "./TypeChip";
```

- [ ] **Step 7: Gallery section** — `frontend/src/ui/gallery/sections/Severity.tsx`:

```tsx
import { useState } from "react";
import { SeverityPicker, SeverityPill } from "@/ui/Severity";
import { StatusDot } from "@/ui/StatusDot";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Severity and status";
export const order = 70;

export default function SeveritySection() {
  const [level, setLevel] = useState<number | null>(3);
  const [fallback, setFallback] = useState<number | null>(null);
  return (
    <div className="grid max-w-xl gap-6">
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((l) => (
          <SeverityPill key={l} level={l} />
        ))}
        <SeverityPill level={null} />
        <SeverityPill level={5} />
      </div>
      <div className="w-[292px]">
        <SeverityPicker value={level} onChange={setLevel} />
      </div>
      <div className="w-[292px]">
        <SeverityPicker label="Default severity" value={fallback} onChange={setFallback} allowNone />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {(["open", "reviewed", "closed", "idle", "failed"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <StatusDot status={s} />
            {s}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <StatusDot status="running" live />
          running (live)
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <TypeChip name="Crack" colour="#ff5a4f" kind="defect" />
        <TypeChip name="Spalling" colour="#ff9c3a" kind="defect" />
        <TypeChip name="Excavator" colour="#8aa4ff" kind="object" />
        <TypeChip name="Old truck" colour="#a7a6c4" kind="object" archived />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Severity.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 9: Visual check**

Run `node frontend/scripts/gallery-shots.mjs severity-and-status`. Against `ws-images.html` (`.sevseg`, `.type`, `.tag`, `.st i`) and the Recent findings rows in `visual-directions.html` (`.sevp`): four 42 px tiles with the mono digit over the name; the chosen tile fills with its colour (Minor green, Moderate yellow, Major orange, Critical red), dark text, a coloured glow and a 1 px lift; pills are tinted; the Defect tag is pink on pink-soft, Object blue on blue-soft; only the live running dot blinks. Focus the picker in the browser and press 1 to 4.

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/ui/severityScale.ts frontend/src/ui/Severity.tsx frontend/src/ui/StatusDot.tsx frontend/src/ui/TypeChip.tsx frontend/src/ui/Severity.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Severity.tsx
git status
git commit -m "feat(ui): severity pill and picker on a scale context, StatusDot and TypeChip" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `Tabs` with a sliding indicator, and the `Segmented` thumb

**Files:**
- Create: `frontend/src/ui/useSlidingIndicator.ts`, `frontend/src/ui/Tabs.tsx`, `frontend/src/ui/Tabs.test.tsx`, `frontend/src/ui/gallery/sections/Tabs.tsx`
- Modify: `frontend/src/ui/Segmented.tsx` (rewrite), `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `transition`, `focusRing` (5); react-router-dom `Link`, `useLocation`, `useMatch`, `useResolvedPath`.
- Produces:
  - `INDICATOR_BASE = 100`, `useSlidingIndicator(listRef, indicatorRef, activeKey: string | null | undefined, mode: "scale" | "width"): void` — follows the element marked `data-indicator-target="true"` inside the list.
  - `interface TabItem { id: string; label: ReactNode; count?: number | null; to?: string; end?: boolean; disabled?: boolean }`, `Tabs(props: { items: readonly TabItem[]; label: string; value?: string; onChange?: (id: string) => void; asLinks?: boolean; className?: string })` — `role="tablist"`, roving focus (← → Home End, disabled skipped), mono count badge, `--grad-ink` indicator sliding over `--dur-emphasis`; `asLinks` renders router `Link`s whose `aria-selected` follows the current route (prefix match unless `end`).
  - `Segmented`: unchanged props; `SegmentedOption` gains `count?: number`; ← → (and ↑ ↓) change the value; the gradient thumb slides.
  - Tab and option elements carry `data-item-id`.

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Tabs.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./Segmented";
import { Tabs, type TabItem } from "./Tabs";

/** jsdom has no layout: give elements with data-item-id an offsetLeft and offsetWidth. */
function geometry(map: Record<string, [number, number]>) {
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return map[this.dataset.itemId ?? ""]?.[0] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return map[this.dataset.itemId ?? ""]?.[1] ?? 0;
  });
}

afterEach(() => vi.restoreAllMocks());

const ITEMS: TabItem[] = [
  { id: "types", label: "Types", count: 12 },
  { id: "severity", label: "Severity" },
  { id: "archived", label: "Archived", disabled: true },
  { id: "log", label: "Log" },
];

function Host() {
  const [value, setValue] = useState("types");
  return <Tabs label="Catalogue" items={ITEMS} value={value} onChange={setValue} />;
}

describe("Tabs", () => {
  it("slides the indicator under the active tab", () => {
    geometry({ types: [0, 90], severity: [120, 80] });
    render(<Host />);
    const bar = screen.getByRole("tablist", { name: "Catalogue" }).querySelector<HTMLElement>('[data-part="indicator"]')!;
    expect(bar.style.transform).toBe("translateX(0px) scaleX(0.9)");
    fireEvent.click(screen.getByRole("tab", { name: "Severity" }));
    expect(bar.style.transform).toBe("translateX(120px) scaleX(0.8)");
  });

  it("roves with the arrows, Home and End, skips disabled tabs, and keeps the keys from the workspace", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    const types = screen.getByRole("tab", { name: /Types/ });
    expect(types).toHaveAttribute("aria-selected", "true");
    expect(types).toHaveAttribute("tabindex", "0");
    types.focus();
    fireEvent.keyDown(types, { key: "ArrowRight" });
    const severity = screen.getByRole("tab", { name: "Severity" });
    expect(severity).toHaveFocus();
    expect(severity).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(severity, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Log" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(types).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Log" })).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("shows the count badge in mono", () => {
    render(<Host />);
    expect(screen.getByText("12").className).toContain("font-mono");
  });

  it("as links, marks the tab of the current route", () => {
    render(
      <MemoryRouter initialEntries={["/p/1/findings/abc"]}>
        <Tabs
          asLinks
          label="Project"
          items={[
            { id: "overview", label: "Overview", to: "/p/1/overview" },
            { id: "findings", label: "Findings", to: "/p/1/findings", count: 47 },
          ]}
        />
      </MemoryRouter>,
    );
    const findings = screen.getByRole("tab", { name: /Findings/ });
    expect(findings).toHaveAttribute("aria-selected", "true");
    expect(findings).toHaveAttribute("href", "/p/1/findings");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("Segmented", () => {
  it("slides its thumb to the checked option and changes with the arrow keys", () => {
    geometry({ grid: [3, 60], map: [65, 50] });
    function View() {
      const [value, setValue] = useState<"grid" | "map">("grid");
      return (
        <Segmented
          label="View"
          value={value}
          onChange={setValue}
          options={[
            { value: "grid", label: "Grid" },
            { value: "map", label: "Map", count: 3 },
          ]}
        />
      );
    }
    render(<View />);
    const thumb = screen.getByRole("radiogroup", { name: "View" }).querySelector<HTMLElement>('[data-part="thumb"]')!;
    expect(thumb.style.width).toBe("60px");
    expect(thumb.style.transform).toBe("translateX(3px)");
    const grid = screen.getByRole("radio", { name: "Grid" });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const map = screen.getByRole("radio", { name: /Map/ });
    expect(map).toHaveAttribute("aria-checked", "true");
    expect(map).toHaveFocus();
    expect(thumb.style.transform).toBe("translateX(65px)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Tabs.test.tsx`
Expected: FAIL with `Failed to resolve import "./Tabs"`.

- [ ] **Step 3: Create `frontend/src/ui/useSlidingIndicator.ts`**

```ts
import { useLayoutEffect, type RefObject } from "react";

/** The indicator's CSS width in px (`w-[100px]`); the `scale` mode scales it to the target. */
export const INDICATOR_BASE = 100;

/**
 * Places `indicatorRef` under the element in `listRef` marked `data-indicator-target="true"`.
 * `scale` (Tabs): translateX plus scaleX of a 100 px bar. `width` (Segmented): translateX, and the
 * width snaps. Written straight to the DOM, not to state. Re-measures on resize and once the web fonts
 * have loaded (a width measured with the fallback font is wrong). The first placement never slides:
 * `data-ready`, which enables the transition, is set on the next frame.
 */
export function useSlidingIndicator(
  listRef: RefObject<HTMLElement>,
  indicatorRef: RefObject<HTMLElement>,
  activeKey: string | null | undefined,
  mode: "scale" | "width",
): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    const bar = indicatorRef.current;
    if (!list || !bar) return;
    let live = true;
    const place = () => {
      if (!live) return;
      const target = list.querySelector<HTMLElement>('[data-indicator-target="true"]');
      if (!target) {
        bar.style.opacity = "0";
        return;
      }
      const x = target.offsetLeft;
      const w = target.offsetWidth;
      bar.style.opacity = "1";
      if (mode === "scale") {
        bar.style.transform = `translateX(${x}px) scaleX(${w / INDICATOR_BASE})`;
      } else {
        bar.style.width = `${w}px`;
        bar.style.transform = `translateX(${x}px)`;
      }
    };
    place();
    const frame = requestAnimationFrame(() => {
      bar.dataset.ready = "true";
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(list);
    void document.fonts?.ready.then(place);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [listRef, indicatorRef, activeKey, mode]);
}
```

- [ ] **Step 4: Create `frontend/src/ui/Tabs.tsx`**

```tsx
import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useMatch, useResolvedPath } from "react-router-dom";
import { cx, focusRing, transition } from "./tokens";
import { useSlidingIndicator } from "./useSlidingIndicator";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A badge in mono; null or undefined shows none. */
  count?: number | null;
  /** Link mode: the route. */
  to?: string;
  /** Link mode: only an exact match is active. */
  end?: boolean;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  label: string;
  /** Button mode: the active tab id. */
  value?: string;
  onChange?: (id: string) => void;
  /** Render router links; the active tab follows the route. */
  asLinks?: boolean;
  className?: string;
}

const tabClass = (on: boolean) =>
  cx(
    "relative flex items-center gap-1.5 whitespace-nowrap rounded-t-sm px-3 py-[11px] text-sm",
    on ? "font-semibold text-ink" : "text-muted hover:text-ink",
    "aria-disabled:pointer-events-none aria-disabled:opacity-45",
    transition,
    focusRing,
  );

function Count({ n }: { n?: number | null }) {
  if (n === null || n === undefined) return null;
  return <span className="rounded-chip bg-surface-2 px-1.5 font-mono text-2xs text-muted">{n.toLocaleString()}</span>;
}

/** ← → Home End move focus between enabled tabs and call `activate` with the new one. */
function rove(e: KeyboardEvent<HTMLElement>, list: HTMLElement | null, activate: (el: HTMLElement) => void) {
  const tabs = Array.from(list?.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])') ?? []);
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const next =
    e.key === "ArrowRight"
      ? tabs[(at + 1) % tabs.length]
      : e.key === "ArrowLeft"
        ? tabs[(at - 1 + tabs.length) % tabs.length]
        : e.key === "Home"
          ? tabs[0]
          : e.key === "End"
            ? tabs[tabs.length - 1]
            : null;
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  next.focus();
  activate(next);
}

function TabList({
  label,
  className,
  listRef,
  barRef,
  onKeyDown,
  children,
}: {
  label: string;
  className?: string;
  listRef: RefObject<HTMLDivElement>;
  barRef: RefObject<HTMLSpanElement>;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("relative flex gap-0.5 border-b border-line", className)}
    >
      {children}
      <span
        ref={barRef}
        aria-hidden="true"
        data-part="indicator"
        className="pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left rounded-chip bg-grad-ink opacity-0 data-[ready=true]:transition-transform data-[ready=true]:duration-emphasis data-[ready=true]:ease-out motion-reduce:transition-none"
      />
    </div>
  );
}

function ButtonTabs({ items, label, value, onChange, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(listRef, barRef, value, "scale");
  const focusable = items.find((t) => t.id === value && !t.disabled)?.id ?? items.find((t) => !t.disabled)?.id;
  return (
    <TabList
      label={label}
      className={className}
      listRef={listRef}
      barRef={barRef}
      onKeyDown={(e) =>
        rove(e, listRef.current, (el) => {
          if (el.dataset.itemId) onChange?.(el.dataset.itemId);
        })
      }
    >
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            tabIndex={t.id === focusable ? 0 : -1}
            data-item-id={t.id}
            data-indicator-target={on ? "true" : undefined}
            onClick={() => onChange?.(t.id)}
            className={tabClass(on)}
          >
            {t.label}
            <Count n={t.count} />
          </button>
        );
      })}
    </TabList>
  );
}

function LinkTab({ item }: { item: TabItem }) {
  const resolved = useResolvedPath(item.to ?? ".");
  const on = useMatch({ path: resolved.pathname, end: item.end ?? false }) !== null;
  return (
    <Link
      to={item.to ?? "."}
      role="tab"
      aria-selected={on}
      aria-disabled={item.disabled || undefined}
      tabIndex={on ? 0 : -1}
      data-item-id={item.id}
      data-indicator-target={on ? "true" : undefined}
      onClick={item.disabled ? (e) => e.preventDefault() : undefined}
      className={tabClass(on)}
    >
      {item.label}
      <Count n={item.count} />
    </Link>
  );
}

function LinkTabs({ items, label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const { pathname } = useLocation();
  useSlidingIndicator(listRef, barRef, pathname, "scale");
  return (
    <TabList
      label={label}
      className={className}
      listRef={listRef}
      barRef={barRef}
      onKeyDown={(e) => rove(e, listRef.current, () => {})}
    >
      {items.map((t) => (
        <LinkTab key={t.id} item={t} />
      ))}
    </TabList>
  );
}

/**
 * Tabs with a sliding `--grad-ink` indicator (mockup .tabs .ink). Button mode activates on arrow keys;
 * link mode (`asLinks`) moves focus and Enter follows the link. Link mode needs a router.
 */
export function Tabs(props: TabsProps) {
  return props.asLinks ? <LinkTabs {...props} /> : <ButtonTabs {...props} />;
}
```

- [ ] **Step 5: Rewrite `frontend/src/ui/Segmented.tsx`**

```tsx
import { useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";
import { cx, focusRing, transition } from "./tokens";
import { useSlidingIndicator } from "./useSlidingIndicator";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** A count after the label, in mono ("Running 3"). */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/** A two-to-five-way switch (mockup .seg): the brand-gradient thumb slides to the chosen option. */
export function Segmented<T extends string>({ options, value, onChange, label, size = "md", className }: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(listRef, thumbRef, value, "width");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(Math.max(0, at) + step + enabled.length) % enabled.length];
    e.preventDefault();
    e.stopPropagation();
    onChange(next.value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-item-id="${next.value}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("relative inline-flex gap-0.5 rounded-[9px] border border-line bg-black/20 p-[3px]", className)}
    >
      <span
        ref={thumbRef}
        aria-hidden="true"
        data-part="thumb"
        className="pointer-events-none absolute bottom-[3px] left-0 top-[3px] rounded-sm bg-grad-primary opacity-0 shadow-[0_4px_14px_rgba(143,123,255,.35)] data-[ready=true]:transition-transform data-[ready=true]:duration-emphasis data-[ready=true]:ease-out motion-reduce:transition-none"
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            data-item-id={o.value}
            data-indicator-target={on ? "true" : undefined}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cx(
              "relative z-10 inline-flex items-center gap-1.5 rounded-sm font-medium",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
              on ? "text-accent-fg" : "text-muted hover:text-ink",
              "disabled:cursor-not-allowed disabled:opacity-40",
              transition,
              focusRing,
            )}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
            {o.count !== undefined && <span className="font-mono text-2xs opacity-80">{o.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Export from the barrel** — replace `export { Segmented } from "./Segmented";` with `export { Segmented, type SegmentedOption, type SegmentedProps } from "./Segmented";` and add (alphabetical):

```ts
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
export { INDICATOR_BASE, useSlidingIndicator } from "./useSlidingIndicator";
```

- [ ] **Step 7: Gallery section** — `frontend/src/ui/gallery/sections/Tabs.tsx`:

```tsx
import { useState } from "react";
import { Segmented } from "@/ui/Segmented";
import { Tabs } from "@/ui/Tabs";

export const title = "Tabs";
export const order = 80;

const PROJECT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "images", label: "Images", count: 1284 },
  { id: "maps", label: "Maps", count: 3 },
  { id: "clouds", label: "Point clouds", count: 2 },
  { id: "findings", label: "Findings", count: 47 },
  { id: "measurements", label: "Measurements" },
  { id: "reports", label: "Reports" },
];

export default function TabsSection() {
  const [tab, setTab] = useState("findings");
  const [status, setStatus] = useState<"open" | "reviewed" | "closed">("open");
  const [view, setView] = useState<"grid" | "map">("grid");
  return (
    <div className="grid gap-6">
      <Tabs label="Project" items={PROJECT_TABS} value={tab} onChange={setTab} />
      <div className="flex flex-wrap gap-4">
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "Open", count: 47 },
            { value: "reviewed", label: "Reviewed", count: 112 },
            { value: "closed", label: "Closed", count: 309 },
          ]}
        />
        <Segmented
          label="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "Grid", icon: "grid" },
            { value: "map", label: "Map", icon: "map" },
          ]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Tabs.test.tsx src/ui/Controls.test.tsx src/ui/gallery`
Expected: PASS (including the two existing Segmented tests in `Controls.test.tsx`). Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 9: Visual check**

Run `node frontend/scripts/gallery-shots.mjs tabs`, then click through the tabs and the segmented controls in the browser. Against `visual-directions.html` tab D (`.tabs`, `.tabs .ink`, `.tabs a .n`) and `ws-images.html` (`.seg`): 13 px muted tabs, the active one white and semibold; the 2 px violet → teal indicator slides over 350 ms and lands exactly under the label (reload the page: it must not slide in from the left on first paint); counts are mono chips; the segmented thumb is the brand gradient with a violet shadow and slides. With `?motion=reduced` the indicator and thumb jump.

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/ui/useSlidingIndicator.ts frontend/src/ui/Tabs.tsx frontend/src/ui/Tabs.test.tsx frontend/src/ui/Segmented.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Tabs.tsx
git status
git commit -m "feat(ui): Tabs with a sliding indicator and roving focus; Segmented gets a sliding thumb" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `Popover`, `Menu` and `MenuButton`

**Files:**
- Create: `frontend/src/ui/floating.ts`, `frontend/src/ui/Popover.tsx`, `frontend/src/ui/Menu.tsx`, `frontend/src/ui/Popover.test.tsx`, `frontend/src/ui/gallery/sections/Popover.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `GlassPanel` (3), `formatChord` (4), `Button`, `IconButton`, `Kbd` (5), `useFocusTrap` (7).
- Produces:
  - `type Side = "top" | "bottom" | "left" | "right"`, `type Align = "start" | "center" | "end"`, `interface AnchorRect { left; top; right; bottom; width; height }`, `placeFloating(anchor: AnchorRect, size: { width; height }, side: Side, align: Align, viewport: { width; height }, gap = 6, margin = 8): { left: number; top: number; side: Side }` — flips to the opposite side when only that one fits; clamps into the viewport.
  - `Popover(props: { open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement>; label: string; children: ReactNode; side?: Side; align?: Align; role?: "dialog" | "menu"; initialFocusRef?: RefObject<HTMLElement>; className?: string })` — a portal glass float, fixed-positioned by `placeFloating`, focus-trapped, Esc and an outside press close it, focus returns to the anchor.
  - `interface MenuItem { id: string; label: string; icon?: IconName; hint?: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }`, `Menu(props: { open; onClose; anchorRef; items: readonly MenuItem[]; label: string; side?; align? })`, `MenuButton(props: ButtonProps-like & { label: string; items: readonly MenuItem[]; menuLabel?: string; iconOnly?: boolean; side?; align? })`.

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Popover.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { placeFloating } from "./floating";
import { MenuButton, type MenuItem } from "./Menu";
import { Popover } from "./Popover";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const VIEW = { width: 1000, height: 800 };

describe("placeFloating", () => {
  it("opens below, aligned to the start", () => {
    expect(placeFloating(rect(100, 100, 80, 30), { width: 200, height: 150 }, "bottom", "start", VIEW)).toEqual({
      left: 100,
      top: 136,
      side: "bottom",
    });
  });

  it("flips above when there is no room below", () => {
    expect(placeFloating(rect(100, 700, 80, 30), { width: 200, height: 150 }, "bottom", "start", VIEW)).toEqual({
      left: 100,
      top: 544,
      side: "top",
    });
  });

  it("aligns to the end and clamps into the viewport", () => {
    expect(placeFloating(rect(900, 100, 80, 30), { width: 200, height: 100 }, "bottom", "end", VIEW).left).toBe(780);
    expect(placeFloating(rect(2, 100, 20, 30), { width: 200, height: 100 }, "bottom", "center", VIEW).left).toBe(8);
  });

  it("opens to the right of a rail entry, centred", () => {
    expect(placeFloating(rect(10, 200, 42, 42), { width: 160, height: 40 }, "right", "center", VIEW)).toEqual({
      left: 58,
      top: 201,
      side: "right",
    });
  });
});

function PopHost() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}>
        Layers
      </button>
      <button>Elsewhere</button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Layer settings">
        <label>
          Opacity <input />
        </label>
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("is anchored glass that takes focus; Esc closes it and returns focus", async () => {
    render(<PopHost />);
    await userEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("dialog", { name: "Layer settings" })).toHaveAttribute("data-glass", "float");
    expect(screen.getByLabelText("Opacity")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Layers" })).toHaveFocus();
  });

  it("closes on an outside press, not on a press inside, and its anchor toggles it", async () => {
    render(<PopHost />);
    const anchor = screen.getByRole("button", { name: "Layers" });
    await userEvent.click(anchor);
    await userEvent.click(screen.getByLabelText("Opacity"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(anchor);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(anchor);
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const items = (onSelect = vi.fn()): MenuItem[] => [
  { id: "photos", label: "Photos", icon: "images", onSelect },
  { id: "drawing", label: "Drawing", icon: "drawing", disabled: true, hint: "Arrives with the Maps workspace", onSelect },
  { id: "cloud", label: "Point cloud", icon: "cloud", shortcut: "Ctrl+Shift+P", onSelect },
];

describe("Menu", () => {
  it("opens from its button, skips disabled items, selects with Enter and returns focus", async () => {
    const onSelect = vi.fn();
    render(<MenuButton label="Add data" items={items(onSelect)} />);
    const button = screen.getByRole("button", { name: "Add data" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Add data" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Photos" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Point cloud/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("wraps ArrowUp to the last enabled item and keeps its keys from the workspace", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<MenuButton label="More" items={items()} />);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Point cloud/ })).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Popover.test.tsx`
Expected: FAIL with `Failed to resolve import "./floating"`.

- [ ] **Step 3: Create `frontend/src/ui/floating.ts`**

```ts
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Where a floating panel of `size` goes next to `anchor`: on `side` if it fits, else on the opposite
 * side if that fits, else on `side` anyway; aligned along the other axis; clamped `margin` px inside
 * the viewport. Pure, so Popover and its tests share it.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  side: Side,
  align: Align,
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): { left: number; top: number; side: Side } {
  const fits = (s: Side) =>
    s === "bottom"
      ? anchor.bottom + gap + size.height <= viewport.height - margin
      : s === "top"
        ? anchor.top - gap - size.height >= margin
        : s === "right"
          ? anchor.right + gap + size.width <= viewport.width - margin
          : anchor.left - gap - size.width >= margin;
  const chosen = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];
  let left: number;
  let top: number;
  if (chosen === "top" || chosen === "bottom") {
    top = chosen === "bottom" ? anchor.bottom + gap : anchor.top - gap - size.height;
    left =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.right - size.width
          : anchor.left + (anchor.width - size.width) / 2;
  } else {
    left = chosen === "right" ? anchor.right + gap : anchor.left - gap - size.width;
    top =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.bottom - size.height
          : anchor.top + (anchor.height - size.height) / 2;
  }
  const clamp = (v: number, limit: number) => Math.max(margin, Math.min(v, limit - margin));
  return {
    left: clamp(left, viewport.width - size.width),
    top: clamp(top, viewport.height - size.height),
    side: chosen,
  };
}
```

- [ ] **Step 4: Create `frontend/src/ui/Popover.tsx`**

```tsx
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placeFloating, type Align, type Side } from "./floating";
import { GlassPanel } from "./GlassPanel";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  /** The panel's accessible name. */
  label: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
  role?: "dialog" | "menu";
  initialFocusRef?: RefObject<HTMLElement>;
  className?: string;
}

function PopoverPanel({
  onClose,
  anchorRef,
  label,
  children,
  side = "bottom",
  align = "start",
  role = "dialog",
  initialFocusRef,
  className,
}: Omit<PopoverProps, "open">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onTab = useFocusTrap(panelRef, true, initialFocusRef);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      const at = placeFloating(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        side,
        align,
        {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: document.documentElement.clientHeight || window.innerHeight,
        },
      );
      panel.style.left = `${at.left}px`;
      panel.style.top = `${at.top}px`;
      panel.dataset.side = at.side;
      panel.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, side, align]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchorRef, onClose]);

  return createPortal(
    <GlassPanel
      ref={panelRef}
      variant="float"
      role={role}
      aria-label={label}
      tabIndex={-1}
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        onTab(e);
      }}
      className={cx(
        "z-50 max-h-[min(70vh,480px)] min-w-[180px] overflow-auto p-1.5 shadow-elev-2 outline-none animate-pop motion-reduce:animate-none",
        className,
      )}
    >
      {children}
    </GlassPanel>,
    document.body,
  );
}

/**
 * An anchored floating glass panel (layer pickers, type pickers, menus): focus-trapped, Escape and a
 * press outside close it, and focus returns to what had it (normally the anchor).
 */
export function Popover({ open, ...rest }: PopoverProps) {
  return open ? <PopoverPanel {...rest} /> : null;
}
```

- [ ] **Step 5: Create `frontend/src/ui/Menu.tsx`**

```tsx
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button, IconButton, type ButtonProps } from "./Button";
import type { Align, Side } from "./floating";
import { Icon, type IconName } from "./Icon";
import { Kbd } from "./Kbd";
import { formatChord } from "./keymap";
import { Popover } from "./Popover";
import { cx, disabledClass } from "./tokens";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** A muted note after the label ("Arrives with the Maps workspace"). */
  hint?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  items: readonly MenuItem[];
  label: string;
  side?: Side;
  align?: Align;
}

function MenuItems({ items, onClose }: { items: readonly MenuItem[]; onClose: () => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown"
        ? buttons[(at + 1) % buttons.length]
        : e.key === "ArrowUp"
          ? buttons[at <= 0 ? buttons.length - 1 : at - 1]
          : e.key === "Home"
            ? buttons[0]
            : e.key === "End"
              ? buttons[buttons.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    next.focus();
  };
  return (
    <div className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={cx(
            "flex h-8 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-sm focus-visible:outline-none",
            item.danger
              ? "text-danger hover:bg-danger-soft focus-visible:bg-danger-soft"
              : "text-ink hover:bg-surface-2 focus-visible:bg-surface-2",
            disabledClass,
          )}
        >
          {item.icon && <Icon name={item.icon} size={15} className="text-muted" />}
          <span className="min-w-0 flex-1 truncate">
            {item.label}
            {item.hint && <span className="ml-2 text-2xs text-muted">{item.hint}</span>}
          </span>
          {item.shortcut && (
            <span className="flex gap-0.5">
              {formatChord(item.shortcut).map((key, i) => (
                <Kbd key={i}>{key}</Kbd>
              ))}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A popover list of actions ("Add data", row actions, overflow tabs). ↑ ↓ Home End move; Enter picks. */
export function Menu({ open, onClose, anchorRef, items, label, side, align = "end" }: MenuProps) {
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} label={label} role="menu" side={side} align={align}>
      <MenuItems items={items} onClose={onClose} />
    </Popover>
  );
}

export interface MenuButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  label: string;
  items: readonly MenuItem[];
  /** The menu's name; defaults to `label`. */
  menuLabel?: string;
  /** An IconButton (overflow "…") instead of a labelled button. */
  iconOnly?: boolean;
  side?: Side;
  align?: Align;
}

/** A button that opens a Menu; ArrowDown opens it from the keyboard. */
export function MenuButton({ label, items, menuLabel, iconOnly = false, icon, side, align, ...button }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const trigger = {
    ref,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
    },
  };
  return (
    <>
      {iconOnly ? (
        <IconButton icon={icon ?? "chevron-down"} label={label} {...button} {...trigger} />
      ) : (
        <Button icon={icon} {...button} {...trigger}>
          {label}
          <Icon name="chevron-down" size={14} className="text-muted" />
        </Button>
      )}
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={ref} items={items} label={menuLabel ?? label} side={side} align={align} />
    </>
  );
}
```

- [ ] **Step 6: Export from the barrel** (alphabetical):

```ts
export { placeFloating, type Align, type AnchorRect, type Side } from "./floating";
export { Menu, MenuButton, type MenuButtonProps, type MenuItem, type MenuProps } from "./Menu";
export { Popover, type PopoverProps } from "./Popover";
```

- [ ] **Step 7: Gallery section** — `frontend/src/ui/gallery/sections/Popover.tsx`:

```tsx
import { useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import { MenuButton } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";

export const title = "Popover and menu";
export const order = 90;

export default function PopoverSection() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <MenuButton
        variant="primary"
        icon="plus"
        label="Add data"
        items={[
          { id: "photos", label: "Photos", icon: "images", onSelect: () => {} },
          { id: "ortho", label: "Orthomosaic (GeoTIFF)", icon: "map", onSelect: () => {} },
          { id: "dsm", label: "Elevation (DSM/DTM)", icon: "elevation", onSelect: () => {} },
          { id: "cloud", label: "Point cloud (LAS/LAZ)", icon: "cloud", onSelect: () => {} },
          { id: "drawing", label: "Drawing", icon: "drawing", disabled: true, hint: "Arrives with the Maps workspace", onSelect: () => {} },
        ]}
      />
      <MenuButton
        iconOnly
        label="Row actions"
        items={[
          { id: "copy", label: "Copy link", icon: "external", shortcut: "Ctrl+Shift+C", onSelect: () => {} },
          { id: "delete", label: "Delete", icon: "trash", danger: true, onSelect: () => {} },
        ]}
      />
      <Button ref={anchor} icon="layers" onClick={() => setOpen((o) => !o)}>
        Layers
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Layer settings" className="w-64 p-3">
        <Field label="Name" htmlFor="g-layer">
          <Input id="g-layer" dense defaultValue="Ortho 2026-09-12" />
        </Field>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Popover.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 9: Visual check**

Run `node frontend/scripts/gallery-shots.mjs popover-and-menu`, then open each in the browser. Against `ws-images.html` (`.menu`, `.mdl`, the model menu of the AI detect tool): a glass panel with a 10 px radius, 32 px rows, a surface-2 wash on hover and keyboard focus, key caps at the right, the disabled Drawing row dimmed with its note; it pops in from 97% scale and opens upward when there is no room below (resize the window to check). Esc returns focus to the button.

- [ ] **Step 10: Commit**

```powershell
git add frontend/src/ui/floating.ts frontend/src/ui/Popover.tsx frontend/src/ui/Menu.tsx frontend/src/ui/Popover.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Popover.tsx
git status
git commit -m "feat(ui): anchored glass Popover, Menu and MenuButton" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `Slider`

**Files:**
- Create: `frontend/src/ui/Slider.tsx`, `frontend/src/ui/Slider.test.tsx`, `frontend/src/ui/gallery/sections/Slider.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `focusRing`, `cx` (5).
- Produces:
  - `interface SliderRange { min: number; max: number; step?: number; stops?: readonly number[] }`
  - `snapValue(raw: number, range: SliderRange): number` — clamps into `[min, max]` (non-finite → `min`), snaps to the nearest stop (stops outside the range are ignored) or to the step grid (default step `(max − min) / 100`), rounding away float noise.
  - `stepValue(value: number, dir: 1 | -1, big: boolean, range: SliderRange): number` — next or previous stop (3 stops when `big`), or ± step (10 steps when `big`).
  - `Slider(props: SliderRange & { label: string; value: number; onChange: (value: number) => void; format?: (value: number) => string; disabled?: boolean; showValue?: boolean; className?: string })` — `role="slider"` with `aria-valuemin|max|now|text`; ← ↓ / → ↑ step, PageUp/PageDown big steps, Home/End ends; the keys it handles never reach window listeners; pointer drag; value in mono.

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Slider.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider, snapValue, stepValue } from "./Slider";

afterEach(() => vi.restoreAllMocks());

describe("snapValue and stepValue", () => {
  it("snaps to the step grid without float noise and clamps", () => {
    expect(snapValue(0.34, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapValue(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapValue(7, { min: 0, max: 5, step: 1 })).toBe(5);
    expect(snapValue(Number.NaN, { min: 2, max: 9, step: 1 })).toBe(2);
  });

  it("snaps to the nearest stop and ignores stops outside the range", () => {
    expect(snapValue(1.4, { min: 0, max: 4, stops: [0.5, 1, 2, 4] })).toBe(1);
    expect(snapValue(3, { min: 0, max: 10, stops: [20, -1] })).toBe(3);
  });

  it("steps through stops and along the grid", () => {
    const stops = { min: 0, max: 4, stops: [0.5, 1, 2, 4] };
    expect(stepValue(1, 1, false, stops)).toBe(2);
    expect(stepValue(4, 1, false, stops)).toBe(4);
    expect(stepValue(2, -1, true, stops)).toBe(0.5);
    expect(stepValue(50, 1, true, { min: 0, max: 100, step: 1 })).toBe(60);
  });
});

function Host(props: { stops?: number[]; onChange?: (v: number) => void }) {
  const [value, setValue] = useState(1);
  return (
    <Slider
      label="Point size"
      min={0}
      max={4}
      step={props.stops ? undefined : 0.5}
      stops={props.stops}
      value={value}
      format={(v) => `${v} px`}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

describe("Slider", () => {
  it("is an accessible slider that steps with the keys and shows its value in mono", () => {
    render(<Host />);
    const slider = screen.getByRole("slider", { name: "Point size" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).toHaveAttribute("aria-valuetext", "1 px");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "1.5");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0 px").className).toContain("font-mono");
  });

  it("walks discrete stops", () => {
    render(<Host stops={[0.5, 1, 2, 4]} />);
    const slider = screen.getByRole("slider", { name: "Point size" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
  });

  it("maps a pointer press on the track to a value", () => {
    const onChange = vi.fn();
    render(<Slider label="Opacity" min={0} max={100} step={1} value={20} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Opacity" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200, top: 0, height: 20 } as DOMRect);
    act(() => {
      slider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 150 }));
    });
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("keeps its keys from the workspace shortcuts", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Point size" }), { key: "ArrowRight" });
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<Slider label="Blend" min={0} max={1} step={0.1} value={0.5} onChange={onChange} disabled />);
    const slider = screen.getByRole("slider", { name: "Blend" });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Slider.test.tsx`
Expected: FAIL with `Failed to resolve import "./Slider"`.

- [ ] **Step 3: Create `frontend/src/ui/Slider.tsx`**

```tsx
/* eslint-disable react-refresh/only-export-components --
   the value helpers are exported next to the component for its tests; not a fast-refresh boundary. */
import { useRef, type KeyboardEvent } from "react";
import { cx, focusRing } from "./tokens";

export interface SliderRange {
  min: number;
  max: number;
  step?: number;
  /** Discrete values to snap to (point budget 0.5 M / 1 M / 2 M / 4 M). */
  stops?: readonly number[];
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.split(".")[1]?.length ?? 0;
}

function bounds(r: SliderRange): [number, number] {
  return [Math.min(r.min, r.max), Math.max(r.min, r.max)];
}

function cleanStops(r: SliderRange): number[] {
  const [lo, hi] = bounds(r);
  const inRange = (r.stops ?? []).filter((s) => Number.isFinite(s) && s >= lo && s <= hi);
  return [...new Set(inRange)].sort((a, b) => a - b);
}

function stepOf(r: SliderRange): number {
  const [lo, hi] = bounds(r);
  return r.step && r.step > 0 ? r.step : (hi - lo) / 100 || 1;
}

export function snapValue(raw: number, r: SliderRange): number {
  const [lo, hi] = bounds(r);
  const v = Math.min(hi, Math.max(lo, Number.isFinite(raw) ? raw : lo));
  const stops = cleanStops(r);
  if (stops.length) return stops.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
  const step = stepOf(r);
  const n = Math.round((v - lo) / step);
  const places = Math.max(decimals(step), decimals(lo));
  return Math.min(hi, Number((lo + n * step).toFixed(places)));
}

export function stepValue(value: number, dir: 1 | -1, big: boolean, r: SliderRange): number {
  const stops = cleanStops(r);
  if (stops.length) {
    const at = stops.indexOf(snapValue(value, r));
    return stops[Math.max(0, Math.min(stops.length - 1, at + dir * (big ? 3 : 1)))];
  }
  return snapValue(value + dir * stepOf(r) * (big ? 10 : 1), r);
}

export interface SliderProps extends SliderRange {
  label: string;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  /** The value in mono beside the track (default). */
  showValue?: boolean;
  className?: string;
}

/**
 * A continuous or stepped slider (opacity, blend, point size, point budget), mockup ws-maps
 * input[type=range]. The fill and thumb move with transforms; keys it handles stay inside it.
 */
export function Slider({
  label,
  min,
  max,
  step,
  stops,
  value,
  onChange,
  format = String,
  disabled = false,
  showValue = true,
  className,
}: SliderProps) {
  const range: SliderRange = { min, max, step, stops };
  const dragging = useRef(false);
  const current = snapValue(value, range);
  const span = max - min || 1;
  const pct = ((current - min) / span) * 100;

  const commit = (next: number) => {
    if (next !== current) onChange(next);
  };
  const fromPointer = (track: HTMLElement, clientX: number) => {
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    commit(snapValue(min + ((clientX - r.left) / r.width) * span, range));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = stepValue(current, 1, false, range);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = stepValue(current, -1, false, range);
        break;
      case "PageUp":
        next = stepValue(current, 1, true, range);
        break;
      case "PageDown":
        next = stepValue(current, -1, true, range);
        break;
      case "Home":
        next = snapValue(min, range);
        break;
      case "End":
        next = snapValue(max, range);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    commit(next);
  };

  return (
    <div className={cx("flex items-center gap-3", className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        aria-valuetext={format(current)}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // No active pointer with that id (a synthetic event); dragging still works while inside.
          }
          fromPointer(e.currentTarget, e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e.currentTarget, e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className={cx(
          "group relative flex h-5 min-w-10 flex-1 cursor-pointer touch-none items-center rounded-chip",
          focusRing,
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span className="relative h-1 w-full overflow-hidden rounded-chip bg-surface-2">
          <span
            data-part="fill"
            className="absolute inset-0 rounded-chip bg-accent"
            style={{ transform: `translateX(${pct - 100}%)` }}
          />
        </span>
        {cleanStops(range).map((s) => (
          <span
            key={s}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-line-strong"
            style={{ left: `${((s - min) / span) * 100}%` }}
          />
        ))}
        <span className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${pct}%)` }}>
          <span
            data-part="thumb"
            className="absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_3px_rgba(143,123,255,.45)] transition-transform duration-fast group-hover:scale-110 motion-reduce:transition-none"
          />
        </span>
      </div>
      {showValue && (
        <output className="min-w-[4ch] text-right font-mono text-2xs tabular-nums text-muted">{format(current)}</output>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Export from the barrel** (alphabetical):

```ts
export { Slider, snapValue, stepValue, type SliderProps, type SliderRange } from "./Slider";
```

- [ ] **Step 5: Gallery section** — `frontend/src/ui/gallery/sections/Slider.tsx`:

```tsx
import { useState } from "react";
import { Slider } from "@/ui/Slider";

export const title = "Slider";
export const order = 100;

const BUDGETS = [500_000, 1_000_000, 2_000_000, 4_000_000];
const millions = (n: number) => `${n / 1_000_000} M`;

export default function SliderSection() {
  const [opacity, setOpacity] = useState(0.8);
  const [blend, setBlend] = useState(0.55);
  const [size, setSize] = useState(2);
  const [budget, setBudget] = useState(2_000_000);
  return (
    <div className="grid max-w-md gap-4">
      <Slider label="Opacity" min={0} max={1} step={0.05} value={opacity} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Blend" min={0} max={1} step={0.01} value={blend} onChange={setBlend} format={(v) => v.toFixed(2)} />
      <Slider label="Point size" min={1} max={6} step={0.5} value={size} onChange={setSize} format={(v) => `${v} px`} />
      <Slider label="Point budget" min={500_000} max={4_000_000} stops={BUDGETS} value={budget} onChange={setBudget} format={millions} />
      <Slider label="Disabled" min={0} max={1} step={0.1} value={0.3} onChange={() => {}} disabled />
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Slider.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 7: Visual check**

Run `node frontend/scripts/gallery-shots.mjs slider`, then drag and key each slider. Against `ws-maps.html` (`input[type=range]` in the blend control): a 4 px track, violet fill to the thumb, a 12 px white thumb with a 3 px violet halo that grows on hover; the value in mono at the right; the budget slider snaps to its four stops (tick marks visible); the thumb follows the pointer without lag.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/ui/Slider.tsx frontend/src/ui/Slider.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Slider.tsx
git status
git commit -m "feat(ui): Slider with steps, discrete stops, keys and pointer drag" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `Combobox`

**Files:**
- Create: `frontend/src/ui/listbox.ts`, `frontend/src/ui/Combobox.tsx`, `frontend/src/ui/Combobox.test.tsx`, `frontend/src/ui/gallery/sections/Combobox.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `Popover` (12), `Input`, `fieldClass`, `Kbd` (5), `Icon`.
- Produces:
  - `useListNavigation(count: number, resetKey: string): { index: number; setIndex(i: number): void; move(e): boolean }` — ↑ ↓ wrap; the index resets to 0 when `resetKey` (the query) changes; `move` returns true when it handled (and stopped) the key.
  - `interface ComboItem { id: string; label: string; icon?: IconName; hint?: string; hotkey?: string | null; colour?: string }`, `filterItems(items, query): ComboItem[]` (case-insensitive substring over label and hint).
  - `ComboboxList(props: { label: string; items: readonly ComboItem[]; value: string | null; onSelect: (id: string) => void; placeholder?: string; emptyText?: string })` — the input (`role="combobox"`) plus listbox, for embedding in a caller's `Popover` (the T type picker, M's and C's type popovers). Catalogue hotkeys fire only while the filter is empty.
  - `Combobox(props: ComboboxList props without onSelect & { onChange: (id: string) => void; disabled?: boolean; triggerPlaceholder?: string; className?: string })` — a field-styled trigger named `"<label>: <choice>"` that opens `ComboboxList` in a `Popover`.

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Combobox.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Combobox, ComboboxList, filterItems, type ComboItem } from "./Combobox";

const ITEMS: ComboItem[] = [
  { id: "crack", label: "Crack", hotkey: "1", colour: "#ff5a4f" },
  { id: "spall", label: "Spalling", hotkey: "2", colour: "#ff9c3a" },
  { id: "rust", label: "Corrosion", hint: "Steel", hotkey: "c", colour: "#e2bf2e" },
];

describe("filterItems", () => {
  it("matches the label and the hint, case-insensitively", () => {
    expect(filterItems(ITEMS, "ST").map((i) => i.id)).toEqual(["rust"]);
    expect(filterItems(ITEMS, "  ")).toHaveLength(3);
  });
});

describe("ComboboxList", () => {
  it("filters, moves with ↓ and picks with Enter", async () => {
    const onSelect = vi.fn();
    render(<ComboboxList label="Type" items={ITEMS} value={null} onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "Type" });
    await userEvent.type(input, "s");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await userEvent.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("rust");
  });

  it("answers catalogue hotkeys only while the filter is empty", async () => {
    const onSelect = vi.fn();
    render(<ComboboxList label="Type" items={ITEMS} value={null} onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "Type" });
    input.focus();
    await userEvent.keyboard("2");
    expect(onSelect).toHaveBeenCalledWith("spall");
    expect(input).toHaveValue("");
    await userEvent.keyboard("r2");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("r2");
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("keeps its keys from the workspace shortcuts", async () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<ComboboxList label="Type" items={ITEMS} value="crack" onSelect={() => {}} />);
    screen.getByRole("combobox", { name: "Type" }).focus();
    await userEvent.keyboard("{ArrowDown}1");
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });
});

describe("Combobox", () => {
  it("shows the choice, opens the picker, closes on a pick and returns focus", async () => {
    function Host() {
      const [value, setValue] = useState<string | null>("crack");
      return <Combobox label="Type" items={ITEMS} value={value} onChange={setValue} />;
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Type: Crack" }));
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveFocus();
    expect(screen.getByRole("option", { name: /Crack/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("2");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Type: Spalling" })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Combobox.test.tsx`
Expected: FAIL with `Failed to resolve import "./Combobox"`.

- [ ] **Step 3: Create `frontend/src/ui/listbox.ts`**

```ts
import { useState } from "react";

interface KeyEventLike {
  key: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * The active option of a listbox driven from a text field (Combobox, CommandPalette). The index goes
 * back to 0 whenever `resetKey` (the query) changes, derived during render rather than set in an
 * effect. ↑ ↓ move and wrap; `move` returns true when it handled (and stopped) the key.
 */
export function useListNavigation(count: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, index: 0 });
  const index = state.key === resetKey ? Math.min(state.index, Math.max(0, count - 1)) : 0;
  const setIndex = (i: number) => setState({ key: resetKey, index: i });
  const move = (e: KeyEventLike): boolean => {
    if (count === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return false;
    e.preventDefault();
    e.stopPropagation();
    setIndex(e.key === "ArrowDown" ? (index + 1) % count : (index - 1 + count) % count);
    return true;
  };
  return { index, setIndex, move };
}
```

- [ ] **Step 4: Create `frontend/src/ui/Combobox.tsx`**

```tsx
/* eslint-disable react-refresh/only-export-components --
   the filter helper is exported next to the component for its tests; not a fast-refresh boundary. */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";
import { fieldClass, Input } from "./Input";
import { Kbd } from "./Kbd";
import { useListNavigation } from "./listbox";
import { Popover } from "./Popover";
import { cx } from "./tokens";

export interface ComboItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  /** A catalogue type hotkey; live only inside this picker, and only while the filter is empty. */
  hotkey?: string | null;
  /** #rrggbb swatch (catalogue types); travels as --c. */
  colour?: string;
}

export function filterItems(items: readonly ComboItem[], query: string): ComboItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? "").toLowerCase().includes(q));
}

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[color:var(--c)]"
      style={{ "--c": colour } as CSSProperties}
    />
  );
}

export interface ComboboxListProps {
  label: string;
  items: readonly ComboItem[];
  value: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
}

/** A filter field over a listbox (the CommandPalette pattern). Embed it in a Popover for a type picker. */
export function ComboboxList({
  label,
  items,
  value,
  onSelect,
  placeholder = "Filter…",
  emptyText = "No matches",
}: ComboboxListProps) {
  const [query, setQuery] = useState("");
  const shown = filterItems(items, query);
  const { index, setIndex, move } = useListNavigation(shown.length, query);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;

  useEffect(() => {
    document.getElementById(`${listId}-o${index}`)?.scrollIntoView?.({ block: "nearest" });
  }, [listId, index]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (move(e)) return;
    if (e.key === "Enter") {
      const item = shown[index];
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(item.id);
      }
      return;
    }
    if (query === "" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const hit = items.find((i) => i.hotkey && i.hotkey.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(hit.id);
      }
    }
  };

  return (
    <div className="flex w-[280px] flex-col gap-1.5">
      <Input
        dense
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length ? optionId(index) : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
        {shown.length === 0 ? (
          <li role="presentation" className="px-2.5 py-2 text-sm text-muted">
            {emptyText}
          </li>
        ) : (
          shown.map((item, i) => (
            <li
              key={item.id}
              id={optionId(i)}
              role="option"
              aria-selected={item.id === value}
              onMouseMove={() => i !== index && setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(item.id)}
              className={cx(
                "flex h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink",
                i === index && "bg-surface-2",
              )}
            >
              {item.colour ? (
                <Swatch colour={item.colour} />
              ) : item.icon ? (
                <Icon name={item.icon} size={15} className="text-muted" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {item.label}
                {item.hint && <span className="ml-2 text-2xs text-muted">{item.hint}</span>}
              </span>
              {item.id === value && <Icon name="check" size={14} className="text-accent-ink" />}
              {item.hotkey && <Kbd>{item.hotkey.toUpperCase()}</Kbd>}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export interface ComboboxProps extends Omit<ComboboxListProps, "onSelect"> {
  onChange: (id: string) => void;
  disabled?: boolean;
  triggerPlaceholder?: string;
  className?: string;
}

/** A filterable single-select: a field-styled trigger that opens ComboboxList in a Popover. */
export function Combobox({
  label,
  items,
  value,
  onChange,
  disabled,
  triggerPlaceholder = "Choose…",
  className,
  ...list
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = items.find((i) => i.id === value) ?? null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? "none"}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={fieldClass(false, cx("flex h-[34px] items-center gap-2 px-3 text-left", className))}
      >
        {selected?.colour && <Swatch colour={selected.colour} />}
        <span className={cx("min-w-0 flex-1 truncate", !selected && "text-dim")}>
          {selected?.label ?? triggerPlaceholder}
        </span>
        <Icon name="chevron-down" size={14} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={trigger} label={label}>
        <ComboboxList
          label={label}
          items={items}
          value={value}
          onSelect={(id) => {
            setOpen(false);
            onChange(id);
          }}
          {...list}
        />
      </Popover>
    </>
  );
}
```

- [ ] **Step 5: Export from the barrel** (alphabetical):

```ts
export {
  Combobox,
  ComboboxList,
  filterItems,
  type ComboItem,
  type ComboboxListProps,
  type ComboboxProps,
} from "./Combobox";
export { useListNavigation } from "./listbox";
```

- [ ] **Step 6: Gallery section** — `frontend/src/ui/gallery/sections/Combobox.tsx`:

```tsx
import { useRef, useState } from "react";
import { Button } from "@/ui/Button";
import { Combobox, ComboboxList, type ComboItem } from "@/ui/Combobox";
import { Popover } from "@/ui/Popover";

export const title = "Combobox";
export const order = 110;

const TYPES: ComboItem[] = [
  { id: "crack", label: "Crack", hint: "Concrete defects", hotkey: "1", colour: "#ff5a4f" },
  { id: "spall", label: "Spalling", hint: "Concrete defects", hotkey: "2", colour: "#ff9c3a" },
  { id: "rust", label: "Corrosion", hint: "Steel", hotkey: "3", colour: "#e2bf2e" },
  { id: "excavator", label: "Excavator", hint: "Machinery", hotkey: "e", colour: "#8aa4ff" },
  { id: "dump", label: "Dump truck", hint: "Machinery", colour: "#5fe3c0" },
];

export default function ComboboxSection() {
  const [type, setType] = useState<string | null>("crack");
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="w-60">
        <Combobox label="Type" items={TYPES} value={type} onChange={setType} />
      </div>
      <Button ref={anchor} onClick={() => setPicking(true)}>
        Type picker (T)
      </Button>
      <Popover open={picking} onClose={() => setPicking(false)} anchorRef={anchor} label="Pick the type">
        <ComboboxList
          label="Pick the type"
          items={TYPES}
          value={type}
          onSelect={(id) => {
            setType(id);
            setPicking(false);
          }}
        />
      </Popover>
    </div>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Combobox.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 8: Visual check**

Run `node frontend/scripts/gallery-shots.mjs combobox`, then open both pickers in the browser. Against `ws-images.html` (the type row `.type` and the model menu `.mdl`): the trigger is a 34 px field with the type's swatch; the picker is a glass popover with a dense filter field and 32 px rows showing swatch, name, group hint in muted, a check on the current type and the hotkey as a key cap. Press 1, 2, 3 or E with the filter empty (the pick is immediate); type "st" (filters to Corrosion); ↑ ↓ Enter; Esc returns focus.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/ui/listbox.ts frontend/src/ui/Combobox.tsx frontend/src/ui/Combobox.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Combobox.tsx
git status
git commit -m "feat(ui): Combobox and ComboboxList with type hotkeys live only in the picker" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `CommandPalette`

**Files:**
- Create: `frontend/src/ui/CommandPalette.tsx`, `frontend/src/ui/CommandPalette.test.tsx`, `frontend/src/ui/gallery/sections/CommandPalette.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `GlassPanel` (3), `formatChord` (4), `Kbd` (5), `useFocusTrap` (7), `useListNavigation` (14), `Icon`.
- Produces:
  - `interface Command { id: string; title: string; hint?: string; icon?: IconName; shortcut?: string; run: () => void }`
  - `interface CommandGroup { label: string; items: readonly Command[] }`
  - `interface CommandSource { id: string; label: string; minQuery?: number (default 2); search: (query: string, signal: AbortSignal) => Promise<readonly Command[]> }`
  - `SEARCH_DEBOUNCE_MS = 120`
  - `CommandPalette(props: { open: boolean; onClose: () => void; groups: readonly CommandGroup[]; sources?: readonly CommandSource[]; placeholder?: string })` — a modal glass dialog (`aria-label="Command palette"`) with an input (`role="combobox"`, name "Command") and a grouped listbox; static groups filter by substring on title and hint; each source is searched 120 ms after the last keystroke once the query reaches `minQuery`, a superseded search is aborted and its late answer ignored; ↑ ↓ move, Enter closes then runs, Esc closes; focus returns to the opener. SH owns Ctrl K and the command registry (`app/commands.ts`).

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/CommandPalette.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, SEARCH_DEBOUNCE_MS, type Command } from "./CommandPalette";

const cmd = (id: string, title: string, run: () => void = () => {}): Command => ({ id, title, run });

afterEach(() => vi.useRealTimers());

function fakeTimers() {
  vi.useFakeTimers();
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

describe("CommandPalette", () => {
  it("filters the static commands and runs the active one on Enter, after closing", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        groups={[{ label: "Go to", items: [cmd("projects", "Projects"), cmd("models", "Models", run)] }]}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "mod");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("moves across groups with ↓, closes on Esc, and says when nothing matches", async () => {
    const onClose = vi.fn();
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        groups={[
          { label: "Go to", items: [cmd("projects", "Projects")] },
          { label: "Actions", items: [cmd("new", "New project", run)] },
        ]}
      />,
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "New project" })).toHaveAttribute("aria-selected", "true");
    await userEvent.type(screen.getByRole("combobox", { name: "Command" }), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks an async source once, 120 ms after the last keystroke, from 2 characters", async () => {
    const user = fakeTimers();
    const search = vi.fn(async () => [cmd("f1", "F-0001 Crack")]);
    render(<CommandPalette open onClose={() => {}} groups={[]} sources={[{ id: "findings", label: "Findings", search }]} />);
    const input = screen.getByRole("combobox", { name: "Command" });
    await user.type(input, "c");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(search).not.toHaveBeenCalled();
    await user.type(input, "ra");
    await tick(SEARCH_DEBOUNCE_MS - 1);
    expect(search).not.toHaveBeenCalled();
    await tick(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cra", expect.any(AbortSignal));
    expect(screen.getByRole("option", { name: /F-0001/ })).toBeInTheDocument();
  });

  it("never shows an older query's answer over a newer one", async () => {
    const user = fakeTimers();
    const pending: Record<string, (items: Command[]) => void> = {};
    const search = vi.fn((q: string) => new Promise<Command[]>((resolve) => (pending[q] = resolve)));
    render(<CommandPalette open onClose={() => {}} groups={[]} sources={[{ id: "findings", label: "Findings", search }]} />);
    const input = screen.getByRole("combobox", { name: "Command" });
    await user.type(input, "cr");
    await tick(SEARCH_DEBOUNCE_MS);
    await user.type(input, "a");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending["cra"]([cmd("new", "F-0002 Crack")]);
      pending["cr"]([cmd("old", "F-0001 Crack")]);
    });
    expect(screen.getByRole("option", { name: /F-0002/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /F-0001/ })).toBeNull();
  });

  it("keeps a pending search when its parent re-renders with a new sources array", async () => {
    const user = fakeTimers();
    let finish: (items: Command[]) => void = () => {};
    const search = vi.fn(() => new Promise<Command[]>((resolve) => (finish = resolve)));
    function Host({ tick: n }: { tick: number }) {
      return (
        <CommandPalette
          open
          onClose={() => {}}
          groups={[{ label: "Go to", items: [cmd(`t${n}`, `Tick ${n}`)] }]}
          sources={[{ id: "findings", label: "Findings", search }]}
        />
      );
    }
    const { rerender } = render(<Host tick={1} />);
    await user.type(screen.getByRole("combobox", { name: "Command" }), "crack");
    await tick(SEARCH_DEBOUNCE_MS);
    rerender(<Host tick={2} />);
    await act(async () => finish([cmd("f3", "F-0003 Crack")]));
    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: /F-0003/ })).toBeInTheDocument();
  });

  it("reports a failed source and keeps the static commands usable", async () => {
    const user = fakeTimers();
    const search = vi.fn(() => Promise.reject(new Error("offline")));
    render(
      <CommandPalette
        open
        onClose={() => {}}
        groups={[{ label: "Go to", items: [cmd("catalogue", "Catalogue")] }]}
        sources={[{ id: "findings", label: "Findings", search }]}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Command" }), "ca");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText("Couldn't search findings")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Catalogue" })).toBeInTheDocument();
  });

  it("returns focus to the opener", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Search</button>
          <CommandPalette open={open} onClose={() => setOpen(false)} groups={[]} />
        </>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toHaveAttribute("data-glass", "float");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/CommandPalette.test.tsx`
Expected: FAIL with `Failed to resolve import "./CommandPalette"`.

- [ ] **Step 3: Create `frontend/src/ui/CommandPalette.tsx`**

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { Kbd } from "./Kbd";
import { formatChord } from "./keymap";
import { useListNavigation } from "./listbox";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  icon?: IconName;
  shortcut?: string;
  run: () => void;
}

export interface CommandGroup {
  label: string;
  items: readonly Command[];
}

export interface CommandSource {
  id: string;
  label: string;
  /** Characters before the source is asked; 2 by default (spec §5.4). */
  minQuery?: number;
  search: (query: string, signal: AbortSignal) => Promise<readonly Command[]>;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  groups: readonly CommandGroup[];
  sources?: readonly CommandSource[];
  placeholder?: string;
}

export const SEARCH_DEBOUNCE_MS = 120;
const DEFAULT_MIN_QUERY = 2;

interface Found {
  query: string;
  status: "loading" | "done" | "error";
  items: readonly Command[];
}

interface Section {
  label: string;
  items: readonly Command[];
  note?: string;
}

function Palette({ onClose, groups, sources = [], placeholder = "Search or jump to…" }: Omit<CommandPaletteProps, "open">) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Record<string, Found>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline arrays; reading them through a ref keeps a new array from restarting (and
  // aborting) the pending search on every parent render.
  const sourcesRef = useRef(sources);
  const onTab = useFocusTrap(panelRef, true);
  const listId = useId();
  const q = query.trim();

  useEffect(() => {
    sourcesRef.current = sources;
  });

  useEffect(() => {
    const live = sourcesRef.current.filter((s) => q.length >= (s.minQuery ?? DEFAULT_MIN_QUERY));
    if (live.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      for (const source of live) {
        setFound((f) => ({ ...f, [source.id]: { query: q, status: "loading", items: [] } }));
        source.search(q, controller.signal).then(
          (items) => {
            if (!controller.signal.aborted) {
              setFound((f) => ({ ...f, [source.id]: { query: q, status: "done", items } }));
            }
          },
          () => {
            if (!controller.signal.aborted) {
              setFound((f) => ({ ...f, [source.id]: { query: q, status: "error", items: [] } }));
            }
          },
        );
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const needle = q.toLowerCase();
  const matches = (c: Command) => !needle || `${c.title} ${c.hint ?? ""}`.toLowerCase().includes(needle);
  const sections: Section[] = [];
  for (const group of groups) {
    const items = group.items.filter(matches);
    if (items.length) sections.push({ label: group.label, items });
  }
  for (const source of sources) {
    if (q.length < (source.minQuery ?? DEFAULT_MIN_QUERY)) continue;
    const f = found[source.id];
    if (!f || f.query !== q || f.status === "loading") {
      sections.push({ label: source.label, items: [], note: "Searching…" });
    } else if (f.status === "error") {
      sections.push({ label: source.label, items: [], note: `Couldn't search ${source.label.toLowerCase()}` });
    } else if (f.items.length) {
      sections.push({ label: source.label, items: f.items });
    }
  }
  const flat = sections.flatMap((s) => s.items);
  const starts = sections.map((_, n) => sections.slice(0, n).reduce((sum, s) => sum + s.items.length, 0));
  const { index, setIndex, move } = useListNavigation(flat.length, q);

  const run = (command: Command) => {
    onClose();
    command.run();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (move(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const command = flat[index];
      if (command) run(command);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center bg-bg/50 px-4 pt-[14vh] animate-fade motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <GlassPanel
        ref={panelRef}
        variant="float"
        radius="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          onTab(e);
        }}
        className="flex h-fit max-h-[min(70vh,560px)] w-full max-w-[640px] flex-col overflow-hidden shadow-elev-2 animate-pop motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" size={16} className="text-muted" />
          <input
            role="combobox"
            aria-label="Command"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `${listId}-${index}` : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-dim focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className="overflow-y-auto p-1.5">
          {sections.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No matches</p>}
          {sections.map((section, n) => (
            <div key={section.label} role="group" aria-label={section.label}>
              <p aria-hidden="true" className="px-2.5 pb-1 pt-2 text-2xs text-muted">
                {section.label}
              </p>
              {section.note && <p className="px-2.5 py-1.5 text-sm text-dim">{section.note}</p>}
              {section.items.map((command, k) => {
                const i = starts[n] + k;
                return (
                  <div
                    key={command.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === index}
                    onMouseMove={() => i !== index && setIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(command)}
                    className={cx(
                      "flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm text-ink",
                      i === index && "bg-accent-soft",
                    )}
                  >
                    {command.icon ? (
                      <Icon name={command.icon} size={15} className="text-muted" />
                    ) : (
                      <span aria-hidden="true" className="w-[15px]" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {command.title}
                      {command.hint && <span className="ml-2 text-2xs text-muted">{command.hint}</span>}
                    </span>
                    {command.shortcut && (
                      <span className="flex gap-0.5">
                        {formatChord(command.shortcut).map((key, j) => (
                          <Kbd key={j}>{key}</Kbd>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>,
    document.body,
  );
}

/**
 * The Ctrl K palette (spec §5.4): a glass dialog with a combobox over grouped commands and debounced
 * async search sources. Mounting on open resets the query each time.
 */
export function CommandPalette({ open, ...rest }: CommandPaletteProps) {
  return open ? <Palette {...rest} /> : null;
}
```

- [ ] **Step 4: Export from the barrel** (alphabetical):

```ts
export {
  CommandPalette,
  SEARCH_DEBOUNCE_MS,
  type Command,
  type CommandGroup,
  type CommandPaletteProps,
  type CommandSource,
} from "./CommandPalette";
```

- [ ] **Step 5: Gallery section** — `frontend/src/ui/gallery/sections/CommandPalette.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/ui/Button";
import { CommandPalette, type Command, type CommandSource } from "@/ui/CommandPalette";

export const title = "Command palette";
export const order = 120;

const noop = () => {};

const FINDINGS: Command[] = [
  { id: "f217", title: "F-0217 Crack", hint: "DJI_0412.JPG · Major", icon: "findings", run: noop },
  { id: "f218", title: "F-0218 Spalling", hint: "North ortho · Moderate", icon: "findings", run: noop },
];

const SOURCES: CommandSource[] = [
  {
    id: "findings",
    label: "Findings",
    search: (q, signal) =>
      new Promise((resolve, reject) => {
        const t = window.setTimeout(() => resolve(FINDINGS.filter((f) => f.title.toLowerCase().includes(q.toLowerCase()))), 300);
        signal.addEventListener("abort", () => {
          window.clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  },
];

export default function CommandPaletteSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="search" onClick={() => setOpen(true)}>
        Open the palette
      </Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        sources={SOURCES}
        groups={[
          {
            label: "Go to",
            items: [
              { id: "projects", title: "Projects", icon: "folder", run: noop },
              { id: "models", title: "Models", icon: "models", run: noop },
              { id: "catalogue", title: "Catalogue", icon: "catalogue", run: noop },
              { id: "jobs", title: "Jobs", icon: "jobs", run: noop },
            ],
          },
          {
            label: "Actions",
            items: [
              { id: "add", title: "Add data", icon: "plus", run: noop },
              { id: "effects", title: "Toggle reduced effects", icon: "sparkle", run: noop },
              { id: "shortcuts", title: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", run: noop },
            ],
          },
        ]}
      />
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/CommandPalette.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 7: Visual check**

Run `node frontend/scripts/gallery-shots.mjs command-palette` (closed state), then in the browser open the palette, type "cr" and wait. Check: a 640 px glass panel 14% down the page over a dimmed backdrop, 16 px radius, popping in; a 48 px input with the search icon and an Esc key cap (like the mockup's `.search` field, larger); muted group labels; the active row is violet-soft; "Searching…" shows for the Findings group, then F-0217 and F-0218; ↑ ↓ Enter work and Esc returns focus to the button. With `?effects=reduced` the panel is solid.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/ui/CommandPalette.tsx frontend/src/ui/CommandPalette.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/CommandPalette.tsx
git status
git commit -m "feat(ui): CommandPalette with grouped commands and debounced, abortable search sources" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: The Inspector layout

**Files:**
- Create: `frontend/src/ui/Inspector.tsx`, `frontend/src/ui/Inspector.test.tsx`, `frontend/src/ui/gallery/sections/Inspector.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `GlassPanel`, `stagger`, `.stagger` (3).
- Produces:
  - `InspectorLayout(props: { children: ReactNode; inspector?: ReactNode | null; className?: string })` — a grid; with an inspector, `min-[1100px]:grid-cols-[minmax(0,1fr)_340px]` (stacked under the content below 1100 px); `data-inspector="open|closed"`.
  - `InspectorPane(props: { label: string; header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string })` — `<aside>` pane, header, a scrolling column whose children rise in with the stagger (`--i` = 0, 1, 2 …, capped by CSS), a footer outside the scroll area.
  - `InspectorSection(props: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string })` — a labelled `<section>` (role region).

- [ ] **Step 1: Write the failing test** — `frontend/src/ui/Inspector.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorLayout, InspectorPane, InspectorSection } from "./Inspector";

describe("InspectorLayout", () => {
  it("adds the 340 px column only while an inspector is open, stacking below 1100 px", () => {
    const { rerender, container } = render(
      <InspectorLayout inspector={null}>
        <p>Table</p>
      </InspectorLayout>,
    );
    const grid = container.firstElementChild!;
    expect(grid).toHaveAttribute("data-inspector", "closed");
    expect(grid.className).not.toContain("340px");
    rerender(
      <InspectorLayout inspector={<InspectorPane label="Finding">x</InspectorPane>}>
        <p>Table</p>
      </InspectorLayout>,
    );
    expect(grid).toHaveAttribute("data-inspector", "open");
    expect(grid.className).toContain("min-[1100px]:grid-cols-[minmax(0,1fr)_340px]");
    expect(screen.getByRole("complementary", { name: "Finding" })).toBeInTheDocument();
  });
});

describe("InspectorPane", () => {
  it("staggers its sections in order and keeps the footer outside the scroll area", () => {
    render(
      <InspectorPane label="Finding" header={<span>F-0217</span>} footer={<button>Close finding</button>}>
        <InspectorSection title="Type">Crack</InspectorSection>
        <InspectorSection title="Severity">Major</InspectorSection>
        {null}
        <InspectorSection title="Note">Hairline, 40 cm</InspectorSection>
      </InspectorPane>,
    );
    const pane = screen.getByRole("complementary", { name: "Finding" });
    expect(pane).toHaveAttribute("data-glass", "pane");
    const column = pane.querySelector('[data-part="sections"]')!;
    const wrappers = Array.from(column.children) as HTMLElement[];
    expect(wrappers.map((w) => w.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
    expect(wrappers[0].className).toContain("stagger");
    expect(screen.getByRole("region", { name: "Severity" })).toHaveTextContent("Major");
    expect(column.contains(screen.getByRole("button", { name: "Close finding" }))).toBe(false);
    expect(pane.lastElementChild).toHaveAttribute("data-part", "footer");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/Inspector.test.tsx`
Expected: FAIL with `Failed to resolve import "./Inspector"`.

- [ ] **Step 3: Create `frontend/src/ui/Inspector.tsx`**

```tsx
import { Children, isValidElement, useId, type ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { stagger } from "./motion";
import { cx } from "./tokens";

export interface InspectorLayoutProps {
  children: ReactNode;
  /** The InspectorPane, or null when nothing is selected. */
  inspector?: ReactNode | null;
  className?: string;
}

/** Content and a 340 px inspector on the right; below 1100 px the inspector stacks under the content. */
export function InspectorLayout({ children, inspector, className }: InspectorLayoutProps) {
  const open = inspector !== null && inspector !== undefined && inspector !== false;
  return (
    <div
      data-inspector={open ? "open" : "closed"}
      className={cx(
        "grid min-h-0 flex-1 gap-3",
        open ? "grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1",
        className,
      )}
    >
      <div className="min-h-0 min-w-0">{children}</div>
      {open && inspector}
    </div>
  );
}

export interface InspectorPaneProps {
  label: string;
  header?: ReactNode;
  /** Stays visible below the scrolling sections (Save, Close finding). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The inspector (ws-images .ins): a header, sections that rise in with the stagger, a footer. */
export function InspectorPane({ label, header, footer, children, className }: InspectorPaneProps) {
  const sections = Children.toArray(children).filter(isValidElement);
  return (
    <GlassPanel
      as="aside"
      aria-label={label}
      className={cx("flex min-h-0 flex-col overflow-hidden animate-slide-in motion-reduce:animate-none", className)}
    >
      {header && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">{header}</div>
      )}
      <div data-part="sections" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
        {sections.map((section, i) => (
          <div key={section.key ?? i} style={stagger(i)} className="stagger animate-rise motion-reduce:animate-none">
            {section}
          </div>
        ))}
      </div>
      {footer && (
        <div data-part="footer" className="border-t border-line bg-surface px-3.5 py-3">
          {footer}
        </div>
      )}
    </GlassPanel>
  );
}

export interface InspectorSectionProps {
  title: ReactNode;
  /** A small control at the right of the title (Add photo, Edit). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InspectorSection({ title, action, children, className }: InspectorSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-xs font-medium text-muted">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: Export from the barrel** (alphabetical):

```ts
export {
  InspectorLayout,
  InspectorPane,
  InspectorSection,
  type InspectorLayoutProps,
  type InspectorPaneProps,
  type InspectorSectionProps,
} from "./Inspector";
```

- [ ] **Step 5: Gallery section** — `frontend/src/ui/gallery/sections/Inspector.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { InspectorLayout, InspectorPane, InspectorSection } from "@/ui/Inspector";
import { Textarea } from "@/ui/Input";
import { Segmented } from "@/ui/Segmented";
import { SeverityPicker } from "@/ui/Severity";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Inspector";
export const order = 130;

export default function InspectorSectionDemo() {
  const [open, setOpen] = useState(true);
  const [severity, setSeverity] = useState<number | null>(3);
  const [status, setStatus] = useState<"open" | "reviewed" | "closed">("reviewed");
  return (
    <div className="grid h-[640px] gap-3">
      <Button className="w-fit" onClick={() => setOpen((o) => !o)}>
        {open ? "Close the inspector" : "Open the inspector"}
      </Button>
      <InspectorLayout
        inspector={
          open ? (
            <InspectorPane
              label="Finding F-0217"
              header={
                <>
                  <span className="font-mono text-xs text-muted">F-0217</span>
                  <span className="rounded-chip bg-grad-ai px-2 py-0.5 text-2xs">model: cracks-v3</span>
                </>
              }
              footer={
                <Button variant="primary" className="w-full">
                  Close finding
                </Button>
              }
            >
              <InspectorSection title="Type">
                <TypeChip name="Crack" colour="#ff5a4f" kind="defect" />
              </InspectorSection>
              <InspectorSection title="Severity">
                <SeverityPicker value={severity} onChange={setSeverity} />
              </InspectorSection>
              <InspectorSection title="Status">
                <Segmented
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "reviewed", label: "Reviewed" },
                    { value: "closed", label: "Closed" },
                  ]}
                />
              </InspectorSection>
              <InspectorSection title="AI provenance">
                <div className="flex items-center gap-2.5 rounded-control border border-accent/30 bg-grad-ai px-3 py-2.5 text-xs">
                  <Icon name="sparkle" size={16} className="text-accent-ink" />
                  cracks-v3 · confidence 0.91
                </div>
              </InspectorSection>
              <InspectorSection title="Note">
                <Textarea rows={3} defaultValue="Hairline crack along the pour joint, about 40 cm." />
              </InspectorSection>
            </InspectorPane>
          ) : null
        }
      >
        <div className="grid h-full place-items-center rounded-panel border border-card-line bg-surface text-sm text-muted">
          the Findings table
        </div>
      </InspectorLayout>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/Inspector.test.tsx src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`: PASS.

- [ ] **Step 7: Visual check**

Run `node frontend/scripts/gallery-shots.mjs inspector`, then toggle the inspector in the browser and narrow the window below 1100 px. Against the right pane of `ws-images.html` (`.ins`, `.ih`, `.type`, `.sevseg`, `.prov`, textarea): a 340 px translucent pane (no blur) with a 16 px radius; the header with the mono id; sections separated by 14 px with small muted titles, rising in 40 ms apart when the pane opens; the AI provenance box on the violet → teal tint; the footer stays put while the sections scroll; below 1100 px the pane moves under the table.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/ui/Inspector.tsx frontend/src/ui/Inspector.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/Inspector.tsx
git status
git commit -m "feat(ui): InspectorLayout, InspectorPane and InspectorSection" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: The virtualised `DataTable`, and `useVirtualRows` moves to `ui/`

**Files:**
- Move: `frontend/src/data/useVirtualRows.ts` → `frontend/src/ui/useVirtualRows.ts`, `frontend/src/data/useVirtualRows.test.ts` → `frontend/src/ui/useVirtualRows.test.ts`
- Modify: `frontend/src/data/ImageGrid.tsx`, `frontend/src/data/ImageTable.tsx` (import path)
- Create: `frontend/src/ui/DataTable.tsx`, `frontend/src/ui/DataTable.test.tsx`, `frontend/src/ui/gallery/sections/DataTable.tsx`
- Modify: `frontend/src/ui/index.ts`

**Interfaces:**
- Consumes: `Checkbox` (5), `EmptyState`, `SkeletonRows` (6), `isTypingTarget` (4), `computeWindow`, `useVirtualRows`.
- Produces:
  - `@/ui/useVirtualRows`: `computeWindow(scrollTop, viewportHeight, rowHeight, count, overscan = 4): RowWindow`, `useVirtualRows({ rowHeight, fallbackHeight? }): VirtualViewport` (unchanged code, new path).
  - `ROW_HEIGHT = 44`, `interface Column<T> { key: string; header: ReactNode; width?: string (a grid track, default minmax(0,1fr)); render: (row: T, index: number) => ReactNode; sortable?: boolean; align?: "start" | "end" }`, `interface Sort { key: string; dir: "asc" | "desc" }`
  - `DataTable<T>(props: { label: string; columns: readonly Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; total?: number; loading?: boolean; empty?: ReactNode; selected?: ReadonlySet<string>; onSelectionChange?: (next: Set<string>) => void; sort?: Sort | null; onSortChange?: (next: Sort) => void; onOpen?: (row: T) => void; activeKey?: string | null; onEndReached?: () => void; endThreshold?: number (10); className?: string })` — `role="grid"`, sticky header, fixed 44 px rows, only the window rendered, selection with a checkbox column and shift-range, ↑ ↓ J K Home End move, Enter opens, Space toggles selection; `onEndReached` fires once per page; never blurred.

- [ ] **Step 1: Move `useVirtualRows`**

```powershell
git mv frontend/src/data/useVirtualRows.ts frontend/src/ui/useVirtualRows.ts
git mv frontend/src/data/useVirtualRows.test.ts frontend/src/ui/useVirtualRows.test.ts
```

In `frontend/src/data/ImageGrid.tsx` and `frontend/src/data/ImageTable.tsx`, replace `from "./useVirtualRows";` with `from "@/ui/useVirtualRows";`. The moved test's import (`./useVirtualRows`) still resolves. Run `pnpm -C frontend exec vitest run src/ui/useVirtualRows.test.ts src/data`: PASS.

- [ ] **Step 2: Write the failing test** — `frontend/src/ui/DataTable.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, ROW_HEIGHT, type Column, type Sort } from "./DataTable";

interface Row {
  id: string;
  name: string;
}

const make = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
const COLUMNS: Column<Row>[] = [{ key: "name", header: "Name", render: (r) => r.name, sortable: true }];

/** jsdom has no layout; a writable scrollTop stands in for scrolling the grid. */
function scrollTo(grid: HTMLElement, top: number) {
  Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: top });
  fireEvent.scroll(grid);
}

describe("DataTable", () => {
  it("renders a fixed window of rows however many there are", () => {
    render(<DataTable label="Findings" columns={COLUMNS} rows={make(10_000)} rowKey={(r) => r.id} />);
    const grid = screen.getByRole("grid", { name: "Findings" });
    // header + 18 rows: the 600 px jsdom fallback / 44 px = 14 visible, plus 4 overscan
    expect(within(grid).getAllByRole("row")).toHaveLength(19);
    expect(grid).toHaveAttribute("aria-rowcount", "10001");
  });

  it("moves the window as it scrolls", () => {
    render(<DataTable label="Findings" columns={COLUMNS} rows={make(10_000)} rowKey={(r) => r.id} />);
    const grid = screen.getByRole("grid", { name: "Findings" });
    scrollTo(grid, ROW_HEIGHT * 1000);
    expect(screen.getByText("Row 1000")).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).toBeNull();
    expect(within(grid).getAllByRole("row").length).toBeLessThanOrEqual(23);
  });

  it("walks rows with ↓ ↑ J K, opens with Enter, and keeps the keys from the workspace", async () => {
    const onOpen = vi.fn();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    const rows = make(50);
    render(<DataTable label="Findings" columns={COLUMNS} rows={rows} rowKey={(r) => r.id} onOpen={onOpen} />);
    screen.getByRole("grid", { name: "Findings" }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}jk{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[2]);
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("selects one row by click and a range with shift-click", async () => {
    function Host() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
      return (
        <>
          <DataTable
            label="Findings"
            columns={COLUMNS}
            rows={make(20)}
            rowKey={(r) => r.id}
            selected={selected}
            onSelectionChange={setSelected}
          />
          <p data-testid="picked">{[...selected].sort().join(",")}</p>
        </>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select row 5" }));
    await userEvent.keyboard("{/Shift}");
    expect(screen.getByTestId("picked")).toHaveTextContent("r1,r2,r3,r4");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all loaded rows" }));
    expect(screen.getByTestId("picked").textContent!.split(",")).toHaveLength(20);
  });

  it("asks for the next page once per page", () => {
    const onEndReached = vi.fn();
    const { rerender } = render(
      <DataTable label="Findings" columns={COLUMNS} rows={make(30)} rowKey={(r) => r.id} onEndReached={onEndReached} />,
    );
    const grid = screen.getByRole("grid", { name: "Findings" });
    expect(onEndReached).not.toHaveBeenCalled();
    scrollTo(grid, 30 * ROW_HEIGHT);
    scrollTo(grid, 30 * ROW_HEIGHT + 10);
    expect(onEndReached).toHaveBeenCalledTimes(1);
    rerender(<DataTable label="Findings" columns={COLUMNS} rows={make(60)} rowKey={(r) => r.id} onEndReached={onEndReached} />);
    scrollTo(grid, 60 * ROW_HEIGHT);
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it("sorts from the header", async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable label="Findings" columns={COLUMNS} rows={make(3)} rowKey={(r) => r.id} sort={null} onSortChange={onSortChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", dir: "asc" } satisfies Sort);
    rerender(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={make(3)}
        rowKey={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", dir: "desc" });
  });

  it("shows skeleton rows while the first page loads, then the empty state", () => {
    const { rerender } = render(<DataTable label="Findings" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    rerender(<DataTable label="Findings" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty={<p>No findings yet</p>} />);
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/DataTable.test.tsx`
Expected: FAIL with `Failed to resolve import "./DataTable"`.

- [ ] **Step 4: Create `frontend/src/ui/DataTable.tsx`**

```tsx
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Checkbox } from "./Checkbox";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { isTypingTarget } from "./keymap";
import { SkeletonRows } from "./Skeleton";
import { cx } from "./tokens";
import { computeWindow, useVirtualRows } from "./useVirtualRows";

/** Every row is this tall; the window arithmetic depends on it (spec §4.4). */
export const ROW_HEIGHT = 44;

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** A CSS grid track: "44px", "minmax(0,2fr)", "120px". Default minmax(0,1fr). */
  width?: string;
  render: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
}

export interface Sort {
  key: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T> {
  label: string;
  columns: readonly Column<T>[];
  /** The loaded pages only; the caller appends a page on onEndReached. */
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The total across all pages, for aria-rowcount; defaults to the loaded count. */
  total?: number;
  loading?: boolean;
  empty?: ReactNode;
  selected?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  sort?: Sort | null;
  onSortChange?: (next: Sort) => void;
  onOpen?: (row: T) => void;
  /** The row shown in the inspector. */
  activeKey?: string | null;
  onEndReached?: () => void;
  /** Rows from the end at which onEndReached fires. */
  endThreshold?: number;
  className?: string;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * A virtualised table (Findings, Jobs, Catalogue, Datasets): fixed 44 px rows, only the visible window
 * rendered, a sticky header, checkbox selection with shift-range, keyboard (↑ ↓ J K Home End, Enter
 * opens, Space selects) and cursor paging through onEndReached. Never blurred (spec F7).
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  total,
  loading = false,
  empty,
  selected,
  onSelectionChange,
  sort = null,
  onSortChange,
  onOpen,
  activeKey = null,
  onEndReached,
  endThreshold = 10,
  className,
}: DataTableProps<T>) {
  const selectable = selected !== undefined && onSelectionChange !== undefined;
  const chosen = selected ?? NONE;
  const { containerRef, onScroll, height, scrollTop } = useVirtualRows({ rowHeight: ROW_HEIGHT });
  // The sticky header takes the first row of the viewport.
  const win = computeWindow(Math.max(0, scrollTop - ROW_HEIGHT), height, ROW_HEIGHT, rows.length);
  const [cursor, setCursor] = useState(0);
  const cur = Math.min(cursor, Math.max(0, rows.length - 1));
  const anchor = useRef<number | null>(null);
  const askedAt = useRef(-1);

  useEffect(() => {
    if (!onEndReached || loading || rows.length === 0) return;
    if (win.end >= rows.length - endThreshold && askedAt.current !== rows.length) {
      askedAt.current = rows.length;
      onEndReached();
    }
  }, [win.end, rows.length, loading, onEndReached, endThreshold]);

  const template = [selectable ? "40px" : null, ...columns.map((c) => c.width ?? "minmax(0,1fr)")]
    .filter(Boolean)
    .join(" ");

  const toggle = (i: number, range: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(chosen);
    const key = rowKey(rows[i]);
    if (range && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      for (let j = a; j <= b; j++) next.add(rowKey(rows[j]));
    } else if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    anchor.current = i;
    onSelectionChange(next);
  };

  /** Scrolls row i into the band below the sticky header. */
  const reveal = (i: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = i * ROW_HEIGHT;
    const bottom = top + 2 * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey || rows.length === 0) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let next: number | null = null;
    if (k === "ArrowDown" || k === "j") next = Math.min(rows.length - 1, cur + 1);
    else if (k === "ArrowUp" || k === "k") next = Math.max(0, cur - 1);
    else if (k === "Home") next = 0;
    else if (k === "End") next = rows.length - 1;
    else if (k === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onOpen?.(rows[cur]);
      return;
    } else if (k === " " && selectable) {
      e.preventDefault();
      e.stopPropagation();
      toggle(cur, e.shiftKey);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    reveal(next);
  };

  const allSelected = selectable && rows.length > 0 && rows.every((r) => chosen.has(rowKey(r)));

  const header = (
    <div
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: template }}
      className="sticky top-0 z-10 grid h-11 items-center border-b border-line bg-bg/95 text-xs text-muted"
    >
      {selectable && (
        <div role="columnheader" className="flex justify-center">
          <Checkbox
            aria-label="Select all loaded rows"
            checked={allSelected}
            onChange={() => onSelectionChange?.(allSelected ? new Set() : new Set(rows.map(rowKey)))}
          />
        </div>
      )}
      {columns.map((c) => {
        const dir = sort?.key === c.key ? sort.dir : null;
        return (
          <div
            key={c.key}
            role="columnheader"
            aria-sort={c.sortable ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
            className={cx("min-w-0 truncate px-3", c.align === "end" && "text-right")}
          >
            {c.sortable && onSortChange ? (
              <button
                type="button"
                onClick={() => onSortChange({ key: c.key, dir: dir === "asc" ? "desc" : "asc" })}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                {c.header}
                {dir && <Icon name="chevron-down" size={12} className={dir === "asc" ? "rotate-180" : undefined} />}
              </button>
            ) : (
              c.header
            )}
          </div>
        );
      })}
    </div>
  );

  let body: ReactNode;
  if (rows.length === 0) {
    body = loading ? (
      <SkeletonRows rows={8} columns={Math.min(columns.length, 5)} className="p-3" />
    ) : (
      <div className="px-3">{empty ?? <EmptyState title="Nothing here yet" />}</div>
    );
  } else {
    body = (
      <div role="rowgroup" className="relative" style={{ height: win.totalHeight }}>
        <div style={{ transform: `translateY(${win.offsetTop}px)` }}>
          {rows.slice(win.start, win.end).map((row, j) => {
            const i = win.start + j;
            const key = rowKey(row);
            const isSelected = chosen.has(key);
            return (
              <div
                key={key}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={selectable ? isSelected : undefined}
                data-cursor={i === cur ? "true" : undefined}
                onClick={() => {
                  setCursor(i);
                  onOpen?.(row);
                }}
                style={{ gridTemplateColumns: template }}
                className={cx(
                  "grid h-11 cursor-pointer items-center border-b border-line text-sm text-ink hover:bg-hover",
                  (isSelected || key === activeKey) && "bg-accent-soft",
                  "group-focus-visible:data-[cursor=true]:ring-1 group-focus-visible:data-[cursor=true]:ring-inset group-focus-visible:data-[cursor=true]:ring-accent/60",
                )}
              >
                {selectable && (
                  <div role="gridcell" className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select row ${i + 1}`}
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => toggle(i, e.shiftKey)}
                    />
                  </div>
                )}
                {columns.map((c) => (
                  <div
                    key={c.key}
                    role="gridcell"
                    className={cx("min-w-0 truncate px-3", c.align === "end" && "text-right tabular-nums")}
                  >
                    {c.render(row, i)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="grid"
      aria-label={label}
      aria-rowcount={(total ?? rows.length) + 1}
      aria-multiselectable={selectable || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cx(
        "group relative min-h-0 overflow-auto rounded-panel border border-card-line bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        className,
      )}
    >
      {header}
      {body}
      {loading && rows.length > 0 && (
        <div role="status" className="flex h-11 items-center px-3 text-xs text-muted">
          Loading more…
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Export from the barrel** (alphabetical):

```ts
export {
  DataTable,
  ROW_HEIGHT,
  type Column,
  type DataTableProps,
  type Sort,
} from "./DataTable";
export { computeWindow, useVirtualRows, type RowWindow, type VirtualViewport } from "./useVirtualRows";
```

- [ ] **Step 6: Gallery section** — `frontend/src/ui/gallery/sections/DataTable.tsx`:

```tsx
import { useState } from "react";
import { DataTable, type Column, type Sort } from "@/ui/DataTable";
import { SeverityPill } from "@/ui/Severity";
import { StatusDot, type DotStatus } from "@/ui/StatusDot";
import { TypeChip } from "@/ui/TypeChip";

export const title = "Data table";
export const order = 140;

interface Finding {
  id: string;
  number: number;
  type: "Crack" | "Spalling";
  severity: number | null;
  status: DotStatus;
}

const PAGE = 200;
const page = (from: number): Finding[] =>
  Array.from({ length: PAGE }, (_, i) => {
    const n = from + i;
    return {
      id: `f${n}`,
      number: n + 1,
      type: n % 3 ? "Crack" : "Spalling",
      severity: n % 5 === 0 ? null : (n % 4) + 1,
      status: (["open", "reviewed", "closed"] as const)[n % 3],
    };
  });

const COLUMNS: Column<Finding>[] = [
  { key: "number", header: "Finding", width: "96px", sortable: true, render: (f) => <span className="font-mono">{`F-${String(f.number).padStart(4, "0")}`}</span> },
  { key: "type", header: "Type", sortable: true, render: (f) => <TypeChip name={f.type} colour={f.type === "Crack" ? "#ff5a4f" : "#ff9c3a"} kind="defect" showKind={false} /> },
  { key: "severity", header: "Severity", width: "140px", sortable: true, render: (f) => <SeverityPill level={f.severity} size="sm" /> },
  { key: "status", header: "Status", width: "120px", render: (f) => <span className="inline-flex items-center gap-2 capitalize"><StatusDot status={f.status} />{f.status}</span> },
];

export default function DataTableSection() {
  const [rows, setRows] = useState<Finding[]>(() => page(0));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<Sort | null>({ key: "severity", dir: "desc" });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <p className="text-2xs text-muted">
        {rows.length.toLocaleString()} of 10,000 loaded · {selected.size} selected · open: {open ?? "none"}
      </p>
      <DataTable
        label="Findings"
        className="h-[440px]"
        columns={COLUMNS}
        rows={rows}
        total={10_000}
        rowKey={(f) => f.id}
        selected={selected}
        onSelectionChange={setSelected}
        sort={sort}
        onSortChange={setSort}
        onOpen={(f) => setOpen(f.id)}
        activeKey={open}
        onEndReached={() => setRows((r) => (r.length >= 10_000 ? r : [...r, ...page(r.length)]))}
      />
    </div>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/ui/DataTable.test.tsx src/ui/useVirtualRows.test.ts src/data src/ui/gallery`
Expected: PASS. Then `pnpm -C frontend format`, `pnpm -C frontend test`, `pnpm -C frontend lint`, `pnpm -C frontend build`: PASS.

- [ ] **Step 8: Visual check**

Run `node frontend/scripts/gallery-shots.mjs data-table`, then in the browser scroll to the bottom repeatedly (200 rows per page up to 10,000), shift-click a range, and walk with J/K. Against the Recent findings card of `visual-directions.html` tab D (`.find`, `.frow`) and spec §8.6: 44 px rows on the translucent surface (no blur), 8% separators, a 5% hover wash, violet-soft selected and open rows, the sticky header on the solid base colour, mono finding numbers, severity pills and status dots. Scrolling stays smooth; in the Performance panel the row count in the DOM stays near 22.

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/ui/useVirtualRows.ts frontend/src/ui/useVirtualRows.test.ts frontend/src/data/ImageGrid.tsx frontend/src/data/ImageTable.tsx frontend/src/ui/DataTable.tsx frontend/src/ui/DataTable.test.tsx frontend/src/ui/index.ts frontend/src/ui/gallery/sections/DataTable.tsx
git status
git commit -m "feat(ui): virtualised DataTable with selection, keyboard and paging; useVirtualRows moves to ui" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git status` must show the two deletions under `frontend/src/data/` as renames already staged by `git mv`.)

---

### Task 18: `DESIGN.md`, `AGENTS.md`, the visual review, the gate and the merge

**Files:**
- Modify: `DESIGN.md` (rewrite), `AGENTS.md` (item 3)
- Create: `docs/evidence/foundation-ds/*.png` (the final gallery screenshots)
- Modify (wrap-up): the session note `/wrapup` creates under `vault/sessions/`, and `vault/00-north-star.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: the merged DS unit on `main`; the operator walkthrough.

- [ ] **Step 1: Rewrite `DESIGN.md`** (the whole file becomes):

```markdown
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
| `control-line` | #767496 | boundaries that are a control's only affordance (checkbox, switch track) |
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
always use `tabular-nums`. Sentence case everywhere; no all-caps labels.

## Radii and elevation

`rounded-panel` 16px (cards, panes, dialogs), `rounded-control` 10px (buttons, fields, glass groups),
`rounded-chip` full (pills, badges, tracks), `rounded-sm` 6px (thumbnails, key caps, menu rows).
`shadow-elev-1` (cards: an inset top highlight and a soft drop), `shadow-elev-2` (hovered cards,
popovers, dialogs, toasts), `shadow-glow` (primary button, active tool; dropped in reduced effects).

## Glass and blur rules

- Blur exists only in `GlassPanel variant="float"` (`.glass-float`, 12px), which Dialog, Popover,
  Menu, CommandPalette and FloatingToolbar use. It is for controls floating over imagery.
- Cards, panes, list panes, dashboards and `DataTable` are translucent **without** blur: over a smooth
  gradient the blur is invisible and costs GPU.
- Never put blur on a scrolling container of a long list.

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
once, indicators jump, loops stop. Every `motion-reduce:` class honours both triggers.

## Reduced effects

`<html data-effects="full|reduced">`, set by `frontend/src/app/effects.ts` before the first paint.
Reduced: glass is opaque `#16172a` with no blur, the backdrop is one static gradient, glows are gone,
`--elev-1` stays; motion is untouched (a separate setting). Settings → Appearance → Visual effects:
Auto (default), Full, Reduced, stored in `localStorage` `kestrel.effects`. Auto starts reduced on a
software renderer (SwiftShader, Microsoft Basic Render), otherwise full; on the first Overview render a
2-second frame probe (after a 300ms warm-up, only while the window is visible) switches to reduced when
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
AI detection. Keys never fire while typing, and a focused primitive (slider, table, menu, picker) keeps
the keys it handles.

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
```

- [ ] **Step 2: Update `AGENTS.md` item 3** — replace its two lines with:

```markdown
3. **UI work loads the design skills first**, together with `DESIGN.md` (the "Aero glass" system)
   and the primitives in `frontend/src/ui/` (see them live at `/gallery.html` under `pnpm -C frontend dev`).
```

- [ ] **Step 3: The full visual review**

With `pnpm -C frontend dev` running, run `node frontend/scripts/gallery-shots.mjs` (all sections). Expected: both modes print `loaded fonts Space Grotesk Variable, JetBrains Mono Variable` and every section is saved twice under `docs/evidence/foundation-ds/`. Put each `*-full.png` beside the mockup element named in its task's visual check and fix any primitive that differs in colour, radius, spacing, type or state before going on (each fix is a commit in the primitive's own files, with its test run). Then check the reduced set: no frosted surface anywhere, one backdrop gradient, no glow.

- [ ] **Step 4: Walk the existing screens**

Start the app against the Prism mock: `.\scripts\dev.ps1 -Mode mock` (from the worktree root; stop the bare `pnpm -C frontend dev` first, since it holds port 1420). Open Projects, a project's Home, Images, the editor, Review, Maps, Point clouds, Volumes, Library, Settings. Expected: every screen renders on the indigo backdrop with readable text, visible surfaces behind panels, dialogs as glass, and no element left without a background (a missed rename). They still use the old layout; SH restyles them. Fix only primitive or rename mistakes here, never screen layout.

- [ ] **Step 5: Run the full gate**

```powershell
pnpm -C contract check
cd backend; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
if (Test-Path frontend/src-tauri/binaries/kestrel-backend-*.exe) { cargo test --manifest-path frontend/src-tauri/Cargo.toml }
```

Expected: every command passes. An e2e failure caused by the new look (a control now covered by another, a changed accessible name) is fixed in the primitive, not by editing `frontend/e2e/` (X owns the e2e suite; if a spec truly asserts Contour styling, stop and report it). The backend steps are unchanged by DS and must pass as they did on `main`.

- [ ] **Step 6: Commit the docs and the evidence**

```powershell
git add DESIGN.md AGENTS.md docs/evidence/foundation-ds
git status
git commit -m "docs: DESIGN.md for Aero glass, AGENTS.md points at it, gallery evidence" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Wrap up the working block** — run `/wrapup` (it writes a session note under `vault/sessions/` and bumps `vault/00-north-star.md`), then stage exactly those two files by path (`git status` names the new note) and commit them with the trailer.

- [ ] **Step 8: Merge** — from inside the worktree: `.\scripts\finish-task.ps1`. It rebases onto `main`, runs the gate, merges, removes the worktree and deletes `task/f-ds`. Expected: it ends without error; `git -C E:\Dev\Yolo\app log --oneline -1` on `main` shows the merge. SH may start now.

- [ ] **Step 9: Give the operator this walkthrough**

1. Start the app as usual (`.\scripts\dev.ps1`). The whole app now sits on the indigo gradient in Space Grotesk; screens keep their current layout until the shell unit (SH) lands.
2. Open `http://127.0.0.1:1420/gallery.html` in a browser while the dev server runs. Scroll through Tokens, Glass, Motion, Controls, Feedback, Overlays, Toolbar, Stats, Severity and status, Tabs, Popover and menu, Slider, Combobox, Command palette, Inspector and Data table.
3. In Toolbar, press B, R, P and V: the active tool follows; hover a tool to see "Box · B".
4. In Stats, press "Add 13 open findings": the value counts up once. Reload with `?motion=reduced`: numbers and sparklines appear at once and nothing slides.
5. Reload with `?effects=reduced`: floating panels turn solid, the glow on primary buttons goes, the backdrop keeps one gradient.
6. In Command palette, open it, type "cr", wait for the findings, use ↑ ↓ Enter, and press Esc: focus returns to the button.
7. In Data table, scroll to the bottom a few times (more rows load), shift-click a range of checkboxes, and walk rows with J and K.
8. Look at a primary button: the violet → indigo gradient is a little deeper than the mockup, so its white label reaches 4.5:1 contrast (your decision of 2026-09-26).

---

## Spec coverage (checked while writing; reviewers may use it)

| Spec | Where |
| --- | --- |
| §4.1 colour tokens, gradients, radii, blur, elevation, typography, bundled fonts | Task 1 (values, Tailwind, fonts, contrast), Task 3 (blur in `.glass-float`) |
| §4.2 motion tokens, rules, reduced motion, `useReducedMotion` | Task 3; used in 6, 9, 11, 16 |
| §4.3 reduced effects, Auto, probe, toast, storage | Task 3 (`app/effects.ts`); consumers SH, S1, S2 (Resolved ambiguity 2) |
| §4.4 rewritten primitives | Button, IconButton, Input/Select/Textarea, Checkbox, Switch, Field, Pill, Alert, Kbd: Task 5; Progress, Skeleton, EmptyState, Toaster, Disclosure, Icon: Task 6; Dialog, Tooltip `shortcut`: Task 7; Segmented thumb: Task 11; `tokens.ts`: Task 5 |
| §4.4 new primitives | GlassPanel 3; FloatingToolbar/ToolButton/`useToolShortcuts` 8 and 4; StatTile/Sparkline 9; SeverityPill/SeverityPicker/StatusDot/TypeChip 10; Tabs 11; Menu/Popover 12; Slider 13; Combobox 14; CommandPalette 15; InspectorLayout/InspectorSection 16; DataTable + `useVirtualRows` move 17 |
| §4.5 `DESIGN.md`, `AGENTS.md` item 3, `check-tokens` rules, `--c`, composited contrast test | Tasks 18, 2, 1 |
| §5.6 one keymap, `isTypingTarget` moved, collision test, `useToolShortcuts`, case-insensitive letters | Task 4 (Resolved ambiguity 5) |
| §16 frontend tests owned by DS | contrast (1), check-tokens fixtures (2), `useCountUp` and `Sparkline` under reduced motion (9), `effects.ts` Auto (3), Tabs indicator and roving focus (11), CommandPalette keyboard and async groups (15), DataTable virtualisation at 10k rows, selection, keyboard (17), SeverityPicker keys (10) |
| §18 DS unit, batch 2, critical path | Global Constraints, Budget and execution DAG |

