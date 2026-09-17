# Progress log

Resume instructions for a new session: read this file top to bottom, then the plan for the
sub-project whose state is not `merged`, then continue from its first unchecked task.

## Current state

| Wave | Sub-project | Branch | Worktree | State | Blockers |
|---|---|---|---|---|---|
| 0 | S0 contract and scaffolding | main | (root) | in progress | none |
| 1 | S1 dataset backend | - | - | not started | S0 |
| 1 | S2 annotation UI | - | - | not started | S0 |
| 1 | S3 training backend and registry | - | - | not started | S0 |
| 2 | S4 inference and providers | - | - | not started | wave 1 checkpoint |
| 2 | S5 training and inference UI | - | - | not started | wave 1 checkpoint |
| 3 | S6 packaging and acceptance | - | - | not started | wave 2 checkpoint |

Last verified checkpoint: none.

## Plans

- S0: `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md`

## Decisions the spec does not cover (question, chosen default)

1. Where do the shared job runner, event bus, SQLite models, migrations and project store live?
   Default: in S0. Three Wave 1 sub-projects need them and would otherwise each invent one.
   S1, S3 and S4 register job types through `app.jobs.registry.register_job_type`.
2. Are jobs global or per project? Default: per project (`/projects/{p}/jobs`), because the Job
   table is in `project.db` (spec section 4). The websocket `/api/v1/events` is global and
   every event carries `project_id`.
3. How does the browser get the token for the websocket? Default: `?token=` query parameter,
   because browsers cannot set headers on websocket connects. Rejected connects close with 4401.
4. Mock server and client generator: Stoplight Prism serves `openapi.yaml` on 127.0.0.1:4010;
   `openapi-typescript` generates `contract/client/schema.d.ts`; `openapi-fetch` wraps it.
5. Ports: backend dev 8765 (the launcher picks a free port in the packaged app), mock 4010,
   Vite 1420. 8080 and 9090 are left to the existing Label Studio workflow.
6. Extra endpoints beyond the literal spec section 9 list, each tied to another spec section:
   `GET /projects` (recent), `PATCH /projects/{p}` (settings), `POST .../images/{id}/preannotate`,
   `POST .../models/train`, `POST .../query-runs/estimate`, `POST .../images/bulk-delete`,
   `GET /projects/{p}/stats`. Recorded in the S0 plan.
7. The S0 sidecar is a PyInstaller build that excludes torch so checkpoint 1 can prove the
   boot mechanism quickly; S6 produces the full CUDA build.
8. Python dependency management: `uv venv --python 3.11.15` under `backend/.venv` and
   `uv pip install -r requirements-dev.txt`. The ML stack is pinned to the reference machine;
   app libraries are pinned by `requirements-lock.txt` produced after the first install.
9. Tauri identifier `ai.synapse-solutions.machinery-app`, product name "Machinery Detection".

## System installs (the single allowed exception)

- (none yet)

## Checkpoints

### Checkpoint 1 (after Wave 0)
Not run yet.

## Log

- 2026-09-17: session 1 started. Read spec, README, reuse files. Toolchain: node 24.11, pnpm 10.24,
  uv 0.11.32 with CPython 3.11.15 available, MSVC 14.29 (VS 2019 Build Tools) and Windows SDK
  10.0.19041 present, WebView2 153 present, Rust missing. Wrote the S0 plan.
