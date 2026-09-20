---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: `cargo test` needs the frozen sidecar

## Context

`frontend/src-tauri/tauri.conf.json` declares the PyInstaller-frozen Python backend as an
`externalBin` resource: `binaries/kestrel-backend-x86_64-pc-windows-msvc.exe`. Tauri's build script
(`build.rs`) resolves that resource path at **compile time**, so any `cargo` command that touches the
`kestrel-ai` crate — not just `cargo build`, but `cargo test` too — fails outright when the binary is
absent, with `resource path ... doesn't exist`.

That binary is git-ignored by design: `.gitignore` has `frontend/src-tauri/binaries/*` (with
`!frontend/src-tauri/binaries/.gitkeep` to keep the directory tracked). It is about 69 MB and is
produced by `backend/scripts/build.ps1`, a PyInstaller CUDA build that is multi-gigabyte in its build
environment and far too slow to run on every task's gate. It exists in the main checkout (someone ran
`build.ps1` there at some point) but **no fresh `git worktree` and no fresh clone has it**, since a
worktree does not copy git-ignored files and neither does a clone.

`scripts/finish-task.ps1` gates every task worktree with seven steps, the last of which was an
unconditional `cargo test`. This was found the hard way: the first live `finish-task.ps1` round trip
(`task/smoke-check`) ran all seven gate steps for real, and the first six — contract check, ruff, 583
pytest, frontend lint, frontend test, frontend build — passed. The seventh, `cargo test`, failed with
exactly this error, because the worktree at `.claude/worktrees/smoke-check` had no
`frontend/src-tauri/binaries/` contents beyond `.gitkeep`.

The design spec (`docs/superpowers/specs/2026-09-20-repo-and-dev-memory-design.md` §5.4) defines the
gate as five lines and does not include `cargo test` at all; a later controller ruling had added it as
"stricter" without accounting for this. That made the gate unachievable in the one place it is
designed to run — a task worktree — since the sidecar can never exist there without an out-of-band
packaging build.

## Decision

Keep `cargo test` in the gate, but make it conditional on the sidecar's presence rather than deleting
it or leaving it unconditional. `scripts/finish-task.ps1` now globs
`frontend/src-tauri/binaries/kestrel-backend-*.exe` under the worktree being gated (`$wt`, not the
main checkout) before running it:

- if a match exists, `cargo test` runs as before, gated on its own `$LASTEXITCODE`;
- if not, the step is skipped with an explicit `Write-Host` message naming the missing binary, stating
  it is git-ignored so a fresh worktree never has it, and pointing at `backend\scripts\build.ps1` as
  the producer — and the gate does not fail on the skip.

`AGENTS.md` and `CONTRIBUTING.md`, which both quote the gate verbatim, now carry the same condition as
a comment on that line plus a following sentence, and stay identical to each other.

## Rationale

Deleting the line entirely (matching spec §5.4 literally) would throw away real coverage: the Rust
tests still have value on the main checkout or any machine that has run the packaging build, and
nothing about the sidecar problem makes the tests themselves wrong. Keeping it unconditional was the
actual defect — it made the gate fail 100% of the time in its only designed execution context. A glob
under `$wt` (not a fixed target-triple filename) was chosen so the check does not silently pass for
the wrong reason on a future architecture/target change, and specifically does not read the main
checkout's copy — that would defeat the fix by always finding a binary regardless of which worktree is
actually being gated.

A silent skip was rejected: an operator who never sees "cargo test did not run and here is exactly
why" has no way to tell a legitimately-skipped step from a step that quietly stopped working.

## Consequences

- Positive: `scripts/finish-task.ps1` can now pass end to end in a fresh task worktree, which is the
  only place it is designed to run. Rust test coverage is not lost — it activates automatically
  wherever the sidecar exists.
- Negative: most task worktrees will never run `cargo test` in practice, since running
  `backend/scripts/build.ps1` per task is not viable. Rust-side regressions are only caught where the
  packaging build has been done (the main checkout after a `build.ps1` run, or CI if one is later set
  up to do the same).
- Open follow-ups: if Rust test coverage on every task becomes a real requirement, the fix is a cached
  or CI-built sidecar artifact task worktrees can pull, not reverting this conditional.

## Related

- [[2026-09-20-gotcha-powershell-native-stderr-under-stop]]
