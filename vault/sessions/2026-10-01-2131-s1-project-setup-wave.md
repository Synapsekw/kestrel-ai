---
type: session
date: 2026-10-01-2131
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-01-gotcha-tauri-drag-drop-blocks-html5-drag]]", "[[2026-10-01-photo-import-is-per-folder]]", "[[2026-09-30-setup-imports-a-shared-thermal-folder-once]]", "[[2026-09-30-setup-dispatch-lives-in-a-store-not-the-page]]", "[[2026-09-30-gotcha-ui-only-keys-in-a-strict-request-body]]"]
---

# 2026-10-01-2131-s1-project-setup-wave

## What changed

- **Brainstorm (2026-09-30).** The operator compared four layouts for creating a project, shown as
  mockups in a claude.ai artifact ("Kestrel New Project Setup"). They chose **A**: a template row,
  then one page with Basics, Data and Anomalies, and a summary that stays in view. For v1 they also
  chose drop-folder sorting, AI "Describe it", AI "Show it" and "Save as my template". The work was
  split into S1 (setup page, templates, sorting, catalogue fields), S2 (AI Describe it plus severity
  pre-fill), S3 (AI Show it) and S4 (video import). Severity rules were ruled to **pre-fill**
  severity in AI detection (that is S2). Only **S1** was built this block.
- **Spec and plans.** The spec `docs/superpowers/specs/2026-09-30-project-setup-design.md` and the
  plans (`2026-09-30-setup-index.md`, plus `-u1` to `-u6`, about 19.6k lines from six parallel
  planners, reconciled as rulings S-R1 to S-R17) went to `main` at `ea5d13cb`.
- **Build.** Six units, each in its own worktree under an opus unit controller (SDD), merged one at
  a time under the merge lock shared with the Reports wave (`imc-common/merge-queue.lock`). All
  pushed:
  - U1 (`217a4914`): the contract, catalogue migration `0003` (`definition`, `severity_rules`, the
    `project_template` table, three built-in templates) and the `setup_inspect` job type.
  - U2 (`3c8c0f7f`): the template CRUD, `POST /catalogue/types/ensure` and `ProjectCreate.hotkeys`.
  - U3 (`10a41dd2`): the header-only `setup_inspect` classifier and walk, capped at 50,000 files,
    10,000 folders, 20 photos read per folder and 500 buckets.
  - U4 (`0844bd3d`): the Catalogue type editor gains a definition field and ordered severity rules.
  - U5 (`02537e4b`): the setup page at `/projects/new`, replacing `NewProjectDialog`.
  - U6 (`7bfb2b5b`): create, then import through the existing importers; the Overview setup notice;
    e2e journeys (mock and real backend); four ADRs; `docs/evidence/setup/walkthrough.md` (37
    steps, five screenshots); and the `docs/progress.md` entry.
- **Size.** About 10.1k lines were added under `backend/app/setup`, `frontend/src/setup`,
  `backend/app/catalogue` and `contract` (68 files).
- **Last checks** on U6 with `main` merged in: contract ok, lint ok, vitest 4116 passed, build ok,
  e2e 180 passed, and the setup/contract/catalogue pytest subset 630 passed. U6's own full gate:
  5170 backend passed. No installer was built, and cargo test was skipped because no frozen sidecar
  was present.
- **Unit walkthroughs** are kept in `.superpowers/sdd/setup-common/walkthroughs/` (git-ignored).
  The combined one is in the repo.

## Why

The operator wanted creating a project to be the place where the job is set up: choose what is
being inspected (mapping, vertical asset, confined space), drop the delivery folder, and decide
which anomalies to look for, all in one screen. Templates only pre-fill, because F5 removed project
kinds on purpose.

## Open threads

- **S2, S3, S4 are not started.** Each needs its own brainstorm, spec and plan. S4 must flip the
  Confined template's video slot to required with a new catalogue revision (`0003` is frozen), set
  `VIDEO_IMPORT_ENABLED = True` in `app/setup/classify.py`, and update U1's frozen-copy tests.
- **Photo import is per folder and recursive.** A dropped single photo imports its whole folder; the
  page now warns about it. A skipped photo bucket nested in a dispatched folder is still imported,
  silently. Real fix: a file list on `POST /sources`.
- **Map-layer reordering may be dead in the installed app** (HTML5 drag; see the ADR).
- **Follow-ups parked by the units:**
  - Ensure returns 500 for a legacy type with a non-hex colour.
  - DJI sidecars and Thumbs.db show up as "Not recognised".
  - The worst-case inspect result is about 5–8 MB.
  - The template radiogroup has no arrow keys.
  - The catalogue picker is silent at 64 types.
  - `playwright.real-backend.config.ts` hard-codes the venv path.
  - Contract wording: `ProjectCreate.hotkeys` null.

  The full list is in the walkthrough's Follow-ups section and in `docs/progress.md`.
- **Not verified by the operator.** The S1 walkthrough has not been run on real drone deliveries,
  and there is no installer containing S1.

## How to test

Follow `docs/evidence/setup/walkthrough.md` (37 steps). In short:

1. Run `pnpm -C frontend dev` (or a fresh desktop build), go to Projects, then **New project**.
2. Choose **Vertical asset inspection**. The Data card shows 4 slots and Anomalies shows 7 types
   with hotkeys 1–7.
3. Drop a DJI M30T delivery folder, or paste its path into "Folder or file path" and click **Sort
   files**. Visual photos and Thermal photos fill with counts. Create stays disabled while sorting.
4. Fill in Name and Folder, then click **Create project**. The Overview opens at once, Jobs shows a
   single Import for the shared V/T folder, and the template's types appear in the Catalogue.
5. Open Catalogue, then a type. The definition and severity rules can be edited and are saved.

## Next session entry point

Run the S1 walkthrough on real data. Then brainstorm **S4 (video import)**, which unblocks
the Confined template, or **S2 (AI Describe it)**. State is in
`.superpowers/sdd/setup-common/coordinator.md` and `handoffs.md` (git-ignored).
