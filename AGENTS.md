# Where things live

Kestrel AI is a Tauri 2 + FastAPI + YOLO Windows desktop app for aerial construction-machinery
detection. Orientation map:

| Path | What's there |
| --- | --- |
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference. Python 3.11 in `backend/.venv` (uv) |
| `frontend/` | Tauri 2 shell (`src-tauri/`, Rust) + the React/TS/Vite UI (`src/`) |
| `frontend/src/ui/` | The design-system primitives; `frontend/scripts/check-tokens.mjs` enforces their use |
| `contract/` | `openapi.yaml` (source of truth), the generated TS client, Prism mock, Spectral lint |
| `docs/` | `progress.md` (the evidence ledger), `superpowers/{specs,plans}`, `evidence/` |
| `vault/` | Dev memory: `00-north-star.md`, `decisions/` (ADRs), `sessions/` |
| `.superpowers/sdd/` | Per-plan SDD workspaces: ledgers, task briefs, review packages |

# Engineering invariants

- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is generated and
  committed in the same change, never hand-edited — otherwise the client silently drifts from the
  API it calls.
- API keys live only in Windows Credential Manager, never in a project folder, app-data file, log,
  error message or commit — a leaked key is a real-money incident, not a bug report.
- Long work (training, inference, import, export) is a **background job with progress**, never
  blocking the UI — the desktop shell has no server to fall back on if a request just hangs.
- Hot-path reads are **bounded** — no loading a full image set into memory; datasets are large
  enough that "just load it all" is how you run a machine out of RAM.
- The app must start even when startup work fails; a failed app-data migration logs and continues
  — a broken migration must never be the reason the app won't open.
- Tauri's `capabilities/default.json` is a **runtime** allow-list. Changing a sidecar name there is
  not caught by any test — see `vault/decisions/`.

# Dev memory

This repo keeps a tracked Obsidian vault at `vault/`. At the end of a working block run `/wrapup`
to log a session note in `vault/sessions/` and bump `vault/00-north-star.md`. Record non-obvious
traps as ADRs in `vault/decisions/`.

# Working agreement

1. **`main` + task worktrees.** The main checkout is the integration home — never build in it.
   Each building session gets a worktree at `.claude/worktrees/<name>` on a `task/<name>` branch
   (nested inside the project on purpose, so dispatched subagents can write into it). Commit
   identity is pinned. Stage by path — never `git add -A`. A task is not done until the gates
   pass, it is merged to `main`, the worktree is removed and the branch deleted, and the operator
   has a numbered "how to test this" walkthrough (or one line saying the change is not
   user-observable). Trivial edits are exempt and may go straight on `main`.
2. **Superpowers skills for non-trivial work** — `brainstorming` before building,
   `test-driven-development`, `verification-before-completion`, `systematic-debugging`,
   `subagent-driven-development`. A one-line fix is just a one-line fix.
3. **UI work loads the design skills first**, together with `DESIGN.md` (the "Site office"
   system) and the primitives in `frontend/src/ui/`.
4. **Tests are mandatory** — written and executed. The gate:
   ```
   pnpm -C contract check
   cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
   pnpm -C frontend lint
   pnpm -C frontend test
   pnpm -C frontend build
   cargo test --manifest-path frontend/src-tauri/Cargo.toml
   ```
   See `CONTRIBUTING.md` → "Testing" for the packaging-path additions and the worktree/venv note.
5. **Contract-first.** `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts`
   is generated and committed in the same change, never hand-edited (the local analogue of
   Monolith's migrations-and-regenerate-types rule).
6. **Every spec and plan states a budget and an execution DAG.** Budget: what is a background job
   (training, inference, import, export); what read is bounded (never a full image set in memory).
   DAG: the independent units, the parallel batches, the critical path. A flat sequential task list
   is not ready to build.

`CONTRIBUTING.md` carries the detail.
