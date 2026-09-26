---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, venv, worktrees]
related: ["[[2026-09-18-gotcha-shared-venv-deleted-with-a-worktree]]", "[[2026-09-23-gotcha-parallel-branches-collide-on-migration-ids]]"]
---

# A unit that adds Python packages builds an overlay venv in its worktree

## Context

Worktrees run backend commands on the main checkout's interpreter (`backend/.venv`). Foundation
F0 of the point-cloud, volumes and design specs adds five packages (laspy, lazrs, ezdxf, openpyxl,
et-xmlfile). Installing them into the shared venv while the unit is still being built (and may yet
change its pins) would change the interpreter every other live worktree tests with, in the middle
of their work, before the pins that ask for them are ready to land.

## Decision

The unit builds `<worktree>/backend/.venv` as an **overlay**: `uv venv` from the shared venv's base
Python, one `_kestrel_shared_venv.pth` file pointing at the shared `Lib/site-packages`, and
`uv pip install --no-deps` of only the new packages. The shared site-packages are read, never
written; the new packages resolve first. The overlay is a real folder with no links, so the
junction-safe worktree removal deletes it like any file.

At landing the new packages go into the shared venv **additively** (operator decision, F0 Task
10): `uv pip install --python E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe --no-deps` of
exactly the new pins, with a `uv pip list` diff before and after that shows only those lines
added. New packages move nothing another worktree depends on, so this is safe before the merge,
and `scripts/finish-task.ps1` then gates the unit normally, never with `-SkipGate`.

## Consequences

- After F0 lands, the shared venv has laspy, lazrs, ezdxf, openpyxl and et-xmlfile, so S1, S2
  and S3 land through `finish-task.ps1` with the normal gate. Their worktrees may still build the
  overlay for isolation; it is no longer needed to pass the gate.
- If a later gate on the shared interpreter fails only because a package is missing, the unit
  stops and reports it; it never lands with `-SkipGate` to get around it.
- `tests/test_dependency_pins.py` turns "a package is missing" into one readable failure instead
  of an ImportError deep inside a later unit's test.
