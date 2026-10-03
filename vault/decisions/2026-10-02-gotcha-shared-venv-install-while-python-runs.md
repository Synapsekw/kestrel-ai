---
type: adr
date: 2026-10-02
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-02-2300-asset-model-builder-m1]]"]
---

# Gotcha: installing into the shared venv while any python from it is running half-removes packages

## Context

Worktrees share `E:\Dev\Yolo\app\backend\.venv`. When a unit adds packages, the coordinator installs the pins into it at merge time.

U5's pins were not purely additive: google-genai needs `websockets<17` and `requests>=2.30`. The install ran while two pytest runs from the shared venv were live. The coordinator's "wait until idle" loop used a PowerShell process filter inside bash `$( )`; it never matched anything, so it exited at once.

uv deleted most of `websockets` 17.1, including its METADATA, then failed with "Access is denied" on `speedups.cp311-win_amd64.pyd`. Windows locks a loaded `.pyd` against deletion. This left the venv broken for any new process importing websockets.

## Decision

- Never install into the shared venv while any python from it runs. Check with `Get-CimInstance Win32_Process` for `backend\.venv\Scripts\python.exe`, printing the PIDs found. A wait loop must be shown to match a known process before it's trusted.
- Snapshot first: `uv pip freeze --python <venv> > <file>`.
- **Repair** if it happens anyway:
  1. Rename the locked `.pyd` into `backend\.venv\`. Windows allows renaming a loaded DLL; keep it on the same volume and inside a git-ignored folder.
  2. Re-run the install with `--no-deps` and the exact pins.
  3. Delete the stale `*.dist-info` left behind.
  4. Run `uv pip check`, then the affected tests (here, websocket and `/events`: 61 passed).

## Rationale

Running processes keep their loaded modules, so they don't notice. The damage hits the next process that imports the package, which could be another session's test run or the app itself. A loaded DLL can't be deleted, but it can be renamed, and that is what unblocks uv.

## Consequences

- Positive: the venv was repaired in minutes with no reinstall from scratch; U6's gate, live during the swap, passed.
- Negative: there was a window of a few seconds in which a new import of websockets would have failed for anyone on this machine.
- Open follow-ups: the merge scripts (`.superpowers/sdd/am-common/merge-*.sh`) don't install pins. Pin installs stay a manual coordinator step, guarded as above.

## Related

- [[2026-10-02-2300-asset-model-builder-m1]]
- CONTRIBUTING's overlay-venv rule (`vault/decisions/2026-09-24-worktree-overlay-venv-for-new-dependencies.md`)
