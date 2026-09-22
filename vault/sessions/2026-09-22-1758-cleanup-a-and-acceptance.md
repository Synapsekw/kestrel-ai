---
type: session
date: 2026-09-22-1758
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app]]"]
---

# 2026-09-22-1758-cleanup-a-and-acceptance

## What changed

Two task worktrees, both merged to `main` and pushed (`f59007b..93892bd`, 10 commits).

**`task/cleanup-a`** (merged at `8823d95`; gate on the merged state: contract, ruff, ruff format,
669 pytest, lint, 537 vitest, build, 61 e2e; CI on the branch green on all four jobs incl.
`sidecar-smoke`):

- `add5c20` fix(ui): `Select`'s wrapper dropped the caller's width. `cx()` only joins classes and
  Tailwind emits `w-full` after `w-[4.5rem]`, so the hotkey select took the whole row and squeezed
  the class-name inputs in project settings. `frontend/src/ui/Input.tsx` now omits `w-full` when
  the caller passes a `w-` width. Unit tests in `Controls.test.tsx`.
- `3015f99` test(e2e): a real-browser layout check in `e2e/settings.spec.ts`; it fails without the
  fix (hotkey select measured 730 px). Evidence `docs/evidence/cleanup-a/settings-classes.png`.
- `6b04cd1` fix(exports): G3 - report thumbnail labels are a 14 px tag filled with the class colour,
  black/white ink by WCAG contrast, kept inside the image at the top edge
  (`backend/app/exports/html_out.py`, 3 new tests). Evidence `docs/evidence/cleanup-a/g3-report-thumbnail.jpg`.
- `be87fda`, `a4eb3c9` ci: every action on its Node 24 major (checkout v7, setup-node v7,
  pnpm/action-setup v6, cache v6, upload-artifact v7, setup-uv pinned `v10.2.0` because it
  publishes no moving `v10` tag).
- `fde7f8f` test: GPU/live/real-frame tests read `KESTREL_MODELS_DIR` / `KESTREL_FRAMES_DIR`
  (`backend/tests/local_paths.py`), defaults unchanged; documented in `CONTRIBUTING.md`.
- `8823d95` docs: G3 and G2/M3 closed in `docs/usability/2026-09-19-walkthrough.md` and
  `docs/progress.md`. M3 had been closed at `efa614a` all along; only the ledger row was stale.

**`task/release-acceptance`** (merged at `93892bd`; same gate plus `cargo test` 8 passed):

- Rebuilt and installed from `8823d95`: freeze 3,520.5 MB, `smoke_frozen.ps1` ok, installer
  1,853.3 MB kept at `E:\Dev\Yolo\installers\Kestrel AI_0.1.0_x64-setup-8823d95.exe`. Clean install
  exit 0; both exe hashes match and all 14,115 `_internal` files present at build size.
- Acceptance **8/8 PASS** on the installed renamed build (`docs/evidence/acceptance/2026-09-22-installed-8823d95/`),
  closing rename plan Task 11 Steps 5-6. G3 confirmed in the frozen bundle by an exported report.
- `22e0c30` fix(acceptance): the driver stops (exit 3) if its window leaves the run's project and
  shows a red banner. Proven by navigating a resumed run to a made-up project id.
- `65d8f19` ADR [[2026-09-22-gotcha-acceptance-window-looks-like-the-operators-app]].

Outside git: the operator's project `E:\Projects\AHTest` was repaired with consent after the
driver wrote into it (pre-annotation model back to none, duplicate `yolo11m-coco` `30ceecdb`
deleted; no boxes or runs came from it).

## Why

Batch A of the review agreed with the operator at the start of the session: pay off the owed items
before new features (direction D, counts per flight). The installed app lagged `main` by the
editor/train fixes from `afba411`, and the only acceptance pass predated the rename.

## Open threads

- The acceptance run took four passes. The operator used the driver's window (it looks like the
  app) and step 3 wrote into their project; the window was later closed twice mid-run, once after
  38 paid Anthropic tile calls; one pass omitted `--conf 0.001`. All recorded in the ADR and the
  evidence README. The final 8/8 ran with the operator's app closed.
- The first silent install exited 5 (app reopened mid-install); fixed by a clean reinstall.
- 49 stale files from the 2026-09-21 install remain in the install's `_internal/` (45
  `api-ms-win-*` forwarders, 4 `__pycache__`). Harmless; an `[InstallDelete]` would clear them.
- `acceptance-04-dataset.png` in this run shows the editor (resume artifact), noted in the README.
- Another session's worktree `.claude/worktrees/project-agent` (`task/project-agent`) exists; not
  this block's work and untouched.
- CI for `93892bd` was still running at wrapup time (`8823d95` was green).

## How to test

1. Open Kestrel AI from the Start menu (the new build from `8823d95`).
2. Open a project -> **Project** (settings). Expected: each class-name field fills the row; the
   hotkey dropdown beside it is narrow (about 72 px).
3. **Export** -> tick HTML report -> **Export** -> open the report. Expected: each box's class name
   sits in a solid tag of the class colour with dark or white text, readable on the sand imagery;
   unreviewed proposals read "name ?".
4. In the editor, press a class hotkey right after opening an image. Expected: the key is not
   dropped (the `afba411` fix, now installed).
5. Optional: `docs/evidence/acceptance/2026-09-22-installed-8823d95/README.md` for the 8/8 record.

## Next session entry point

Brainstorm direction **D, counts per flight** (per-flight/per-date machinery counts, trend, Excel
export, GPS map), agreed with the operator as the next feature. Start with the brainstorming
skill; the import already stores EXIF time/GPS and a flight group key.
