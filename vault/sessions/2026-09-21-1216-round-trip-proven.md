---
type: session
date: 2026-09-21-1216
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-21-gotcha-rebase-base-must-be-the-most-advanced-main]]", "[[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]]", "[[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]]", "[[2026-09-20-1403-repo-and-dev-memory]]"]
---

# 2026-09-21-1216 round trip proven

## What changed

Three commits on `main` (`d1846d2..7288966`), 4 files, +112/−4:

- **`71ea2bc`** — `.gitignore` gains exact-path rules for `.obsidian/workspace.json`,
  `.obsidian/graph.json` and `.obsidian/workspace-mobile.json`. Obsidian wrote the first two the
  moment the operator opened the vault. Spec §4.2 says `workspace.json` must never be committed,
  but nothing enforced it, because `.obsidian/` is deliberately *not* ignored (tracking the config
  and vendored plugins is what makes a fresh clone render live Dataview). Urgent because
  `finish-task.ps1` now asserts the main checkout is clean before merging, so these two untracked
  files would have blocked every future task merge. Verified the rules do not catch `app.json`,
  `appearance.json`, `core-plugins.json`, `community-plugins.json`, `templates.json` or
  `plugins/dataview/main.js`; tracked `.obsidian/` count unchanged at 17.
- **`ed25123`** — `scripts/finish-task.ps1` rebase-base selection fixed, plus
  `vault/decisions/2026-09-21-gotcha-rebase-base-must-be-the-most-advanced-main.md`.
- **`7288966`** — the throwaway smoke-check commit, merged through the real script.

**Task 12 Step 4 completed. Spec §7.5 is met.** The fourth attempt ran the whole thing
end to end: contract check, ruff, **620 pytest in 152.46s**, frontend lint, **497 vitest across 119
files**, frontend build, `cargo test` **skipped with its reason printed**; then `merge --ff-only`,
then `push 0ce41f5..7288966 main -> main`, then the junction-safe teardown, then
`Deleted branch task/smoke-check`. `origin/main..main` is now 0.

**The junction-safe removal was proven against the real failure mode.** `git worktree remove`
printed `error: failed to delete ...: Directory not empty` — precisely the refusal the script is
written around — and the cleanup then unlinked junctions as links rather than following them.
Checked afterwards: worktree gone from disk, deregistered, branch deleted, and
**`backend/.venv` intact — 3.8 GB, torch 2.14.0+cu130, cuda True, ultralytics 8.4.154.** This is
the 2026-09-18 incident replayed and survived. See
[[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]].

Two defects were found by running the script, after static review had passed both:

1. **Attempt 3 — the rebase base was wrong.** `finish-task.ps1` rebased onto `origin/main` whenever
   it existed. With `origin/main` 26 commits *behind* local `main`, that rewound the task branch
   onto a stale base and `merge --ff-only` then failed with
   `Not possible to fast-forward, aborting` — **after the entire gate had already run.** The earlier
   review did trace this logic and judged it sound, but its reasoning assumed the remote was ahead.
   Fixed in `ed25123`: reconcile local `main` with the remote first (fast-forward where possible,
   `throw` on genuine divergence, detected with `merge-base --is-ancestor` and explicit exit-code
   checks), then rebase onto local `main`. Divergence now fails *before* the gate runs.
2. **Attempt 2 — a 16 h 57 m pytest run.** `619 passed, 1 error in 61025.16s`, erroring on
   `tests/test_dataset_delete.py::test_a_commit_that_fails_after_the_move_puts_the_folder_back`.
   Not a broken test: it passes alone in 4.67s, and the full suite passes standalone (620 in
   170.04s) and inside the successful gate (620 in 152.46s). See **Open threads**.

## Why

The `main` + task-worktrees workflow was written, reviewed four times and documented, but never
actually executed — and the one session that did merge task work (`249262b`, rotated boxes wave 1)
merged by hand with `git merge`, producing a two-parent commit that `--ff-only` cannot create. So
the script's merge, push and teardown paths had never run at all. Both defects fixed today sat
through static review untouched; one live run surfaced each of them immediately.

## Open threads

- **A full-suite run wedged for 16 h 57 m and the cause is unconfirmed.** Recorded as
  [[2026-09-21-gotcha-concurrent-gate-runs-may-starve-the-job-runner]] with `status: proposed`,
  because the evidence is circumstantial. What is established: the suite is deterministic
  (`pytest-randomly` is not installed, no random ordering is configured); it passes clean in 152–170s
  in three separate runs; `wait_job` (`backend/tests/conftest.py:141`) has a 180s deadline, so 61,025s
  is not one hung test but roughly 340 job-dependent tests each burning their full timeout — the
  signature of a starved job runner. The only run that wedged overlapped with a second session
  running its own gate in a sibling worktree. Unproven, and worth confirming before trusting two
  concurrent gates.
- **Secondary suspect for the same wedge, for whoever owns `backend/`:**
  `test_a_commit_that_fails_after_the_move_puts_the_folder_back` monkeypatches `Session.commit`
  **globally**, and background job threads call it. A worker thread that catches the patched
  version could wedge the runner for the rest of the session. Not investigated — `backend/` was out
  of scope for the plan this block closes.
- **The gate has no per-step timeout.** That is why an unconfirmed flake cost 17 hours of wall clock
  instead of failing fast. Worth considering a bound on the pytest step.
- **Obsidian GUI verification (spec §7.3) is still owed.** The operator opened the vault and
  confirmed it appears as **app**; whether `vault/moc/memory.md` renders its Dataview query as a
  *table* rather than a code block has not been reported back.
- **The acceptance run is still stale** — unchanged by this block. See §5 of [[00-north-star]].
- The operator has a **pending, unstarted** decision to rename `E:\Dev\Yolo\app` to `kestrel-ai` so
  Obsidian stops naming the vault "app". Blocked on nothing now, but it breaks the venv, Tauri's
  `target/` and the Claude project directory, and cannot be done from inside a session living in
  that folder. No plan written.

## How to test

1. Confirm the remote has everything: `git fetch origin && git log --oneline origin/main..main`
   → prints nothing (0 unpushed).
2. Open https://github.com/Synapsekw/kestrel-ai — it should show PUBLIC, default branch `main`,
   MIT licence, and the smoke-check commit `7288966` at the tip.
3. Confirm the teardown was clean: `git worktree list` → only `E:/Dev/Yolo/app` and
   `.worktrees/wave1`; `git branch` → no `task/smoke-check`.
4. Confirm the venv survived the worktree removal:
   `backend\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"`
   → `2.14.0+cu130 True`.
5. Confirm Obsidian's per-machine state stays out of git: open the vault, move a pane, then
   `git status` → clean, with no `.obsidian/workspace.json`.
6. Exercise the fixed rebase logic yourself: `scripts\start-task.ps1 <name>`, make a trivial commit
   in the new worktree, then `scripts\finish-task.ps1`. Expect the gate to run, `cargo test` to be
   skipped with a printed reason, and the worktree and branch to be gone afterwards.

## Next session entry point

Everything in `docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md` is complete. The natural
next piece of work is **rotated boxes wave 2** (OBB training): spec §5 of
`docs/superpowers/specs/2026-09-20-rotated-boxes-design.md`, no plan written yet. Before starting,
decide whether to bound the pytest gate step, given the 17-hour run above.
