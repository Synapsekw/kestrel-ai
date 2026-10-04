---
type: adr
date: 2026-10-04
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-04-2110-asset-findings-p1]]"]
---

# Stopping a background merge leaves the merge script running

## Context

Wave merges run `bash merge-units.sh <units>` as a Claude Code background command. Two things stop such a command:
- the agent's TaskStop;
- the low-memory reaper ("stopped because the system is running low on memory").

Both kill the wrapper shell (`/usr/bin/bash -c ...`). Under Git Bash on Windows, the `merge-units.sh` child process survives with its own children (pytest, pnpm). During the artifact port P1 wave this caused three problems:
- **Waiters that should be gone, weren't.** "Stopped" waiters were still alive. One took the shared `imc-common/merge-queue.lock` and gated a single unit, which cost an extra hour-long gate.
- **Another session hit the same thing.** Its stopped waiter later took the lock, and a force-kill left the lock directory behind (stale).
- **The reaper is misleading.** Its "stopped" notice suggests the merge died, but the script finished and fast-forwarded `main` anyway.

## Decision

- **Kill the script itself.** To stop a queued or running merge, kill the `merge-units.sh` process and its children: `pkill -P <pid>; kill <pid>`. Find the pid with `ps -ef | grep merge-units`. Never rely on TaskStop.
- **Check what's alive.** After a reaper or TaskStop notice, `ps` shows whether the script is still alive. Read the merge log instead of assuming failure.
- **Before deleting the lock directory**, confirm no `merge-units.sh` process is alive on the machine. Then remove it with `rmdir`.

## Rationale

The script's `trap 'rmdir "$LOCK"' EXIT` only runs when the script itself exits, so killing the wrapper releases nothing. A waiter in its `until mkdir` loop has not set the trap yet, so killing it is safe and leaves no lock.

## Consequences

- Positive: queued waiters can be replaced (e.g. folding a newly ready unit into one run) without phantom merges.
- Negative: the reaper also kills log watchers, so completions go unnoticed until someone checks `merge.log` by hand.
- Open follow-ups: `merge-units.sh` could write its pid next to the lock, so a stale lock is provable at a glance.

## Related

- [[2026-10-04-2110-asset-findings-p1]]
