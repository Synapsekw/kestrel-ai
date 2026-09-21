---
type: adr
date: 2026-09-21
status: proposed
tags: [decision, gotcha]
related: ["[[2026-09-21-gotcha-rebase-base-must-be-the-most-advanced-main]]", "[[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]]"]
---

# Concurrent gate runs may starve the backend job runner

**Status is `proposed`, not `accepted`, on purpose: the cause is unconfirmed.** What follows
separates what was measured from what is inferred. Do not cite this as established.

## Context

On 2026-09-21 a `finish-task.ps1` gate run took **16 hours 57 minutes** and ended
`619 passed, 9 deselected, 1 error in 61025.16s`, erroring on
`tests/test_dataset_delete.py::test_a_commit_that_fails_after_the_move_puts_the_folder_back`.

Measured facts:

- The same test passes **alone in 4.67s**.
- The full backend suite passes **standalone in 170.04s** (620 passed) and **inside a successful
  gate run in 152.46s** (620 passed). Three clean runs.
- Ordering is **deterministic**: `pytest-randomly` is not installed, and
  `backend/pyproject.toml`'s `[tool.pytest.ini_options]` configures no random ordering. Test order
  cannot explain the difference.
- `wait_job` (`backend/tests/conftest.py:141`) has a **180s deadline**, so 61,025s is **not one
  infinite loop**. It is consistent with roughly 340 job-dependent tests each burning their full
  timeout — the signature of a **starved job runner**, not a hung assertion.
- The log tail is thousands of identical `GET /api/v1/projects/<p>/jobs/<id> → 200` lines: polling
  a job that never reaches a terminal state.
- The only run that wedged **overlapped with a second Claude session running its own test suite in
  a sibling worktree**. Every clean run had the machine to itself.

Inferred, and unproven: two gate runs executing concurrently from two worktrees collide over shared
resources — fixed ports, shared `%TEMP%` project directories, and the background job runner — so
jobs never complete and every `wait_job` burns its deadline.

There is a second, independent suspect that was not investigated: that test monkeypatches
`Session.commit` **globally**, and background job threads call it. A worker thread that catches the
patched version could wedge the runner for the remainder of the session, with no concurrency
involved at all.

This matters because the workflow introduced by
`docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md` — `main` plus task worktrees — actively
encourages two sessions to run gates at once.

## Decision

Until the cause is confirmed: **do not run two gates concurrently on this machine.** If a gate run
exceeds a few minutes on the pytest step, suspect this rather than waiting it out — three healthy
runs completed in 152–170s, so anything past that is already anomalous.

Do not "fix" this by raising `wait_job`'s timeout. The timeout is not the bug; it is what converted
a wedge into a bounded 17-hour failure rather than an unbounded one.

## Rationale

The evidence rules out the cheap explanations — a broken test, a flaky assertion, random ordering —
and the remaining candidates both point at shared mutable state outside any single test. Recording
the measurements now is worth more than a confident story, because the next person to hit this will
otherwise start from the same standing start.

## Consequences

**Positive**

- A 17-hour run is recognisable in seconds instead of being waited out.
- The healthy baseline (152–170s, 620 passed) is written down, so "slow" is a measurable claim.

**Negative**

- Serialising gate runs costs wall-clock time when two tasks are genuinely in flight.
- The status stays `proposed`, so this note asserts less than a reader might want.

**Open follow-ups**

- Reproduce deliberately: run two gates simultaneously from two worktrees and see whether it wedges.
- Audit the job runner and test fixtures for fixed ports and shared `%TEMP%` paths that two suites
  would contend over.
- Audit `test_a_commit_that_fails_after_the_move_puts_the_folder_back`'s global `Session.commit`
  monkeypatch against background job threads.
- Consider bounding the pytest step in `scripts/finish-task.ps1` so a wedge fails fast.

## Related

- [[2026-09-21-gotcha-rebase-base-must-be-the-most-advanced-main]]
- [[2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar]]
- [[2026-09-21-1216-round-trip-proven]]
