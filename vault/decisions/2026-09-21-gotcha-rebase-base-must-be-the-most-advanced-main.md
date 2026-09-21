---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-20-gotcha-powershell-native-stderr-under-stop]]"]
---

# Gotcha: the rebase base must be the most advanced `main`, not just `origin/main`

## Context

`scripts/finish-task.ps1` picks a rebase base for the task branch before running the gate. The
original logic was: if `origin/main` exists as a remote-tracking branch, rebase onto `origin/main`;
otherwise rebase onto local `main`. That reasoning implicitly assumed `origin/main` is always ahead
of, or equal to, local `main`.

That assumption is wrong whenever local `main` holds commits that have not been pushed yet — for
example, after merging a previous task branch locally without pushing. In that case rebasing the new
task branch onto `origin/main` rewinds it onto a stale base: the resulting branch no longer contains
local `main`'s unpushed commits. The gate then runs (correctly, but against the wrong state), and
only afterwards does the script reach `git merge --ff-only $branch` into local `main` — which fails,
because the rebased branch is no longer a descendant of local `main`. The script aborts with "not
possible to fast-forward" after the entire gate has already run, which is the most expensive place to
discover a base-selection mistake.

This was found by the first end-to-end run of `finish-task.ps1`, on a repo where local `main` was 26
commits ahead of `origin/main`: the gate passed, then the merge failed.

## Decision

Before rebasing the task branch, reconcile local `main` with `origin/main` first, then always rebase
onto local `main`:

1. If `origin/main` doesn't exist, rebase directly onto local `main` (unchanged from before).
2. If `origin/main` exists, fetch it, then compare local `main` and `origin/main` with
   `git merge-base --is-ancestor`:
   - Local `main` behind `origin/main` (`origin/main` not an ancestor... local `main` is an ancestor
     of `origin/main`): fast-forward local `main` to `origin/main`.
   - Local `main` ahead of `origin/main` (`origin/main` is an ancestor of local `main`): local `main`
     is already the most advanced main; do nothing.
   - Neither is an ancestor of the other (genuine divergence): `throw` immediately, before the gate
     runs, telling the operator to reconcile `main` manually.
3. Rebase the task branch onto local `main`, which is now guaranteed to be the most advanced main
   available in either location.

Fast-forwarding local `main` touches the main checkout (`$repo`, not the task worktree), so the same
clean-and-on-`main` assertions the script already made right before the merge step (`checkout main`,
`status --porcelain`, `rev-parse --abbrev-ref HEAD`) are asserted again earlier, before the
fast-forward, rather than assumed.

## Rationale

"Latest main" means the most advanced main available in whichever place it lives, not "whatever
`origin/main` happens to point at." Guessing which side is ahead is unnecessary: `git merge-base
--is-ancestor` answers "behind / ahead / diverged" exactly, without heuristics, and its exit code must
be checked explicitly — `$ErrorActionPreference = 'Stop'` does not throw on a native command's
non-zero exit (the same rule recorded in
[[2026-09-20-gotcha-powershell-native-stderr-under-stop]]).

Failing loudly on genuine divergence, before the gate runs, is deliberate: a merge conflict in `main`
itself needs a human, and discovering that after a multi-minute gate run wastes the run for nothing.

## Consequences

- Positive: local `main` is always the most advanced main after the sync step, so the task branch
  rebase always contains it, and the later `git merge --ff-only` can always fast-forward. The
  previously-common case — commits merged locally but not yet pushed — no longer breaks the script.
- Positive: genuine divergence between local and remote `main` is caught before the gate runs, not
  after.
- Negative: none — this is strictly a correction of the base-selection logic; the guarded fetch,
  every existing `$LASTEXITCODE` check, and the junction-removal block are unchanged.
- Open follow-ups: none identified.

## Related

- [[2026-09-20-gotcha-powershell-native-stderr-under-stop]]
