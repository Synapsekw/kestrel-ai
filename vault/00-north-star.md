---
type: north-star
status: active
last-updated: 2026-09-20
tags: [project/kestrel-ai, north-star]
---

# Kestrel AI — North star

This is the Obsidian homepage for the Kestrel AI vault. Read this first, on any machine.

## 1. Pitch

**Kestrel AI** is a Windows desktop app that takes a construction team from a folder of aerial
drone frames to a trained machinery detector and reviewed counts, without a terminal and without
reading documentation. It covers dataset preparation, bounding-box annotation, YOLO training with a
model registry, and inference with either local models or OpenAI/Anthropic vision models — replacing
Label Studio, ad-hoc scripts and the Ultralytics CLI (`PRODUCT.md`).

Stack (`README.md`):

| Part | What | Tooling |
|---|---|---|
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference | Python 3.11.15, uv, pytest, ruff, PyInstaller |
| `frontend/` | Tauri 2 shell with the React/TypeScript/Vite UI | pnpm, Vitest, Playwright, Rust stable MSVC |
| `contract/` | `openapi.yaml` (source of truth), generated TS client, Prism mock server | pnpm |

Master spec: [[2026-09-17-kestrel-ai-app-design]]. Product context: [[product]]. Architecture map:
[[architecture]].

## 2. Where we are

Renamed from "Machinery Detection" / `machinery-app` to **Kestrel AI** / `kestrel-ai` on
2026-09-20 (full name map: `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1).
The evidence and checkpoints below predate the rename and keep the old names on purpose — that is
deliberate history, not an error.

All of the core-pipeline waves (S0–S6) are merged to `main`:

- Wave 0 (S0 contract and scaffolding) — merged, checkpoint 1 passed.
- Wave 1 (S1 dataset backend, S2 annotation UI, S3 training backend and registry) — merged,
  checkpoint 2 passed (backend and editor halves), GPU training verified on `main`.
- Wave 2 (S4 inference and providers, S5 training/inference UI) — merged after 2 fix rounds each,
  checkpoint 3 passed.
- Wave 3 (S6 packaging and acceptance) — merged after 2 fix rounds, checkpoint 4 passed.

Last verified checkpoint: 4, re-verified after usability wave 1 on main `88d9216` (installed app),
2026-09-19 (`docs/progress.md:59`).

On top of that, the Phase 2 usability wave and the site-office UI redesign are also merged to
`main`, and acceptance step 7 has since closed 8/8 on the installed app at `177f68b` (2026-09-20) —
see §3 for the breakdown and §5 for why that figure is not the last word.

## 3. Phases

| Phase | Status | Outcome |
|---|---|---|
| Wave 0 — S0 contract & scaffolding | merged | checkpoint 1 passed |
| Wave 1 — S1 dataset backend, S2 annotation UI, S3 training backend & registry | merged | checkpoint 2 passed (backend + editor); GPU training verified on `main` |
| Wave 2 — S4 inference & providers, S5 training/inference UI | merged (2 fix rounds each) | checkpoint 3 passed |
| Wave 3 — S6 packaging & acceptance | merged (2 fix rounds) | checkpoint 4 passed; acceptance run passed, step 7 skipped (no provider key at the time) |
| Phase 2: usability (goal 2) — friction-list fixes, starter weights, negative images, Datasets screen, results export | merged to `main` | acceptance closed 8/8 on the installed app (`177f68b`), step 7 with a stored provider key; friction list closed except G3 and G2/M3 (see §5) |
| Site office UI redesign (U2) | merged to `main` (`2bc15a4`) | every screen restyled on `frontend/src/ui/`; walk-through 12 steps / 66 checks against the real backend |
| Kestrel AI rename | naming and code renamed 2026-09-20 | acceptance has **not** been re-run against the renamed installed build — see §5 |

Plans (`docs/superpowers/plans/`): [[2026-09-17-s0-contract-and-scaffolding]],
[[2026-09-17-s1-dataset-backend]], [[2026-09-17-s2-annotation-ui]],
[[2026-09-17-s3-training-backend]], [[2026-09-18-s4-inference-providers]],
[[2026-09-18-s5-training-inference-ui]], [[2026-09-18-s6-packaging-acceptance]],
[[2026-09-19-u2-site-office-ui]], [[2026-09-20-kestrel-ai-rename]]. Full index: [[roadmap]].

## 4. Now

**Shipped last:** the repo is published —
[`github.com/Synapsekw/kestrel-ai`](https://github.com/Synapsekw/kestrel-ai), public, default
branch `main`, MIT licensed, with `main`, `s6-packaging-acceptance`, `usability-wave1` and
`wave1-s2-trial` pushed — and the fresh-clone verification (Task 12 Steps 1-3 of
`docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md`) passed: a scratch clone from GitHub had
every required path (vault, 19 ADRs, vendored Dataview, all six SDD wave directories,
`AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`/`LICENSE`, both worktree scripts, `/wrapup`) and leaked
nothing that should be excluded (no venv, no `node_modules`, no `.env`). Before that: acceptance
step 7 (H2) closed 8/8 on the installed app at `177f68b` (2026-09-20), following the usability wave
and the site-office UI redesign merging to `main` (`2bc15a4`).

**In flight:** the `start-task.ps1` → `finish-task.ps1` round trip (Task 12 Step 4) — started for
real, failed once, fixed, and now **paused by operator decision** before merge/push. See §5 for the
full state and why.

**Next:** resume and complete the paused round trip (§5); re-run acceptance against the renamed,
installed Kestrel AI build (§5); close the outstanding friction-list minors G3 and G2/M3 (§5); do
the Obsidian GUI verification (§5).

## 5. Owed

### Round trip incomplete — `start-task.ps1` → `finish-task.ps1` (spec §7.5 unmet, blocking)

Task 12 of `docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md` is only partly done. The
fresh-clone test (Steps 1-3) passed. The first live gate run (Step 4, worktree `task/smoke-check`)
exercised six of seven gate steps for real and they passed — contract check, ruff, 583 pytest,
frontend lint, frontend test, frontend build — then `cargo test` failed: Tauri's build script
resolves the frozen-sidecar `externalBin` resource at compile time, and
`frontend/src-tauri/binaries/kestrel-backend-*.exe` is git-ignored (`.gitignore:19`), so no fresh
worktree or clone has it. `finish-task.ps1` was fixed to make that step conditional on the sidecar's
presence (commit `4807473`; see
`vault/decisions/2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar.md`) and correctly stopped
**before** merging or pushing.

The round trip is now **paused by operator decision**, not complete: spec §7.5 (a proven
`start-task.ps1`/`finish-task.ps1` round trip against a live `origin`) is still unmet. The merge,
the push and the junction-safe teardown were never reached. Worktree
`.claude/worktrees/smoke-check` and branch `task/smoke-check` (at `ad3633e`) are deliberately left
in place, ready to resume. Reason for the pause: finishing the round trip pushes `main`, and a
parallel session's in-flight OBB spec is also on local `main` — the operator chose to wait so that
work isn't carried to the public remote before the parallel session is ready. Do not treat
`start-task.ps1`/`finish-task.ps1` as proven end-to-end until this resumes and completes.

### Unpushed commits on local `main` — `origin/main` is behind

Local `main` is ahead of `origin/main` (`0ce41f5`). At minimum this includes `59b28a4` (a parallel
session's OBB spec — not this plan's work) and `4807473` (this plan's `cargo test` gate fix). As of
this note, two further parallel-session commits (`8bf1add`, `c739d7e`) have also landed on local
`main` and are likewise unpushed — none of the four have been pushed. A second machine cloning from
GitHub right now gets `origin/main` at `0ce41f5` and will **not** have the conditional-gate fix; it
would hit the same `cargo test` failure Task 12 Step 4 hit.

### Obsidian GUI verification owed (spec §7.3)

Nobody has opened this vault in the Obsidian app to confirm Dataview queries render, Templater
expands `vault/templates/session.md` without error, and the Homepage plugin opens
`vault/00-north-star.md` on startup. Carried over from the seed session note's open threads,
unresolved.

### Stale acceptance run (blocking claim of a current PASS)

`docs/progress.md` records an **8/8 PASS** for the acceptance run (spec 13.5) at main `177f68b`
(2026-09-20, the U2 site-office build; evidence `docs/evidence/acceptance/2026-09-20-installed-177f68b/`,
driver run committed at `df39048`). That build **predates the Kestrel AI rename** — every rename
commit lands after it. **It has not been re-run against the renamed, installed Kestrel AI build.**
Do not read the 8/8 as a current PASS. This is tracked as **Task 11 Step 5** of
`docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md` ("Re-run acceptance ... The previous 8/8
was measured on the old build and is stale until this passes").

(The earlier run at main `9a2e20d` (installer built at `9f3aa01`), 2026-09-18, is a different,
earlier result: 7/8, step 7 skipped for lack of a provider key — not the run the 8/8 figure
belongs to.)

### Other open items found while reading `docs/progress.md`

- **G3** (class labels on report thumbnails) — noted open after usability wave 1
  ("`G3 (class labels on report thumbnails) after this wave`"); no later entry in `docs/progress.md`
  records it closed.
- **G2/M3** — a minor item deferred within the results-export work
  ("`every item closed except G2/M3 (in G2) and H2`"); H2 (acceptance step 7) has since closed
  (2026-09-20), but `docs/progress.md` records no resolution for G2/M3.

## See also

- [[product]] — product purpose, users, tone, design language
- [[architecture]] — where each part of the app lives
- [[roadmap]] — phases and plans, indexed
- [[specs]] — the spec documents, live
- [[operations]] — build, freeze, installer, acceptance
- [[memory]] — how this vault's memory is layered
