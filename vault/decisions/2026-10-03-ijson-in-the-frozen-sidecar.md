---
type: adr
date: 2026-10-03
status: accepted
tags: [decision, frozen-sidecar, dependencies]
related: ["[[2026-09-24-worktree-overlay-venv-for-new-dependencies]]", "[[2026-09-24-pdf-and-xlsx-in-the-frozen-sidecar]]"]
---

# ijson in the frozen sidecar

## Context

The review kit import (asset findings J5) replays a kit's `surface.json`, 20 MB on DAMAC, with
715 base64 patches. Loading it whole would hold the whole file and its decoded strings in memory
at once, against the bounded-read rule.

## Decision

`ijson==3.5.1` (BSD-3) streams it one patch at a time. The cp311 Windows wheel carries a compiled
backend (`ijson.backends._yajl2`, chosen as `yajl2_c`). ijson picks its backend by name at import,
so `kestrel_backend.spec` collects `collect_submodules("ijson")`. `review-import-selftest`
prints the backend it chose, and `smoke_frozen.ps1` requires `yajl2_c`, so a bundle that silently
fell back to the pure Python parser fails the smoke.

## Consequences

- One new direct dependency, no transitive ones; pinned in both requirements files and in
  `tests/test_dependency_pins.py`.
- The coordinator installs `ijson==3.5.1` into the shared venv with `uv pip install --no-deps` at
  merge (overlay-venv rule); the frozen build was verified from the worktree overlay.
