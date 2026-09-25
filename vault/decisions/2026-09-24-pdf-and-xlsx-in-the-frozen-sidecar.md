---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, packaging, volumes]
related: ["[[2026-09-22-rasterio-in-the-frozen-sidecar]]", "[[2026-09-23-volumes-design]]"]
---

# PDF, XLSX and Delaunay in the frozen sidecar

## Context

`volume_export` writes a reportlab PDF and an openpyxl workbook, and `volume_calc` triangulates
with scipy.spatial (qhull behind `Delaunay` and `LinearNDInterpolator`). All three are imported
lazily inside jobs, so a missing piece in the PyInstaller bundle would only show when an operator
exports or patches a machine, never at startup.

## Decision

`kestrel-backend.exe volumes-selftest` exercises the three (a platypus PDF with a table and an
image, a write-only workbook read back, a Delaunay interpolation) and `scripts/smoke_frozen.ps1`
runs it after `geo-selftest`. The bundle already collects reportlab's data files (detection
report); record here any hidden import the smoke run needed: not yet known - the task worktree
could not run the frozen build (no starter weights, no PyInstaller in its overlay venv), so
`kestrel_backend.spec` is unchanged. The first frozen build of the volumes branch runs
`smoke_frozen.ps1`; if it fails with a missing module, add exactly that module to `hiddenimports`
(`collect_submodules("openpyxl")` or `"scipy.spatial._qhull"`, whichever the traceback names) and
replace this sentence with the line added (or "none").

## Consequences

- A packaging regression in any of the three fails the smoke test by name.
- reportlab stays on the built-in Type 1 Helvetica: no font files to ship.
