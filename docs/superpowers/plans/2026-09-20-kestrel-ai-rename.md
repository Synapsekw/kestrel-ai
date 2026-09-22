# Kestrel AI Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from Machinery Detection / `machinery-app` / `machinery-backend` to Kestrel AI / `kestrel-ai` / `kestrel-backend`, migrating the three pieces of live state the rename moves, without touching the domain noun "machinery".

**Architecture:** Two new pieces of migration code (a Python keystore fallback and a Rust app-data folder move), then a curated rename across seven areas, then a full rebuild and re-verification. The migrations are written test-first because they are the only parts that can silently destroy operator state; the rename itself is mechanical but must be enumerated, never swept.

**Tech Stack:** Python 3.11 (FastAPI, pytest, ruff) in `backend/.venv` via uv · Rust stable MSVC (Tauri 2, `cargo test`) · TypeScript (Vite, Vitest, Playwright) via pnpm · PyInstaller 6 · Inno Setup 6

**Spec:** `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md`

## Global Constraints

- **Never run a repo-wide find-and-replace on "machinery".** The word has two roles (spec §2). Only the product-identifier role is renamed.
- **Domain-noun files are not to be edited at all:** `backend/app/datasets/empties.py`, `backend/app/exports/html_out.py`, `backend/app/inference/service.py`, `frontend/src/api/images.ts`, `frontend/src/app/nextStep.ts`, `frontend/src/data/AddToDatasetDialog.tsx`, `frontend/src/data/bulkActions.ts`, `frontend/src/editor/commands.ts`, `frontend/src/editor/EmptyToggle.tsx`, `frontend/src/editor/hotkeys.ts`, `frontend/src/editor/RegionList.tsx`, and their tests. The user-visible string `"No machinery (N)"` stays exactly as it is.
- **Frozen history — never edited:** `.superpowers/sdd/**` (including `review-*.diff`), `docs/evidence/**`, the dated checkpoint / acceptance / S6-packaging sections of `docs/progress.md`, `docs/superpowers/plans/*.md` except the one inbound spec-path reference in Task 8.
- **`.worktrees/wave1/` is not touched.** It is a git-ignored live worktree with its own venv. If it ever needs removing, delete junctions as links via .NET — never `rm -rf`.
- **Inno Setup `AppId` GUID stays `{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}`.** Changing it would orphan the existing install.
- **Exact new names** (spec §2.1): display `Kestrel AI` · slug `kestrel-ai` · Tauri identifier `ai.synapse-solutions.kestrel-ai` · sidecar `kestrel-backend` · Rust binary `kestrel-ai.exe` · Rust lib crate `kestrel_ai_lib` · npm scope `@kestrel-ai/contract` · keyring service `kestrel-ai`.
- **Commit identity** is `Danijel Jovanovic <info@synapse-solutions.ai>`. **Stage by path** — never `git add -A`.
- All backend commands run from `backend/` with its venv active (`uv run` or `backend\.venv\Scripts\activate`).

## Execution DAG

Dependency edges come from the `Interfaces` blocks below.

- Task 2 depends on Task 1 (both edit `keys.py`).
- Task 4 depends on Task 2 (consumes the sidecar filename `kestrel-backend` that `build.ps1` produces) and Task 3 (wires `appdata::migrate`).
- Task 6 depends on Task 4 (consumes `kestrel-ai.exe`) and Task 2 (consumes the staged sidecar filename).
- Task 9 depends on Tasks 1–8. Task 10 depends on Task 9. Task 11 depends on Task 10.

**Parallel batches:**

- **Batch A:** Task 1, Task 3, Task 5, Task 7, Task 8 — no shared files.
- **Batch B:** Task 2 (after 1), Task 4 (after 2 and 3).
- **Batch C:** Task 6 (after 4).
- **Batch D:** Task 9 → Task 10 → Task 11, strictly sequential.

**Critical path:** 1 → 2 → 4 → 6 → 9 → 10 → 11. Task 10 is the wall-clock floor (~10 min of freeze + Rust rebuild + ~6 min ISCC).

> **Note on parallelism:** batching helps only if each task commits separately and no two agents hold the same file. Tasks 1/2 and 3/4 are deliberately ordered pairs for that reason. If executing inline in one session, just go 1 → 11 in order.

---

### Task 1: Keystore migrate-on-read

The riskiest change in the plan: get this wrong and the operator's stored OpenAI/Anthropic keys become invisible with no error message. Test-first.

**Files:**
- Modify: `backend/app/providers/keys.py`
- Test: `backend/tests/test_keys_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.providers.keys.SERVICE = "kestrel-ai"`, `app.providers.keys.LEGACY_SERVICE = "machinery-app"`, and `KeyringKeyStore(service: str = SERVICE, legacy_service: str = LEGACY_SERVICE)` whose `get(provider) -> str | None` self-heals from the legacy service. `MemoryKeyStore` is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_keys_config.py`:

```python
class _FakeKeyringErrors:
    class PasswordDeleteError(Exception):
        pass


class FakeKeyring:
    """Stands in for the `keyring` module so no test touches the real Credential Manager."""

    def __init__(self):
        self.store: dict[tuple[str, str], str] = {}
        self.errors = _FakeKeyringErrors

    def get_password(self, service, user):
        return self.store.get((service, user))

    def set_password(self, service, user, password):
        self.store[(service, user)] = password

    def delete_password(self, service, user):
        if (service, user) not in self.store:
            raise self.errors.PasswordDeleteError(service)
        del self.store[(service, user)]


def _store_with(fake):
    from app.providers.keys import KeyringKeyStore

    store = KeyringKeyStore()
    store._keyring = lambda: fake
    return store


def test_a_key_stored_under_the_old_service_name_is_migrated_on_read():
    from app.providers.keys import LEGACY_SERVICE, SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "openai")] = SECRET
    store = _store_with(fake)

    assert store.get("openai") == SECRET
    assert fake.store[(SERVICE, "openai")] == SECRET
    assert (LEGACY_SERVICE, "openai") not in fake.store  # moved, not copied


def test_migration_is_idempotent_and_does_not_consult_the_legacy_service_again():
    from app.providers.keys import LEGACY_SERVICE, SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "anthropic")] = SECRET
    store = _store_with(fake)

    assert store.get("anthropic") == SECRET
    fake.store[(LEGACY_SERVICE, "anthropic")] = "stale-value-that-must-not-win"
    assert store.get("anthropic") == SECRET
    assert fake.store[(SERVICE, "anthropic")] == SECRET


def test_a_deleted_key_cannot_resurrect_from_the_legacy_service():
    from app.providers.keys import LEGACY_SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "openai")] = SECRET
    store = _store_with(fake)

    store.delete("openai")
    assert store.get("openai") is None
    assert fake.store == {}
    store.delete("openai")  # still idempotent


def test_no_key_anywhere_reads_as_none():
    fake = FakeKeyring()
    assert _store_with(fake).get("openai") is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_keys_config.py -k "legacy or migrat or resurrect or none" -v`
Expected: FAIL with `ImportError: cannot import name 'LEGACY_SERVICE'`.

- [ ] **Step 3: Implement the migration**

In `backend/app/providers/keys.py`, replace `SERVICE = "machinery-app"` with:

```python
SERVICE = "kestrel-ai"
# Pre-rename service name (Machinery Detection). Kept so keys stored by an older build are
# migrated on first read; safe to delete once no old install remains in the field.
LEGACY_SERVICE = "machinery-app"
```

Replace `KeyringKeyStore.__init__`, `get` and `delete` with:

```python
    def __init__(self, service: str = SERVICE, legacy_service: str = LEGACY_SERVICE):
        self.service = service
        self.legacy_service = legacy_service
        self._pinned = False
```

```python
    def get(self, provider: str) -> str | None:
        current = self._keyring().get_password(self.service, provider)
        if current:
            return current
        legacy = self._keyring().get_password(self.legacy_service, provider)
        if not legacy:
            return None
        # Move it across once, so the next read is a plain hit and the old entry stops existing.
        self._keyring().set_password(self.service, provider, legacy)
        self._forget(self.legacy_service, provider)
        return legacy

    def delete(self, provider: str) -> None:
        self._forget(self.service, provider)
        # Also clear any pre-rename entry, or `get` would resurrect what was just deleted.
        self._forget(self.legacy_service, provider)

    def _forget(self, service: str, provider: str) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(service, provider)
        except keyring.errors.PasswordDeleteError:  # already gone
            pass
```

Leave `set`, `_keyring` and `MemoryKeyStore` exactly as they are. Do not log the key value anywhere — the module docstring forbids it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_keys_config.py -v`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/providers/keys.py backend/tests/test_keys_config.py
git commit -m "feat(keys): migrate stored provider keys from the pre-rename service name"
```

---

### Task 2: Backend rename

**Files:**
- Modify: `backend/app/config.py:13`, `backend/app/appdata.py:1`, `backend/app/main.py:70`, `backend/pyproject.toml:2`, `backend/scripts/build.ps1`, `backend/scripts/smoke_frozen.ps1`
- Rename: `backend/machinery_backend.spec` → `backend/kestrel_backend.spec`

**Interfaces:**
- Consumes: Task 1's `keys.py` (already committed — do not re-edit it).
- Produces: the frozen bundle at `backend/dist/kestrel-backend/kestrel-backend.exe`, staged by `build.ps1` into `frontend/src-tauri/binaries/kestrel-backend-x86_64-pc-windows-msvc.exe` plus its `_internal/` folder. Tasks 4 and 6 depend on exactly these names.

- [ ] **Step 1: Rename the PyInstaller spec file**

```bash
git mv backend/machinery_backend.spec backend/kestrel_backend.spec
```

- [ ] **Step 2: Edit the spec file's two output names**

In `backend/kestrel_backend.spec`, lines 73–74:

```python
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="kestrel-backend", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="kestrel-backend")
```

Also update the header comment on line 3 so the worker invocation reads `kestrel-backend.exe worker train <params.json>`.

- [ ] **Step 3: Edit the four Python/TOML sites**

`backend/app/config.py` line 13:

```python
    data_dir: Path = Path.home() / "AppData" / "Roaming" / "kestrel-ai"
```

`backend/app/appdata.py` line 1:

```python
"""Per-user app data under %APPDATA%/kestrel-ai: recent projects and settings. Never keys."""
```

`backend/app/main.py` line 70:

```python
        title="kestrel-backend",
```

`backend/pyproject.toml` line 2:

```toml
name = "kestrel-backend"
```

- [ ] **Step 4: Edit the two build scripts**

In `backend/scripts/build.ps1`, replace every `machinery_backend.spec` → `kestrel_backend.spec`, `dist\machinery-backend` → `dist\kestrel-backend`, `dist/machinery-backend` → `dist/kestrel-backend`, `machinery-backend.exe` → `kestrel-backend.exe`, and the staged filename `machinery-backend-x86_64-pc-windows-msvc.exe` → `kestrel-backend-x86_64-pc-windows-msvc.exe` (lines 23, 29, 35, 38, 41, 43, 44).

In `backend/scripts/smoke_frozen.ps1`, the same for lines 6, 27, 37, 43.

- [ ] **Step 5: Verify nothing product-named is left in the backend**

Run: `git ls-files backend | xargs grep -n "machinery-app\|machinery-backend\|machinery_backend\|Machinery Detection"`

Expected: **exactly one hit** —

```
backend/app/providers/keys.py:<line>:LEGACY_SERVICE = "machinery-app"
```

That constant is migration code (spec §3.2) and **must stay**. Deleting it to make this grep
silent would strand the operator's stored API keys — the precise failure Task 1 exists to prevent.

Anything else is a miss: fix it and re-run. Separately, `empties.py`, `html_out.py` and
`service.py` use the bare word `machinery` as the domain noun and must still match a plain
`grep -n machinery` — that is correct and intended.

- [ ] **Step 6: Run the backend gate**

Run: `cd backend && uv run ruff check . && uv run pytest`
Expected: PASS.

- [ ] **Step 7: Delete the stale staged sidecar**

The old binary is git-ignored build output and would otherwise sit next to the new one.

```bash
rm -f frontend/src-tauri/binaries/machinery-backend-x86_64-pc-windows-msvc.exe
```

- [ ] **Step 8: Commit**

```bash
git add backend/kestrel_backend.spec backend/app/config.py backend/app/appdata.py backend/app/main.py backend/pyproject.toml backend/scripts/build.ps1 backend/scripts/smoke_frozen.ps1
git commit -m "refactor(backend): rename machinery-backend to kestrel-backend"
```

---

### Task 3: Rust app-data migration module

A pure function over two paths, so it is testable with `cargo test` and no Tauri runtime — the same shape `logfile.rs` already uses.

**Files:**
- Create: `frontend/src-tauri/src/appdata.rs`
- Modify: `frontend/src-tauri/src/lib.rs:1-2` (add `mod appdata;`)

**Interfaces:**
- Consumes: nothing.
- Produces: `crate::appdata::migrate(legacy: &Path, new: &Path) -> Migration` and `enum Migration { NothingToDo, Moved, BothPresent, Failed(String) }`. Task 4 calls this from `lib.rs`'s `setup`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src-tauri/src/appdata.rs` containing only the tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("kestrel-appdata-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed(dir: &PathBuf, marker: &str) {
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("recent_projects.json"), marker).unwrap();
    }

    #[test]
    fn moves_the_legacy_folder_when_only_it_exists() {
        let root = scratch("moves");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "mine");

        assert_eq!(migrate(&legacy, &new), Migration::Moved);
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "mine");
        assert!(new.join("logs").is_dir());
        assert!(!legacy.exists());
    }

    #[test]
    fn leaves_both_alone_when_both_exist() {
        let root = scratch("both");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "old");
        seed(&new, "new");

        assert_eq!(migrate(&legacy, &new), Migration::BothPresent);
        assert_eq!(fs::read_to_string(legacy.join("recent_projects.json")).unwrap(), "old");
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "new");
    }

    #[test]
    fn does_nothing_when_there_is_no_legacy_folder() {
        let root = scratch("none");
        assert_eq!(migrate(&root.join("old"), &root.join("new")), Migration::NothingToDo);
    }

    #[test]
    fn is_idempotent() {
        let root = scratch("idempotent");
        let (legacy, new) = (root.join("old"), root.join("new"));
        seed(&legacy, "mine");

        assert_eq!(migrate(&legacy, &new), Migration::Moved);
        assert_eq!(migrate(&legacy, &new), Migration::NothingToDo);
        assert_eq!(fs::read_to_string(new.join("recent_projects.json")).unwrap(), "mine");
    }
}
```

Add `mod appdata;` to the top of `frontend/src-tauri/src/lib.rs`, so the module compiles:

```rust
mod appdata;
mod logfile;
mod sidecar;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml appdata`
Expected: FAIL to compile — `cannot find function 'migrate' in this scope`.

- [ ] **Step 3: Implement the migration**

Prepend to `frontend/src-tauri/src/appdata.rs`:

```rust
//! One-time move of the pre-rename app-data folder.
//!
//! Tauri derives the app-data folder from the bundle identifier, so renaming the app from
//! `ai.synapse-solutions.machinery-app` to `ai.synapse-solutions.kestrel-ai` would otherwise
//! point a returning operator at an empty folder: no recent projects, no settings, and the
//! sidecar log starting over. This runs once at startup, before the sidecar is spawned, because
//! `logs/` belongs to the shell and has to move with the rest.

use std::fs;
use std::path::Path;

/// What [`migrate`] did, so the caller can say so in the log.
#[derive(Debug, PartialEq, Eq)]
pub enum Migration {
    /// No pre-rename folder: a clean install, or already migrated.
    NothingToDo,
    /// The pre-rename folder was moved onto the new path.
    Moved,
    /// Both exist. Left untouched: merging could lose data, so a human decides.
    BothPresent,
    /// The move failed (typically a locked file). The app still starts, with an empty folder.
    Failed(String),
}

/// Move `legacy` onto `new`, once. Safe to call on every launch.
pub fn migrate(legacy: &Path, new: &Path) -> Migration {
    if !legacy.exists() {
        return Migration::NothingToDo;
    }
    if new.exists() {
        return Migration::BothPresent;
    }
    if let Some(parent) = new.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return Migration::Failed(e.to_string());
        }
    }
    match fs::rename(legacy, new) {
        Ok(()) => Migration::Moved,
        Err(e) => Migration::Failed(e.to_string()),
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml appdata`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/src/appdata.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(shell): move the pre-rename app-data folder on first launch"
```

---

### Task 4: Tauri shell rename and migration wiring

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/capabilities/default.json`, `frontend/src-tauri/src/main.rs`, `frontend/src-tauri/src/sidecar.rs:56`, `frontend/src-tauri/src/logfile.rs:83`, `frontend/src-tauri/src/lib.rs` (setup block)

**Interfaces:**
- Consumes: `kestrel-backend` (Task 2's staged sidecar filename); `appdata::migrate` and `appdata::Migration` (Task 3).
- Produces: the Rust binary `kestrel-ai.exe` at `frontend/src-tauri/target/release/kestrel-ai.exe`, and the Tauri identifier `ai.synapse-solutions.kestrel-ai`. Task 6 depends on the binary name.

> **The single highest-risk line in this plan** is the sidecar name inside `capabilities/default.json`. It is a *runtime* allow-list: if it still says `machinery-backend` the app compiles, installs and launches, then silently fails to spawn its backend. Step 3 and the Task 10 smoke check both exist for this.

- [ ] **Step 1: Edit `tauri.conf.json`**

```json
  "productName": "Kestrel AI",
  "identifier": "ai.synapse-solutions.kestrel-ai",
```

the window title:

```json
        "title": "Kestrel AI",
```

and the external binary:

```json
    "externalBin": ["binaries/kestrel-backend"],
```

- [ ] **Step 2: Edit `Cargo.toml`**

```toml
[package]
name = "kestrel-ai"
version = "0.1.0"
description = "Kestrel AI desktop shell"

[lib]
name = "kestrel_ai_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

Leave `authors`, `edition`, `rust-version` and every dependency untouched.

- [ ] **Step 3: Edit `capabilities/default.json`**

```json
  "description": "shell access limited to the kestrel-backend sidecar, plus folder dialogs",
```

and **both** allow-lists:

```json
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/kestrel-backend", "sidecar": true, "args": false }]
```

```json
      "identifier": "shell:allow-spawn",
      "allow": [{ "name": "binaries/kestrel-backend", "sidecar": true, "args": false }]
```

- [ ] **Step 4: Edit the three Rust source sites**

`frontend/src-tauri/src/main.rs` line 5:

```rust
    kestrel_ai_lib::run()
```

`frontend/src-tauri/src/sidecar.rs` line 56:

```rust
        .sidecar("kestrel-backend")
```

`frontend/src-tauri/src/logfile.rs` line 83 (test helper):

```rust
            std::env::temp_dir().join(format!("kestrel-logfile-{name}-{}", std::process::id()));
```

- [ ] **Step 5: Wire the migration into startup**

In `frontend/src-tauri/src/lib.rs`, replace the body of `.setup(...)` with:

```rust
        .setup(|app| {
            // Before anything writes to the app-data folder, bring a pre-rename one across.
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            if let Some(legacy) = data_dir
                .parent()
                .map(|p| p.join("ai.synapse-solutions.machinery-app"))
            {
                match appdata::migrate(&legacy, &data_dir) {
                    appdata::Migration::Moved => {
                        eprintln!("[appdata] migrated {} -> {}", legacy.display(), data_dir.display())
                    }
                    appdata::Migration::BothPresent => {
                        eprintln!("[appdata] pre-rename folder left in place: {}", legacy.display())
                    }
                    appdata::Migration::Failed(e) => eprintln!("[appdata] migration failed: {e}"),
                    appdata::Migration::NothingToDo => {}
                }
            }
            let backend = sidecar::start(app.handle())?;
            *app.state::<sidecar::BackendState>().0.lock().unwrap() = Some(backend);
            Ok(())
        })
```

- [ ] **Step 6: Build and test the shell**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml`
Expected: PASS. A `cannot find crate machinery_app_lib` error here means Step 4's `main.rs` edit was missed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml frontend/src-tauri/capabilities/default.json frontend/src-tauri/src/main.rs frontend/src-tauri/src/sidecar.rs frontend/src-tauri/src/logfile.rs frontend/src-tauri/src/lib.rs
git commit -m "refactor(shell): rename the Tauri app to Kestrel AI and migrate app data"
```

---

### Task 5: Frontend TypeScript and driver scripts

**Files:**
- Modify: `frontend/src/app/Brand.tsx:17`, `frontend/src/api/client.test.tsx:38,44`, `frontend/scripts/checkpoint1.mjs`, `frontend/scripts/checkpoint4.mjs`, `frontend/scripts/build-installer.ps1`

**Interfaces:**
- Consumes: the names `kestrel-ai.exe`, `kestrel-backend-x86_64-pc-windows-msvc.exe` and `kestrel-ai.iss` (produced by Tasks 4, 2 and 6). This task only writes them into scripts; nothing reads back from it.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Rename the wordmark**

`frontend/src/app/Brand.tsx` line 17 — the hard-hat mark stays, only the text changes:

```tsx
      <span className={big ? "text-lg" : "text-sm"}>Kestrel AI</span>
```

- [ ] **Step 2: Update the two test fixture paths**

`frontend/src/api/client.test.tsx` lines 38 and 44 — replace `machinery-app` with `kestrel-ai` inside both `C:\\Users\\D\\AppData\\Roaming\\...\\logs\\sidecar.log` strings, leaving the escaping exactly as it is.

- [ ] **Step 3: Update the checkpoint drivers**

In `frontend/scripts/checkpoint1.mjs`, replace `machinery-backend` with `kestrel-backend` on lines 52, 53, 56, 57 and 68 (the `Get-Process` calls and the comment).

In `frontend/scripts/checkpoint4.mjs` line 22, the same in the `Get-Process` call.

- [ ] **Step 4: Update the installer build script**

In `frontend/scripts/build-installer.ps1`:

```powershell
$sidecar = Join-Path $binaries "kestrel-backend-x86_64-pc-windows-msvc.exe"    # line 33
$appExe = Join-Path $frontend "src-tauri\target\release\kestrel-ai.exe"        # line 62
```

line 90 — the Inno script filename:

```powershell
& $iscc "/DAppVersion=$version" (Join-Path $installerDir "kestrel-ai.iss") 2>&1 |
```

line 96 — the produced setup filename:

```powershell
$setup = Join-Path $output "Kestrel AI_${version}_x64-setup.exe"
```

- [ ] **Step 5: Run the frontend gate**

Run: `pnpm -C frontend lint && pnpm -C frontend test`
Expected: PASS. The `client.test.tsx` assertions now compare the new path against itself.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/Brand.tsx frontend/src/api/client.test.tsx frontend/scripts/checkpoint1.mjs frontend/scripts/checkpoint4.mjs frontend/scripts/build-installer.ps1
git commit -m "refactor(frontend): rename the wordmark and the driver script targets"
```

---

### Task 6: Installer script

**Files:**
- Rename: `frontend/installer/machinery-detection.iss` → `frontend/installer/kestrel-ai.iss`
- Modify: the renamed file

**Interfaces:**
- Consumes: `kestrel-ai.exe` (Task 4), `kestrel-backend-x86_64-pc-windows-msvc.exe` (Task 2), and the `kestrel-ai.iss` filename written into `build-installer.ps1` (Task 5).
- Produces: `Kestrel AI_<version>_x64-setup.exe` in `frontend/src-tauri/target/release/bundle/inno/`.

- [ ] **Step 1: Rename the file**

```bash
git mv frontend/installer/machinery-detection.iss frontend/installer/kestrel-ai.iss
```

- [ ] **Step 2: Edit the defines and `[Setup]` keys**

```pascal
#define AppName "Kestrel AI"
#define AppExe "..\src-tauri\target\release\kestrel-ai.exe"
#define SidecarExe "..\src-tauri\binaries\kestrel-backend-x86_64-pc-windows-msvc.exe"
```

```pascal
DefaultDirName={localappdata}\Programs\Kestrel AI
OutputBaseFilename=Kestrel AI_{#AppVersion}_x64-setup
UninstallDisplayIcon={app}\kestrel-ai.exe
```

Update the line-1 header comment to say "the Kestrel AI installer", and the `[Files]` comment so it reads "must land beside kestrel-ai.exe" and "stages `target\release\kestrel-backend.exe`".

**Do not touch `AppId`.** It must stay `{{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}` — that GUID is what makes the new installer upgrade the existing install instead of leaving an orphan in Add/Remove Programs.

- [ ] **Step 3: Verify the AppId survived**

Run: `grep -n "AppId" frontend/installer/kestrel-ai.iss`
Expected: `AppId={{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}`

- [ ] **Step 4: Commit**

```bash
git add frontend/installer/kestrel-ai.iss
git commit -m "refactor(installer): rename the Inno script to Kestrel AI, keeping the AppId"
```

---

### Task 7: Contract

**Files:**
- Modify: `contract/package.json:2`, `contract/openapi.yaml:3`
- Regenerate: `contract/client/schema.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Rename the package and the API title**

`contract/package.json` line 2:

```json
  "name": "@kestrel-ai/contract",
```

`contract/openapi.yaml` line 3:

```yaml
  title: Kestrel AI backend API
```

**Nothing else in `openapi.yaml` changes.** Lines 352, 382 and 1438 use "machinery" as the domain noun and are part of the API's meaning.

- [ ] **Step 2: Regenerate and check the client**

Run: `pnpm -C contract check`
Expected: PASS. If `git diff -- contract/client/schema.d.ts` shows anything beyond the title, an endpoint summary was edited by mistake — revert and redo Step 1.

- [ ] **Step 3: Commit**

```bash
git add contract/package.json contract/openapi.yaml contract/client/schema.d.ts
git commit -m "refactor(contract): rename the package and API title to Kestrel AI"
```

---

### Task 8: CI and documentation

**Files:**
- Modify: `.github/workflows/ci.yml:76`, `README.md`, `PRODUCT.md`, `KICKOFF_PROMPT.md`, `KICKOFF_PROMPT_2.md`, `scripts/acceptance.md`, `docs/progress.md` (Current state only), `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md:11,162`
- Rename: `docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md` → `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the spec path `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md`, referenced by the `related:` frontmatter of both 2026-09-20 specs.

- [ ] **Step 1: Fix the CI path**

`.github/workflows/ci.yml` line 76:

```yaml
          $p = Start-Process -PassThru -FilePath .\dist\kestrel-backend\kestrel-backend.exe
```

- [ ] **Step 2: Rename the design spec and fix inbound references**

```bash
git mv docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md
```

Update the path in `README.md:7`, `KICKOFF_PROMPT.md:10`, `KICKOFF_PROMPT_2.md:8`, and `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md:11` and `:162`. Those two plan lines are the **only** edits permitted in `docs/superpowers/plans/` — the rest of that file is frozen history.

Inside the renamed spec, update the title heading and any product-identifier mentions; leave its dated content and its domain-noun uses alone.

- [ ] **Step 3: Rewrite the product docs**

`README.md` line 1:

```markdown
# Kestrel AI (working name `kestrel-ai`)
```

Then update every product-identifier occurrence in `README.md` (lines 7, 116, 118, 138, 142, 162, 167, 169, 171, 174, 229, 244): install path `%LOCALAPPDATA%\Programs\Kestrel AI`, data path `%APPDATA%\ai.synapse-solutions.kestrel-ai`, binaries `kestrel-ai.exe` / `kestrel-backend.exe`, dist folder `dist/kestrel-backend`, installer `Kestrel AI_<version>_x64-setup.exe`, Inno script `frontend/installer/kestrel-ai.iss`.

`PRODUCT.md` line 1 → `# Kestrel AI`.

`KICKOFF_PROMPT_2.md`: line 1 heading, and line 52's paths. Leave line 15's "machinery-detection analyst" — that describes the operator's trade, not the product.

`scripts/acceptance.md`: product-identifier occurrences only.

- [ ] **Step 4: Update only the live section of the progress log**

In `docs/progress.md`, update the **"Current state"** section and line 92's identifier/product-name note to the new names. **Leave lines 35, 45, 112, 140, 238–258 and every other dated checkpoint, acceptance and S6-packaging row exactly as they are** — they record what was built and measured under the old name, and rewriting them would falsify the record.

Add one line at the top of "Current state":

```markdown
Renamed from "Machinery Detection" / `machinery-app` to **Kestrel AI** / `kestrel-ai` on 2026-09-20
(`docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1 has the full name map).
Evidence and checkpoints below predate the rename and keep the old names on purpose.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md PRODUCT.md KICKOFF_PROMPT.md KICKOFF_PROMPT_2.md scripts/acceptance.md docs/progress.md docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md
git commit -m "docs: rename Machinery Detection to Kestrel AI across the live docs"
```

---

### Task 9: Static sweep and full gate

The point where "we renamed everything" stops being a claim and becomes evidence.

**Files:** none modified unless the sweep finds something.

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: a clean gate, which Task 10 depends on.

- [ ] **Step 1: Sweep for leftover product identifiers**

Run:

```bash
git ls-files | xargs grep -n "machinery-app\|machinery-backend\|machinery_backend\|machinery_app\|Machinery Detection\|machinery-detection\|machinery-logfile"
```

Expected output: **only** these, all deliberate —
- `.superpowers/sdd/**` and `docs/evidence/**` (frozen history)
- the dated checkpoint / acceptance / S6 sections of `docs/progress.md`
- `docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md` (frozen history, apart from the two path lines fixed in Task 8)
- `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` (the name map itself)
- `docs/superpowers/plans/2026-09-20-kestrel-ai-rename.md` — **this plan**, whose Global Constraints and task steps quote every old name by design
- `docs/progress.md` **Current state** — the one-paragraph rename note added in Task 8 Step 4, which names the old product on purpose
- `backend/app/providers/keys.py` (`LEGACY_SERVICE`) and `frontend/src-tauri/src/lib.rs` (the legacy folder name) — both are migration code and must keep the old string
- `KICKOFF_PROMPT_2.md:15` ("machinery-detection analyst" — the operator's trade)

Anything else is a miss. Fix it, then re-run.

- [ ] **Step 2: Sweep for the bare domain noun, to confirm it survived**

Run: `git ls-files 'frontend/src/**' | xargs grep -ln "machinery"`
Expected: the domain-noun files listed in Global Constraints are all still present. If `EmptyToggle.tsx` or `hotkeys.ts` has stopped matching, a find-and-replace went through — revert it.

- [ ] **Step 3: Run the whole gate**

```bash
pnpm -C contract check
cd backend && uv run ruff check . && uv run pytest && cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

Expected: every command exits 0. Record the pytest and vitest counts — Task 11 quotes them.

- [ ] **Step 4: Commit any sweep fixes**

```bash
git add <only the files the sweep changed>
git commit -m "refactor: finish the Kestrel AI rename sweep"
```

---

### Task 10: Rebuild the frozen backend, the app and the installer

Long-running. ~127 s freeze, ~65 s cargo release, ~6 min ISCC.

**Files:** none tracked; produces build artefacts.

**Interfaces:**
- Consumes: Task 9's green gate.
- Produces: `frontend/src-tauri/target/release/bundle/inno/Kestrel AI_0.1.0_x64-setup.exe`, which Task 11 installs.

- [ ] **Step 1: Freeze the backend**

Run: `cd backend && .\scripts\build.ps1`
Expected: `dist/kestrel-backend` around 3.4 GB in ~14,100 files, and the sidecar staged as `frontend/src-tauri/binaries/kestrel-backend-x86_64-pc-windows-msvc.exe` with its `_internal/`.

- [ ] **Step 2: Smoke-test the frozen sidecar**

Run: `cd backend && .\scripts\smoke_frozen.ps1`
Expected: the frozen exe starts and answers `GET /api/v1/health` with 200.

- [ ] **Step 3: Build the app**

Run: `pnpm -C frontend tauri build`
Expected: `frontend/src-tauri/target/release/kestrel-ai.exe`. `%USERPROFILE%\.cargo\bin` must be on PATH.

- [ ] **Step 4: Verify the sidecar actually spawns — the capabilities check**

Launch the built `kestrel-ai.exe` from its release folder and confirm the app window reaches the Projects screen and `GET /api/v1/health` returns 200 with the GPU visible.

A window that opens but reports no backend means `capabilities/default.json` still allow-lists `binaries/machinery-backend` (Task 4 Step 3). This failure appears **only** here — not at compile time.

- [ ] **Step 5: Build the installer**

Run: `pnpm -C frontend build:installer`
Expected: `Kestrel AI_0.1.0_x64-setup.exe` in `frontend/src-tauri/target/release/bundle/inno/`, roughly 1.8 GB.

---

### Task 11: Verify the migrations on real state, then re-run acceptance

The operator's own machine is the only place the migrations can be proven.

**Files:**
- Create: `docs/evidence/acceptance/2026-09-20-kestrel-ai/` (run log, JSON, screenshots)
- Modify: `docs/progress.md` (a new dated acceptance row)

**Interfaces:**
- Consumes: Task 10's installer.
- Produces: the evidence that closes the spec.

- [ ] **Step 1: Snapshot the pre-rename state**

Record, before installing anything:

```powershell
Get-ChildItem "$env:APPDATA\ai.synapse-solutions.machinery-app" -Recurse | Select-Object FullName, Length
```

and note how many entries the installed app currently lists under Recent projects, plus which providers show a stored key in Settings.

- [ ] **Step 2: Uninstall the old app**

Uninstall "Machinery Detection" from Add/Remove Programs, so the new install lands in `%LOCALAPPDATA%\Programs\Kestrel AI` rather than inheriting the old folder via `UsePreviousAppDir`. This removes the program only — app data and projects are untouched.

- [ ] **Step 3: Install Kestrel AI**

Run the new installer (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CURRENTUSER` matches how checkpoint 4 installs). Confirm the install dir is `%LOCALAPPDATA%\Programs\Kestrel AI` and the Start Menu entry reads Kestrel AI.

- [ ] **Step 4: Verify both migrations on first launch**

Launch the app once, then check:

```powershell
Test-Path "$env:APPDATA\ai.synapse-solutions.kestrel-ai\recent_projects.json"
Test-Path "$env:APPDATA\ai.synapse-solutions.machinery-app"
```

Expected: the first is `True`, the second `False` (the folder was moved, not copied).

- In the app: Recent projects shows the same entries as Step 1.
- In Settings: the providers that had a key in Step 1 still show one stored. That proves Task 1's migrate-on-read against the real Credential Manager.

If Recent projects is empty but the legacy folder still exists, the migration returned `BothPresent` or `Failed` — read the reason from the console output and resolve before continuing.

- [x] **Step 5: Re-run acceptance** — done 2026-09-22 on main `8823d95`: 8/8, evidence in `docs/evidence/acceptance/2026-09-22-installed-8823d95/` (named by date and commit like the earlier runs, not `2026-09-20-kestrel-ai/`)

Follow `scripts/acceptance.md` against the installed Kestrel AI build. The previous 8/8 was measured on the old build and is stale until this passes.

Write evidence to `docs/evidence/acceptance/2026-09-20-kestrel-ai/`. **Do not overwrite** `docs/evidence/acceptance/` — the earlier run stays as the record of the pre-rename build.

- [x] **Step 6: Record the result and commit** — `docs/progress.md` log, 2026-09-22

Add a dated row to `docs/progress.md` under the acceptance section giving the commit, the installer size, and the pass/skip counts. State honestly which steps were skipped and why (the earlier run skipped step 7 for want of a provider key).

```bash
git add docs/evidence/acceptance/2026-09-20-kestrel-ai docs/progress.md
git commit -m "test: acceptance run on the renamed Kestrel AI installed build"
```

---

## Verification checklist

The spec's §6 in order — all must be true before the rename is called done:

- [ ] Static sweep returns only the deliberate hits (Task 9 Step 1)
- [ ] Domain-noun files still contain "machinery" (Task 9 Step 2)
- [ ] `pnpm -C contract check` passes, `schema.d.ts` diff is title-only (Task 7)
- [ ] `ruff check` + `pytest` pass, including the four new keystore tests (Tasks 1, 9)
- [ ] `pnpm -C frontend lint` + `test` + `build` pass (Tasks 5, 9)
- [ ] `cargo test` passes, including the four new `appdata` tests (Tasks 3, 9)
- [ ] The built app spawns its sidecar and reports the GPU (Task 10 Step 4)
- [ ] Recent projects and stored API keys survive the upgrade on the real machine (Task 11 Step 4)
- [ ] Acceptance re-run passes on the renamed installed build, evidence written to a new dated folder (Task 11 Step 5)
