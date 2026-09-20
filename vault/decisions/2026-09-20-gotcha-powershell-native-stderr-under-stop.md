---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: PowerShell native stderr under `$ErrorActionPreference = 'Stop'`

## Context

`scripts/start-task.ps1` and `scripts/finish-task.ps1` run under Windows PowerShell 5.1 with
`$ErrorActionPreference = 'Stop'`. On PowerShell 5.1, redirecting a native executable's stderr into
the pipeline with `2>&1` wraps each stderr line in a `NativeCommandError` record; under `Stop` that
record is promoted to a terminating error — even when the command's exit code is 0. `git fetch`
routinely writes ordinary progress text ("From ...", "* branch main -> FETCH_HEAD") to stderr on a
completely successful run, so a successful fetch piped through `2>&1` could abort the script at its
first git call.

It was worse than a theoretical trap: `finish-task.ps1` originally had this same `2>&1` pattern on
`git worktree remove`, sitting directly upstream of the junction-safe removal block (the code that
tells a hazardous directory junction apart from a harmless hardlink before deleting anything). `git
worktree remove` is *expected* to refuse with "Directory not empty" while `node_modules` is still
present — that refusal writes to stderr. Piped through `2>&1` under `Stop`, the script would
terminate right there, before ever reaching the code that prevents a naive recursive delete from
following a junction into the shared venv — the exact mechanism documented in
[[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]].

## Decision

Never pipe a native command's stderr with `2>&1` in these scripts. Native stderr already reaches the
console on its own without redirection — nothing is lost by leaving it alone, and nothing gets
wrapped into a terminating error.

Separately, because `$ErrorActionPreference = 'Stop'` does **not** catch a native command's non-zero
exit code (only PowerShell errors and terminating exceptions), `$LASTEXITCODE` must be checked
explicitly after every consequential native `git` call (rebase, checkout, merge, push) rather than
relying on `Stop` to do it.

## Rationale

The alternative — keeping `2>&1` and trying to filter `NativeCommandError` records after the fact —
is strictly more code for no benefit: PowerShell already surfaces native stderr on the console
without any redirection, so `2>&1` was buying nothing except a new failure mode. Explicit
`$LASTEXITCODE` checks are the only reliable signal for native-command failure under `Stop`; they
were already the pattern used elsewhere in these scripts (e.g. the gate loop in
`finish-task.ps1`) and this session extended that same pattern to the rebase, checkout, merge and
push calls that were previously unchecked.

## Consequences

- Positive: a successful `git fetch` or an expected-refusal `git worktree remove` can no longer
  abort either script; every consequential native git call now fails loudly and specifically instead
  of silently or with a misleading `NativeCommandError`.
- Negative: none — this is strictly a removal of a hazardous pattern plus explicit checks that were
  missing.
- Open follow-ups: this reasoning previously lived only in a scratch SDD ledger for this plan, which
  is deleted at the end of the run; this ADR is its durable home. Any future PowerShell script added
  to `scripts/` under `Stop` should follow the same two rules.

## Related

- [[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]]
