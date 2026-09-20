---
type: adr
date: 2026-09-18
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: shared venv deleted with a worktree

## Context

`git worktree remove --force` refused to remove `.worktrees/s6-packaging-acceptance` with
"Directory not empty". Running `rm -rf .worktrees/s6-packaging-acceptance` to force it through
emptied `backend/.venv` at the same minute: the worktree held a junction to the shared venv, and
the recursive delete followed the junction into the shared target. This was the mechanism only
suspected in an earlier Wave 1 incident.

## Decision

Never `rm -rf` a worktree. Before removing one, list reparse points
(`Get-ChildItem -Recurse -Attributes ReparsePoint`) and check each one's `LinkType`, not where its
`Target` points — most "escaping" links are harmless hardlinks whose `Target` lists every name
sharing the inode. Only `LinkType = Junction` is the hazard. Delete junctions as links (not their
targets) with `[System.IO.Directory]::Delete(path, $false)`, deepest first; then remove the
remaining tree; then run `git worktree prune`. Note that `git worktree remove` may exit 0, print
"Directory not empty", and still deregister the worktree. Sub-agents must not create links into
the shared venv.

## Rationale

`rm -rf` (and naive recursive deletes generally) follow directory junctions into their targets,
so a junction inside a worktree can delete something the worktree doesn't own. Checking
`LinkType` distinguishes the one dangerous link type (Junction) from harmless hardlinks whose
`Target` field looks alarming but isn't.

## Consequences

- Positive: recovery procedure and the underlying mechanism are now documented, not just
  suspected.
- Negative: worktree removal requires an extra manual reparse-point check instead of a single
  command.
- Open follow-ups: none.

Recovery performed: `uv venv .venv --python 3.11.15`,
`uv pip install -r requirements-lock.txt -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cu130`
(wheels came from the uv cache); verified torch 2.14.0+cu130 with CUDA, ultralytics 8.4.154, and
the full backend suite.

## Related

-
