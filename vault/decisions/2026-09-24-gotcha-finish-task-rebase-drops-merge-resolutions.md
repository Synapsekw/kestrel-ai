---
type: adr
date: 2026-09-24
status: proposed
tags: [decision, gotcha]
related: ["[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]"]
---

# 2026-09-24-gotcha-finish-task-rebase-drops-merge-resolutions

## Context

Plans 1 and 2 of the train/detect split were built by parallel units in their own worktrees. Each unit was merged with `--no-ff` into an integration branch, and conflicts were resolved in those merge commits. The integration branch was then landed with `scripts/finish-task.ps1`, and that script always runs `git rebase main` first.

A plain rebase linearises the branch and drops merge commits, so the conflict resolutions they carried are lost. On Plan 1 the rebase had to redo conflicts between our own units (`api.py` three times). On Plan 2 the rebase stopped on `backend/app/api.py` at commit 27 of 53, even though `main` had not moved at all: the rebase served no purpose, and it failed only because of the flattening.

## Decision

When `main` is already an ancestor of the integration branch, land it with `git merge --ff-only` and **skip the rebase**. That keeps the merge history, and the gate still runs on exactly the tree that lands. When `main` has moved, merge `main` into the integration branch (not rebase), re-run the gate, then fast-forward.

Proposed change to `finish-task.ps1`: skip `git rebase main` when `git merge-base --is-ancestor main HEAD` succeeds, and otherwise rebase with `--rebase-merges`.

## Rationale

The rebase exists so the gate runs against the merged state. When `main` is an ancestor, the branch tip already *is* the merged state. Redoing resolutions by hand is slow and error-prone, and it can silently re-resolve a conflict differently from how the reviewed merge did.

## Consequences

- Positive: integration branches built from many `--no-ff` unit merges land without replaying conflicts.
- Negative: `main` keeps merge commits from integration work (it already had some, e.g. `759015a`).
- Open follow-ups: patch `finish-task.ps1` as proposed. Until then, a landing agent must do the script's steps by hand, as the Plan 2 landing did: check the main checkout is clean and on `main`, run the gate, `merge --ff-only`, push, and do the junction-safe cleanup.

## Related

- [[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]
- Session: [[2026-09-24-0622-train-detect-split-and-library]]
