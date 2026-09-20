---
type: spec
date: 2026-09-20
status: proposed
tags: [spec, rename, packaging]
related: ["[[2026-09-17-kestrel-ai-app-design]]", "[[2026-09-20-repo-and-dev-memory-design]]"]
---

# Rename: Machinery Detection → Kestrel AI

## 1. Goal

Rename the product, its identifiers and its build artefacts from `Machinery Detection` /
`machinery-app` / `machinery-backend` to **Kestrel AI** / `kestrel-ai` / `kestrel-backend`, and
repair everything the rename breaks — including live state already on the owner's machine.

Done means: the app builds, installs, launches, finds the operator's existing recent-projects
list and their stored API keys, and the acceptance run passes again on the renamed installed
build.

## 2. The decision that shapes everything: "machinery" is two words

`machinery` appears in this repo in two unrelated roles. Only the first is renamed.

| Role | Examples | Action |
| --- | --- | --- |
| **Product identifier** | `machinery-app`, `machinery-backend`, `Machinery Detection`, `machinery_app_lib`, `@machinery-app/contract` | **Rename** |
| **Domain noun** — the thing the model detects | `"No machinery (N)"`, `"images with machinery"`, `marked_empty` descriptions, `empties.py` | **Leave untouched** |

A repo-wide find-and-replace is therefore **forbidden**. It would rewrite the empty-marking
toolbar to "No Kestrel AI (N)", change the meaning of `contract/openapi.yaml` endpoint summaries,
and corrupt the semantics of the `marked_empty` field.

Every edit in section 4 is enumerated by file and line intent for this reason.

### 2.1 Name map

| Old | New |
| --- | --- |
| `Machinery Detection` (display name) | `Kestrel AI` |
| `machinery-app` (identifier slug) | `kestrel-ai` |
| `ai.synapse-solutions.machinery-app` (Tauri identifier) | `ai.synapse-solutions.kestrel-ai` |
| `machinery-backend` (sidecar exe, FastAPI title, pyproject name) | `kestrel-backend` |
| `machinery_backend.spec` | `kestrel_backend.spec` |
| `machinery-app.exe` (Rust binary) | `kestrel-ai.exe` |
| `machinery_app_lib` (Rust lib crate) | `kestrel_ai_lib` |
| `@machinery-app/contract` | `@kestrel-ai/contract` |
| `machinery-detection.iss` | `kestrel-ai.iss` |
| keyring `SERVICE = "machinery-app"` | `kestrel-ai` |
| `machinery-logfile-` (Rust test temp prefix) | `kestrel-logfile-` |
| Brand wordmark `Machinery` | `Kestrel AI` |

The Inno Setup **`AppId` GUID `{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}` does not change** — see §5.3.

## 3. Live state this breaks (the part that is not text)

Three renames move state that already exists on the operator's machine. Each needs a migration,
not just an edit.

### 3.1 App-data directory

The packaged app's data dir is **identifier-derived**: `sidecar.rs` calls
`app.path().app_data_dir()`, which Tauri resolves to `%APPDATA%\<identifier>`, and passes it to
the sidecar as `APP_DATA_DIR`. Today that is:

```
%APPDATA%\ai.synapse-solutions.machinery-app\
    logs\sidecar.log        written by the Rust shell (logfile.rs)
    recent_projects.json    written by the backend (appdata.py)
    settings.json           written by the backend (appdata.py)
```

Changing the identifier silently points the app at an empty new folder: the operator's
recent-projects list and settings disappear. Their actual projects are safe — those live in
folders the operator chose, referenced by path from `recent_projects.json`.

`backend/app/config.py` also carries an unpackaged default,
`%USERPROFILE%\AppData\Roaming\machinery-app`, used when `APP_DATA_DIR` is not set (dev runs).
Both move.

**Fix.** Migrate in **Rust**, in `sidecar.rs` before the sidecar is spawned — not in Python —
because `logs/` is written by the Rust shell and must move with the rest. Behaviour:

- If the new `app_data_dir()` does **not** exist and `%APPDATA%\ai.synapse-solutions.machinery-app`
  **does**, rename the old directory to the new one.
- If both exist, leave both alone and log a line naming the old path. Never merge, never delete.
- If the rename fails (file locked), log and continue with an empty new dir — the app must still
  start.
- Idempotent: once the new dir exists the check is a single `exists()` and does nothing.

### 3.2 Stored provider API keys

`backend/app/providers/keys.py` uses `SERVICE = "machinery-app"` as the Windows Credential
Manager service name. Renaming it strands the operator's OpenAI and Anthropic keys: still in the
vault, invisible to the app, with no error — the app just reports no key configured.

**Fix.** Migrate-on-read in `KeyringKeyStore`, with `LEGACY_SERVICE = "machinery-app"`:

- `get(provider)` reads the new service first. On a miss, it reads `LEGACY_SERVICE`; if that
  hits, it writes the value under the new service, deletes the legacy entry, and returns it.
- `set` and `delete` only ever touch the new service; `delete` additionally clears any legacy
  entry so a deleted key cannot resurrect on the next `get`.
- The fallback never logs the key value (the module contract in its docstring forbids copying a
  key into a log or error message).

This is self-healing and needs no operator action. It can be deleted a few releases from now.

### 3.3 The installed application

The Tauri identifier change also moves the WebView2 user-data folder, so cached frontend state
(localStorage, last window state) resets once. Acceptable and not migrated.

The install itself is governed by Inno Setup's `AppId`, not the Tauri identifier. Keeping the
GUID means the renamed installer **upgrades** the existing install rather than leaving a ghost
entry in Add/Remove Programs. But `UsePreviousAppDir=yes` means an existing install stays in
`%LOCALAPPDATA%\Programs\Machinery Detection` even as the display name becomes Kestrel AI.

**Decision.** Keep the `AppId`. For the owner's machine, uninstall the current app once before
installing the renamed build, so the install folder is `…\Programs\Kestrel AI` too. Any future
machine installs clean. This is an operator step, recorded in the release note, not code.

## 4. Rename inventory

Grouped by area. Every path is tracked-in-git unless noted.

### 4.1 Backend (Python)

| File | Change |
| --- | --- |
| `backend/app/config.py` | `data_dir` default → `…\Roaming\kestrel-ai` |
| `backend/app/appdata.py` | module docstring path |
| `backend/app/main.py` | FastAPI `title="kestrel-backend"` |
| `backend/app/providers/keys.py` | `SERVICE`, add `LEGACY_SERVICE` + migrate-on-read (§3.2) |
| `backend/pyproject.toml` | `name = "kestrel-backend"` |
| `backend/machinery_backend.spec` | `git mv` → `kestrel_backend.spec`; `EXE(name=)` and `COLLECT(name=)` → `kestrel-backend` |
| `backend/scripts/build.ps1` | spec filename, `dist\kestrel-backend` paths, staged sidecar filename, size report |
| `backend/scripts/smoke_frozen.ps1` | default `$Dist`, exe name, header comment |

Not renamed: `backend/app/datasets/empties.py`, `backend/app/exports/html_out.py`,
`backend/app/inference/service.py` — all domain-noun uses.

### 4.2 Frontend shell (Rust / Tauri)

| File | Change |
| --- | --- |
| `frontend/src-tauri/tauri.conf.json` | `productName`, `identifier`, window `title`, `externalBin` → `binaries/kestrel-backend` |
| `frontend/src-tauri/Cargo.toml` | package `name`, `description`, `[lib] name = "kestrel_ai_lib"` |
| `frontend/src-tauri/src/main.rs` | `kestrel_ai_lib::run()` |
| `frontend/src-tauri/src/sidecar.rs` | `.sidecar("kestrel-backend")`; **add the §3.1 migration** |
| `frontend/src-tauri/src/logfile.rs` | test temp prefix `kestrel-logfile-` |
| `frontend/src-tauri/capabilities/default.json` | **`binaries/kestrel-backend` in both `shell:allow-execute` and `shell:allow-spawn` allow-lists**, plus the description |
| `frontend/src-tauri/binaries/machinery-backend-x86_64-pc-windows-msvc.exe` | build artefact (git-ignored); regenerated by `build.ps1` under the new name — delete the stale file |

`capabilities/default.json` is the highest-risk single line in this spec. It is a **runtime**
allow-list: a mismatch there builds and installs cleanly, then denies the spawn at launch, and
the app comes up with no backend. Covered explicitly in §6.

### 4.3 Frontend (TypeScript)

| File | Change |
| --- | --- |
| `frontend/src/app/Brand.tsx` | wordmark `Machinery` → `Kestrel AI` (the hard-hat mark stays; a new icon is out of scope) |
| `frontend/src/api/client.test.tsx` | the two `…\Roaming\machinery-app\logs\sidecar.log` fixture strings |
| `frontend/scripts/build-installer.ps1` | sidecar filename, `$appExe` → `kestrel-ai.exe`, `.iss` filename, output setup filename |
| `frontend/scripts/checkpoint1.mjs` | `Get-Process kestrel-backend*` (4 sites) + comment |
| `frontend/scripts/checkpoint4.mjs` | `Get-Process kestrel-backend` |

Not renamed: `images.ts`, `nextStep.ts`, `AddToDatasetDialog.tsx`, `bulkActions.ts`,
`commands.ts`, `EmptyToggle.tsx`, `hotkeys.ts`, `RegionList.tsx` and their tests — domain-noun
uses, including the user-visible `"No machinery (N)"` action.

### 4.4 Installer

`frontend/installer/machinery-detection.iss` → `git mv` to `kestrel-ai.iss`. Inside:
`AppName`, `DefaultDirName` (`…\Programs\Kestrel AI`), `AppExe`, `SidecarExe`,
`OutputBaseFilename`, `UninstallDisplayIcon`, and the `[Files]` comment naming the two exes.
**`AppId` unchanged** (§3.3).

### 4.5 Contract

`contract/package.json` name → `@kestrel-ai/contract`. `contract/openapi.yaml` `info.title` →
`Kestrel AI backend API` — and nothing else in that file, since every other hit is a domain-noun
endpoint summary. Then `pnpm -C contract generate` regenerates `client/schema.d.ts`, whose diff
must show only the title change.

### 4.6 CI

`.github/workflows/ci.yml` line 76: the frozen-smoke path `.\dist\kestrel-backend\kestrel-backend.exe`.

### 4.7 Documentation

Rewritten for the new name: `README.md`, `PRODUCT.md`, `KICKOFF_PROMPT.md`,
`KICKOFF_PROMPT_2.md`, `scripts/acceptance.md`, and the **"Current state"** section of
`docs/progress.md`.

`docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` → `git mv` to
`2026-09-17-kestrel-ai-app-design.md`, keeping its original date. Inbound references updated in
`README.md`, `KICKOFF_PROMPT.md`, `KICKOFF_PROMPT_2.md`, `docs/progress.md` and
`docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md`.

## 5. What is deliberately frozen

These record what happened under the old name. Rewriting them would be falsifying a record, and
in the case of a diff, corrupting it.

- `.superpowers/sdd/**` — wave ledgers, task briefs, reports and `review-*.diff` files.
- `docs/evidence/**` — checkpoint JSON and screenshots, including the old install paths.
- The dated checkpoint, acceptance and S6-packaging sections of `docs/progress.md`.
- `docs/superpowers/plans/*.md` — historical plans, except the one inbound spec-path reference
  in §4.7.
- `.worktrees/wave1/` — git-ignored live worktree with its own venv. Not touched at all. Removal,
  if ever wanted, follows the junction rule: delete links as links, never `rm -rf`.

The old↔new mapping therefore has to live somewhere a future reader will find it. Until the vault
exists, **that place is §2.1 of this spec**. The dev-memory work that follows
([[2026-09-20-repo-and-dev-memory-design]] §4.3) lifts the §2.1 map into a dated ADR in
`vault/decisions/` as part of its seeding — so a reader hitting `machinery-backend` in an old
review diff can resolve it without reading this spec end to end.

## 6. Verification

In order. Nothing downstream is claimed until the step above it passes.

1. **Static sweep.** `git ls-files | xargs grep -n "machinery"` returns *only* domain-noun hits
   and the frozen files of §5. Every remaining hit is individually justified.
2. **Gates.**
   ```
   pnpm -C contract check          # spectral + regenerate + diff (title only)
   cd backend && ruff check . && pytest
   pnpm -C frontend lint
   pnpm -C frontend test
   pnpm -C frontend build
   cargo test --manifest-path frontend/src-tauri/Cargo.toml
   ```
3. **New unit tests**, written before the code that satisfies them:
   - keystore migrate-on-read: legacy hit is returned, rewritten under the new service, legacy
     entry deleted; new-service hit never consults legacy; `delete` clears both.
   - app-data migration: old-only → renamed; both present → untouched; neither → no-op;
     idempotent on a second run.
4. **Re-freeze and rebuild.** `backend\scripts\build.ps1`, then `backend\scripts\smoke_frozen.ps1`,
   then `pnpm -C frontend tauri build`, then `pnpm -C frontend build:installer`. Expect
   `Kestrel AI_0.1.0_x64-setup.exe`.
5. **Sidecar spawn check** (guards §4.2): launch the built app and confirm `GET /api/v1/health`
   returns 200 with the GPU visible. A capability-allow-list mismatch fails exactly here.
6. **Migration check on real state.** Before installing, snapshot
   `%APPDATA%\ai.synapse-solutions.machinery-app`. After first launch of the renamed app, confirm
   `%APPDATA%\ai.synapse-solutions.kestrel-ai` holds the recent-projects list and that a stored
   provider key is still readable in Settings.
7. **Acceptance re-run.** `scripts/acceptance.md` against the renamed installed build. The
   existing 8/8 was measured on the old build and is stale until this passes. Evidence to
   `docs/evidence/acceptance/` under a new dated folder; the old one stays.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Blind find-and-replace corrupts domain copy and the API contract | §2 forbids it; §4 enumerates every edit; §6.1 sweeps |
| Capability allow-list missed → app launches with no backend | Called out in §4.2; §6.5 tests it explicitly |
| Operator loses recent projects / API keys | §3.1 and §3.2 migrations, tested in §6.3, verified on real state in §6.6 |
| Re-freeze (3.4 GB, ~127 s) and full Rust rebuild cost | Accepted; unavoidable once the sidecar and crate are renamed |
| Stale acceptance evidence presented as current | §6.7 re-runs it; old evidence retained, not overwritten |

## 8. Out of scope

A new app icon or visual identity for Kestrel AI (the hard-hat mark is kept), any behaviour
change, and the repo/vault work — that is
[[2026-09-20-repo-and-dev-memory-design]], which runs after this.
