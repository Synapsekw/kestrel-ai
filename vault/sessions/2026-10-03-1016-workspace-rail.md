---
type: session
date: 2026-10-03-1016
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-02-workspace-rail-design]]", "[[2026-09-26-map-workspace-design]]", "[[2026-09-26-point-cloud-workspace-design]]"]
---

# 2026-10-03-1016-workspace-rail

## What changed

- **Brainstorm → spec → plan.** The operator found the Maps tools unintuitive: findings,
  annotations, drawings, layers and tools were split across a palette, a layers panel and an
  inspector. Four layouts were mocked up in the visual companion
  (`.superpowers/brainstorm/1245-1790950714/content/layout-options-v3.html`); the operator chose
  **A, an icon rail with one panel per topic**, and asked that the point-cloud preview get the same
  design (`unified-rail.html`).
  - Spec `e9317f74` (`docs/superpowers/specs/2026-10-02-workspace-rail-design.md`).
  - Plan `6da43105` (`docs/superpowers/plans/2026-10-02-workspace-rail.md`, 9 tasks).
- **Built with subagent-driven development** in `.claude/worktrees/workspace-rail` on
  `task/workspace-rail`, one task at a time, with a review after each task and a final opus review
  of the whole branch.
  - **Shared rail in `frontend/src/ui/`:** `railStore.ts` (`d8072949`), `WorkspaceRail.tsx` and the
    `\` toggle key (`358a7324`, `fcf2d3fb`), and `TopicPanel`/`TopicList` with a gallery entry
    (`0b2a3963`).
  - **Maps:** each tool has a `topic` (`20a52d12`). Five topics (Layers, Findings, Measure, AI,
    Drawings), one "All surveys" switch on the timeline, and one home per drawing action
    (`01368847`). The rail replaces `ToolPalette` and `LayersPanel`, and the inspector is 340 px
    (`5c795ddc`, `423c0a8c`).
  - **Point clouds:** features contribute topics, and each list is split from its detail
    (`6e25e651`). The rail replaces the palette, the cloud panel and the inspector tabs, and the
    inspector shows the latest selection (`88ce6c6b`, `732683a0`, `2659edd5`, `18e3c4f6`,
    `b1b52473`).
  - **E2E and docs:** a new `e2e/workspace-rail.spec.ts`, the map e2e specs moved to the rail,
    a `DESIGN.md` Workspaces line, "superseded" lines in the map and cloud specs, and
    `docs/progress.md` (`5de74992`; `9369e97e` fixed the images keymap test).
  - **Final-review fix wave** (`fafa7e24`, `695b3ec3`, `f2671c28`):
    - the cloud Measure list scrolls;
    - `TopicList` measures its height after an empty first render;
    - focus moves between the rail and the panel;
    - `aria-controls` sits on the topic button, and a hidden topic's label says ", hidden";
    - `Ctrl+Alt+\` works for AltGr layouts;
    - each disabled cloud tool names what is missing;
    - dead drawing intents are removed.
- **Merged** `main` into the branch twice and fast-forwarded `main` to `8340215a`. **Not pushed to
  `origin`.** The worktree and branch were removed after a link-safe sweep: 2 183 junctions, none
  pointing outside the worktree; the shared venv was checked afterwards.
- **Gate on the merged tree** (`8340215a`):
  - Frontend lint 0 errors.
  - vitest 607 files / 4 283 tests.
  - Build ok.
  - Full e2e 189 passed / 8 skipped (ports 1520/4110).
  - Backend and contract were not re-run on the merge. They are unchanged by this branch; the
    Task 9 gate on the branch had contract ok, ruff ok and pytest 5 306 passed.
- **Installer rebuilt from `8340215a` and installed.** `Kestrel AI_0.1.0_x64-setup.exe`,
  1 891.8 MB, `/VERYSILENT`, exit 0. It reuses the frozen sidecar from `914c4d5b`, which has no
  backend diff to `8340215a`. This install therefore carries M1 am-u1..u7 and the site basemap.
- **Decisions the controller made during the build (R1–R15)** are in the git-ignored ledger
  `.superpowers/sdd/2026-10-02-workspace-rail/progress.md`. The ones the operator will notice:
  - "All surveys" covers findings and detections only; measurements keep following the `r` survey.
  - Side-by-side compare closes the panel.
  - Arming a tool shows its topic's hidden rows.
  - Clip is hidden when the engine cannot clip.
  - The cloud inspector shows the most recent selection.
  - Align stays in both the Drawings tool row (and K) and the drawing inspector.
  - Picking a cloud pin does not switch the open panel.

## Why

The operator called the map preview "too complex" with tools spread over several separate panels.
The rail gives each concept one home and the same layout on Maps and Point clouds, so habits carry
over, and the two screens now share one `ui/WorkspaceRail` instead of drifting apart.

## Open threads

- **Known bug, not fixed:** after `\` opens the panel, focus lands on its first control, which on
  the map is the header eye. A following Space or Enter presses it, hiding the topic, instead of
  panning. Suggested fix: on a `\` open, focus the panel region (`tabIndex -1`), and keep
  first-control focus for Enter or Space on a rail button (`ui/WorkspaceRail.tsx`).
- **Accepted spec deviations:**
  - no volumes list in the map Measure topic (no bounded volume store);
  - no header eye on the cloud topics;
  - the Photos topic is help text only (Likely views stay in the finding detail);
  - the cloud lists still render every row (capped) instead of using `TopicList`, and their ARIA
    differs from the map's.
- **Not run:** the CDP drivers changed in `2659edd5` (`cloud-ui.mjs`,
  `measure-cloud-workspace.mjs`, `check-packaged-webview.mjs`). Also unrun: the e2e flows "filter a
  map finding" and "review a detection from the AI topic".
- **`main` not pushed to `origin`.** Since `8340215a` other sessions have added `d1915121` and
  `2a5c4523`; those are not in the installed build.
- **Not opened by the operator** in the installed app yet.

## How to test

1. Open Kestrel AI → a project → **Maps**. Top-left there is a rail: Select and Pan, then Layers ·
   Findings · Measure, a divider, then AI · Drawings. The Findings panel is open next to it.
2. Click **Layers**: base maps and elevation appear with one **+** import menu. Click it again and
   the panel closes. Press `\` and it reopens.
3. Press **L**: the Distance tool arms and the panel switches to **Measure**. Press `\` to close
   the panel, then **M**: the finding tool arms and the panel stays closed.
4. In **Findings**, click the eye (it hides findings and zones). Start a finding point: findings
   show again.
5. Click a finding in the list: the map frames it and the inspector opens on the right (340 px).
6. **Drawings**: one "Import drawing" button and the Align tool. A drawing row's ⋯ menu lists only
   Properties, Re-import and Delete.
7. **AI**: "Run on the whole map" is here. The rail icon carries a badge with the count of
   detections waiting for review.
8. The timeline bar ends with an **All surveys** switch. Switching compare to Side-by-side closes
   the panel.
9. **Point clouds**: the same rail (Orbit · Pan · Fly | Layers · Findings · Measure | Clip ·
   Photos). **Layers** holds colour mode, point size, budget, EDL and camera positions.
10. Save a measurement, then click a finding pin: the inspector shows the pin, while the lists
    stay in the rail. With about 20 measurements, the Measure list scrolls.

## Next session entry point

Fix the `\` focus bug in `frontend/src/ui/WorkspaceRail.tsx` (see Open threads; add a test that
`\` focuses the region, not the eye). Then push `main`, and have the operator walk the 10 steps
above in the installed build.
