---
type: session
date: 2026-09-27-1030
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-26-foundation-contract-lands-before-its-backend]]", "[[2026-09-26-migration-framework-ships-disarmed]]", "[[2026-09-26-project-classes-derive-from-project-types]]", "[[2026-09-26-gotcha-lasting-opacity-animation-disables-glass-blur]]", "[[2026-09-26-gotcha-translucent-tokens-take-no-opacity-modifier]]", "[[2026-09-26-gotcha-yaml-flow-mapping-comma-splits-a-description]]", "[[2026-09-26-gotcha-fastapi-app-routes-hides-included-routers]]"]
---

# 2026-09-27-1030 Foundation of the inspection platform

## What changed

231 commits on `main`, `09fb538..f3ff568`, all pushed. The commits before `09fb538` (`model-gsd`) came
from another session and are not part of this block.

**Brainstorm (2026-09-26).** The operator rebuilt the product vision into an all-in-one drone
inspection app:
- one project holds images, maps, elevation, drawings and point clouds
- Projects and Models are separate top-level sections
- one app-wide catalogue, where each type is a Defect or an Object
- one severity scale, 1–4
- one Finding entity, with a status of Open → Reviewed → Closed
- training data is pulled from inspection projects
- boxes and polygons
- existing projects migrate automatically

The visual direction is **D · Aero glass**, chosen from four live mockups. The three workspace
mockups (Images, Maps, Point clouds) were approved as drawn. The mockups are in
`.superpowers/brainstorm/1481982-1790403567/content/`, which is git-ignored.

**Specs and plans:**
- `ba3bc95` — six specs. The umbrella is `docs/superpowers/specs/2026-09-26-inspection-platform-design.md`
  (decisions D1–D11 and §10, a reconciliation log of 27 cross-spec fixes). The five sub-specs are
  foundation, image-inspection, map-workspace, point-cloud-workspace and reports.
- `ba397b5` — nine Foundation unit plans, plus the index
  `docs/superpowers/plans/2026-09-26-foundation-index.md` with batches, merge order and coordinator
  rulings.

**Foundation built and merged.** Eleven units. Each ran subagent-driven development in its own
worktree, under an opus unit-controller sub-agent. The coordinator did every merge by hand, in
order:

| Unit | Merged at | What |
|---|---|---|
| C0 contract | `8df7682` | 47 new operations, `kind` removed, 501 stubs, `legacyKind` shim |
| BK | `cae9491` | kind guard gone, Data list, search, app-wide jobs, `last_opened_at` |
| DS | `fd55985` | Aero glass tokens, fonts, motion, reduced effects, keymap, all `ui/` primitives, gallery |
| MG-framework | `23512f1` | copy-first backup, resumable `project_migrate` job, 409 gate, missing-folder listing |
| SH | `f448175` | rail, top bar, Ctrl K palette, tabs, transitions, `?` sheet, kind UI deleted |
| BC | `825c874` | `catalogue.db`, severity scale, project types, Finding core, `0010`, overview, operator name |
| BM | `ebb5143` | library `0002`, datasets across projects, training in the library, class map, `segment` |
| S1 | `54126d1` | Projects page, Overview dashboard, Add data, Findings tab and inspector |
| MG-steps | `822e095` | 7 migration steps, pipeline armed, on-open sweeps held until upgrade |
| S2 | `7477e3c` | Catalogue and severity screens, Models (Datasets, Training, Compare), Jobs, Settings, Types editor |
| X evidence | `16b484e` | journey e2e, effects/frame-time e2e, dry run, cleanups, packaging fix, installer |

`f3ff568` adds `docs/evidence/foundation/rulings.md`: every ruling (~260) that controllers and the
coordinator made on the operator's behalf.

**Final gate** (X, at `bb1612d`, then again after the fix wave):
- pytest 2576 passed
- vitest 1622 passed
- e2e 103 passed
- `cargo test` 8 passed

**Smoke and packaging:**
- `smoke_frozen.ps1` ok, including CUDA on the RTX 5070 Ti.
- Smoke found a real packaging bug: the catalogue's Alembic migrations were not bundled. Fixed in
  `eca3d28`, and pinned by a static test in `73dd229`.

**Migration evidence.** The real-folder dry run ran on copies of AHTest, Ahmadia and
acceptance-project. Every project reached `0010` at v2, and 120,278 boxes were rewritten, with 0
unmapped. The originals hash identical before and after. Evidence is in
`docs/evidence/foundation-migration/`.

**Installed 2026-09-27.** The installer was built at the fix-wave head. It was copied to
`dist/Kestrel AI_0.1.0_Foundation_2026-09-27_x64-setup.exe` (SHA-256 `3a204ec3…4129`) and installed
with `/VERYSILENT /CURRENTUSER`: exit 0 in 80 s.

## Why

The operator found the app "too bland" and too narrow. They want a finished-product feel (smooth,
modern, micro-animations, dashboards) and one project for any kind of drone inspection data.
Foundation is the prerequisite for everything else: the project model without kind, the catalogue,
findings, the Models section, the design system and the shell. The Images, Maps and Point cloud
workspaces and Reports build on it.

## Open threads

- **The installed build has not been opened yet.** Its first start upgrades the real projects, with
  a backup of each in `<project>\backups\`. After that, older builds cannot open them. The operator
  walkthrough (below) is owed, especially step 8, the glass frame rate on the real GPU. Headless
  evidence only proves no dropped frames at 60 Hz under SwiftShader.
- **Next wave not started.** No I, M or C plans exist yet. They must be written against the merged
  Foundation code, because the specs predate it. R follows them.
- **Parked design item:** a finding edit can trigger up to 10 bounded re-reads when a live
  `findings.changed` echoes the client's own write. Dedupe the echo in the next wave.
- **Deferred minors:** ~200 lines across the unit ledgers (coordinator copies in
  `.superpowers/sdd/foundation-common/ledgers/`, git-ignored). Triaged "can wait" by each final
  review. Notable ones:
  - two catalogue operations and `createProject` refuse 422s the contract doesn't declare
    (`UNDECLARED_REFUSALS`)
  - library jobs unseen in a session don't toast
  - search is ASCII-only case-insensitive (Č/Ć/Š/Ž/Đ)
- **Load-only flakes seen:** `lazyScreens.test`, `MapReviewPanel.test`, `test_import_sample_frames`,
  `test_project_agent_e2e`, `clouds.spec` (`ERR_NO_BUFFER_SPACE`). All pass when run alone.
- **Leftover worktree folders** that couldn't be deleted (locked): `.claude/worktrees/f-c0`, `f-ds`,
  `f-bm`. They are unregistered. The `model-gsd` worktree belongs to another session and is merged.
- `scripts/start-task.ps1` and `scripts/finish-task.ps1` throw under Windows PowerShell 5.1: git
  writes progress to stderr, and there is no pwsh. Every merge this block was done by hand,
  following the scripts' steps.

## How to test

On the installed build (Start menu → Kestrel AI):
1. Open the app. The projects appear as cards, and each upgrades once ("Upgrading…", then normal).
   `<project>\backups\project.db.v1-*.bak` exists.
2. Open AHTest. The Overview tiles count up, and you see the map hero, the severity bars and the
   activity feed.
3. Catalogue: the 8 migrated types are listed as Object, with a banner asking you to classify them.
   Mark one as Defect, run the backfill, and findings appear.
4. Findings: filter by severity, open a finding, and press 1–4 to set severity. Add a note, a photo
   and a comment, then copy its link.
5. Add data: each of the five tiles opens the right importer. Drawing is disabled.
6. Models: build a dataset across two projects and start a short training run on it.
7. Jobs: the run shows progress, its log and a cancel button, and toasts appear on any screen.
8. Settings → Appearance: switch effects between Full and Reduced. It should stay smooth on the
   GPU; this is the real frame-time check.
9. Press Ctrl K and jump to a finding by its number. Press `?` for the shortcut sheet.

## Next session entry point

1. Read `vault/00-north-star.md` §4, the umbrella spec
   `docs/superpowers/specs/2026-09-26-inspection-platform-design.md`, and the Foundation index.
2. Ask the operator for the walkthrough result, and fix anything it surfaces first.
3. Write the I (Images), M (Maps) and C (Point clouds) implementation plans in parallel against the
   merged code. The specs are `2026-09-26-image-inspection-design.md`, `-map-workspace-design.md`
   and `-point-cloud-workspace-design.md`. Reconcile the plans against each other, as for
   Foundation.
4. Build them with the nested-controller pattern (memory `nested-unit-controllers`), then write and
   build R (Reports).
