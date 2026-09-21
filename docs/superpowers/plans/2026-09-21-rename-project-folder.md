# Rename Project Folder Runbook

> **This is an operator runbook, not an agentic implementation plan.** It is a one-shot,
> high-consequence operation performed by hand, from outside the project folder, once every
> session working inside it is closed. Do not run `scripts/rename-project.ps1 -Execute`
> unattended and do not delegate this to a background agent.

**Why:** Obsidian names a vault after its folder — there is no display-name setting; the vault
registry at `%APPDATA%\obsidian\obsidian.json` stores only `path` and `ts`. The project currently
lives at `E:\Dev\Yolo\app`, so the vault shows up as **"app"**. `docs/superpowers/specs/2026-09-20-repo-and-dev-memory-design.md`
§2 originally declined this rename on cost grounds ("renaming the folder would break the venv,
Tauri's `target/` and the Claude project dir, for cosmetics"). The operator has since decided the
cosmetics are worth it. This runbook and `scripts/rename-project.ps1` are that decision, executed
carefully.

**Target:** `E:\Dev\Yolo\app` &rarr; `E:\Dev\Yolo\kestrel-ai`.

## What breaks, and why

| Thing | Why it breaks | Fix |
| --- | --- | --- |
| `backend/.venv` (~3.8 GB) | `Scripts\*.exe` shims embed the absolute project path | Delete and recreate: `uv venv .venv --python 3.11.15`, then `uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130` (the recipe in `vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md`). `pyvenv.cfg`'s `home` already points at uv's own Python outside the project, so only the project-relative parts break. |
| `frontend/node_modules`, `contract/node_modules` | pnpm `.bin` shims embed absolute paths | `pnpm install` in both, at the new path |
| `frontend/src-tauri/target/` | Rust build artifacts embed absolute paths | Delete it; cargo rebuilds clean |
| `%APPDATA%\obsidian\obsidian.json` | Holds `E:\Dev\Yolo\app` for this vault; 5 vaults total are registered here and all must survive | Back up first, then replace only this vault's `path`, BOM-less, re-parse to prove it's valid |
| `C:\Users\D\.claude\projects\E--Dev-Yolo-app\` | Claude Code derives this directory name from the project path; after the rename it becomes `...\E--Dev-Yolo-kestrel-ai\` | Move the `memory\` subdirectory across so it isn't orphaned; never overwrite an existing one |
| git worktrees | Store **absolute paths** in `.git/worktrees/<name>/gitdir` and in each worktree's own `.git` file | The script refuses outright if any worktree other than the main checkout is registered — there is no safe automatic fix, only "finish or remove it first" |

**Not affected, no action needed:** the installed app under `%LOCALAPPDATA%\Programs\`, and the
GitHub remote (`origin` is a URL, not a path).

## Before you start

1. Every session working in this checkout must be closed — including any Claude Code session,
   this one included. A directory cannot be renamed while a process holds it open.
2. If a parallel session left a task worktree behind (e.g. `.claude/worktrees/<name>`), finish it
   normally (`scripts\finish-task.ps1`) or remove it via the junction-safe procedure in
   `vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md`. The rename script
   will refuse while any worktree besides the main checkout is registered — there is no override
   flag for this, on purpose.
3. Push `main`. The script also refuses if anything is unpushed, because GitHub is the recovery
   path if the rename goes wrong (see **Recovery** below).
4. Copy the script out of the project first, so it isn't trying to rename the directory it's
   currently running from:
   ```powershell
   Copy-Item E:\Dev\Yolo\app\scripts\rename-project.ps1 E:\Dev\Yolo\rename-project.ps1
   cd E:\Dev\Yolo
   ```

## Order of operations

**Always run the dry run first.** Omitting `-Execute` is the default and performs every
precondition check, printing what it would do, without changing anything:

```powershell
.\rename-project.ps1
```

Read the output top to bottom. Every precondition is printed as `[PASS]` or `[FAIL]`. If anything
fails, the script tells you exactly what to close or fix, and exits without touching disk. Fix
the item and run the dry run again — it's cheap and safe to run as many times as you like.

Once every precondition shows `[PASS]`, run it for real:

```powershell
.\rename-project.ps1 -Execute
```

In order, `-Execute` performs:

1. **Backs up** `%APPDATA%\obsidian\obsidian.json` to a dated `.bak` next to it.
2. **Deletes** `frontend/src-tauri/target/`, `backend/build/`, `backend/dist/` (git-ignored build
   trees with baked-in absolute paths), reporting reclaimed space. Uses the junction-safe delete
   routine — never a blind recursive delete.
3. **Renames** the directory. If this step fails, the script stops immediately and prints exactly
   what to close. Nothing after this step runs on failure.
4. **Recreates** `backend/.venv` at the new path per the ADR recipe.
5. **Reinstalls** pnpm workspaces (`frontend/`, `contract/`).
6. **Repoints** the Obsidian registry: replaces only this vault's `path`, preserves the other four
   vaults and every other key untouched, writes UTF-8 **without a BOM**, then re-parses the file
   to prove it's valid and prints every registered vault path.
7. **Moves** `C:\Users\D\.claude\projects\E--Dev-Yolo-app\memory\` to the new project's Claude
   directory, creating the target directory if needed. Never overwrites an existing `memory\` —
   it warns and leaves both in place instead.
8. **Verifies**: new-path `git status` is clean and `HEAD` matches what it was before the rename;
   the recreated venv's python imports `torch` and reports CUDA; both `node_modules` exist; the
   Obsidian registry parses and lists the new path. All four are printed at the end regardless of
   pass/fail.

Steps 4–7 are independent of each other: a failure in one is reported and the script continues to
the rest rather than aborting, because none of the later steps make a failed earlier step worse.
The one step that halts everything is the directory rename itself (step 3) — everything before it
is reversible or hasn't happened yet, and everything after it depends on the rename having
succeeded.

## How to abort safely, stage by stage

- **During the dry run:** always safe. It performs one real (but self-reversing) filesystem
  operation — a "lock test" that renames `OldPath` to itself and immediately back, to prove
  nothing has it locked — and otherwise touches nothing. Ctrl+C at any point is safe.
- **Before `-Execute` is run:** nothing has changed. Just don't run it.
- **After the backup/delete steps, before the rename:** safe to stop. The deleted trees are
  git-ignored build output that rebuilds from source; nothing else has changed yet.
- **If the rename step itself fails:** the script stops immediately and tells you what to close.
  The project folder is still at `OldPath` (or, in the one-in-a-million case where the OS renamed
  it but the script's own error handling still caught something, follow the printed instructions
  literally — they name the exact path to check). Re-run the dry run to confirm the lock is gone,
  then retry `-Execute`.
- **After the rename succeeds, during venv/pnpm/Obsidian/memory steps:** these are independent and
  individually retryable. Re-running `-Execute` after a partial failure is safe — `NewPath` now
  exists so precondition 1 will refuse ("NewPath already exists"); instead, fix the specific failed
  step by hand using the recipe named in this doc's table above, then run the Verification section
  manually (see below) to confirm.

## Recovery if it goes wrong

**Everything is on GitHub.** That's the entire point of precondition 5 (nothing unpushed). Worst
case:

1. Confirm `main` on GitHub has the commit you expect: `git log --oneline -1` should match what
   the script printed as `preRenameHead` before it started.
2. Delete whatever is left of the local checkout (by hand, junction-safely — see
   `vault/decisions/2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md` if `.venv` or a
   worktree is involved).
3. Re-clone: `git clone <origin-url> E:\Dev\Yolo\kestrel-ai`.
4. Rebuild the toolchain from scratch:
   ```powershell
   cd E:\Dev\Yolo\kestrel-ai\backend
   uv venv .venv --python 3.11.15
   uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130
   cd ..\..
   pnpm -C frontend install
   pnpm -C contract install
   ```
5. If the Obsidian registry got corrupted, restore it from the dated `.bak` the script wrote
   before touching it: copy `obsidian.json.<stamp>.bak` back over `obsidian.json`.
6. If the Claude memory folder is stuck in the old `.claude\projects\E--Dev-Yolo-app\memory\`
   directory, just move it by hand — it's a plain folder move, nothing project-specific about it.

Nothing in this operation is destructive to tracked source: the rename script never force-pushes,
never rewrites git history, and the only things it deletes are git-ignored build trees and a
venv, both fully reproducible.

## Verifying by hand (if you skip straight to checking, or a step needs retrying)

```powershell
git -C E:\Dev\Yolo\kestrel-ai status --porcelain          # expect empty
git -C E:\Dev\Yolo\kestrel-ai log --oneline -1             # expect the same SHA as before
E:\Dev\Yolo\kestrel-ai\backend\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
Test-Path E:\Dev\Yolo\kestrel-ai\frontend\node_modules
Test-Path E:\Dev\Yolo\kestrel-ai\contract\node_modules
Get-Content "$env:APPDATA\obsidian\obsidian.json" -Raw | ConvertFrom-Json | Select-Object -ExpandProperty vaults
```

## After a successful run

1. Reopen the vault in Obsidian — it now shows as **kestrel-ai**.
2. Start a new Claude Code session rooted at `E:\Dev\Yolo\kestrel-ai`.
3. Run the gate to confirm the toolchain works:
   ```powershell
   cd E:\Dev\Yolo\kestrel-ai\backend; uv run ruff check .; uv run pytest
   pnpm -C E:\Dev\Yolo\kestrel-ai\contract check
   pnpm -C E:\Dev\Yolo\kestrel-ai\frontend lint; pnpm -C E:\Dev\Yolo\kestrel-ai\frontend test
   ```
4. Delete the copied-out `E:\Dev\Yolo\rename-project.ps1` once you're done with it — the real one
   lives at `E:\Dev\Yolo\kestrel-ai\scripts\rename-project.ps1`.
