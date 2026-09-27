---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-27-1030-foundation-inspection-platform]]", "[[worktree-junction-venv-rule]]"]
---

# Gotcha: start-task.ps1 and finish-task.ps1 throw on git's stderr under Windows PowerShell 5.1

## Context

`scripts/start-task.ps1` and `scripts/finish-task.ps1` set `$ErrorActionPreference = 'Stop'` and pipe
native git commands, for example `& git fetch origin main | Out-Host`. Windows PowerShell 5.1, which
is the only PowerShell on this machine (there is no `pwsh`), wraps a native command's stderr lines
in an `ErrorRecord` when the host captures the output. That happens when the script runs from an
agent tool. Git writes ordinary progress such as `From https://github.com/...` to stderr, so the
script throws a `NativeCommandError` on the fetch, even though git exited 0.

## Decision

On this machine, agents do the scripts' steps by hand, in the same order.

**Start a task:**
1. `git worktree add .claude/worktrees/<n> -b task/<n> main`
2. Pin `user.name` and `user.email`.
3. Run `pnpm install` in `frontend/` and `contract/`.

**Finish a task:**
1. Confirm the main checkout is clean and on `main`, and `origin/main` equals `main`.
2. Confirm `git merge-base --is-ancestor main task/<n>`.
3. `git merge --ff-only task/<n>`, then `git push origin main`.
4. Remove the worktree with the link-safe procedure (see [[worktree-junction-venv-rule]]).
5. `git branch -d task/<n>`.

The gate itself runs inside the unit, before READY_TO_MERGE.

## Rationale

The scripts' logic is right. Only the PS 5.1 stderr handling breaks it, so hand steps keep the same
guarantees. Installing pwsh, or rewriting the scripts, is a separate change.

## Consequences

- Positive: every Foundation merge (11 units) went through without the script.
- Negative: the hand procedure is easy to get subtly wrong, for example forgetting the
  clean-checkout check.
- Open follow-ups:
  - make the scripts tolerate native stderr: wrap each git call in `$ErrorActionPreference =
    'Continue'` and check `$LASTEXITCODE`, or require pwsh 7;
  - then return to the scripts.

## Related

- [[worktree-junction-venv-rule]]
- [[2026-09-27-1030-foundation-inspection-platform]]
