---
type: adr
date: 2026-10-03
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-03-1803-sidebar-project-tree]]"]
---

# start-task.ps1 cuts the worktree from origin/main, not local main

## Context

`scripts\start-task.ps1 <name>` fetches `origin/main` and, whenever that remote branch exists, runs `git worktree add … -b task/<name> origin/main`. Local `main` routinely runs ahead of `origin/main` here. Sessions commit specs, plans and wrapups to local `main` and often don't push (see "not pushed" all over the north star). A worktree cut by the script therefore lacks those commits. In the sidebar block, the spec and plan the task was about to execute existed only on local `main`.

## Decision

When local `main` is ahead of `origin/main` (`git rev-list --count origin/main..main` > 0), cut the worktree from local `main` by hand. Repeat the script's other steps: pin `user.name`/`user.email` in the worktree, then run `pnpm -C <wt>\frontend install` and `pnpm -C <wt>\contract install`.

## Rationale

The merge target is local `main`, so branching from it loses nothing. Branching from `origin/main` silently drops the very plan you are about to build, and adds a catch-up merge later.

## Consequences

- Positive: the worktree has the spec and plan; the final merge is a fast-forward or a small catch-up.
- Negative: the script's convenience is lost until it is fixed.
- Open follow-ups: change `start-task.ps1` to use local `main` when it is ahead of `origin/main` (or always, since merges land on local `main`).

## Related

- [[2026-10-03-1803-sidebar-project-tree]]
