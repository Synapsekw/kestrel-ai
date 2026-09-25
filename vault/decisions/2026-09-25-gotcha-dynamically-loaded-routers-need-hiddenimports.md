---
type: adr
date: 2026-09-25
status: accepted
tags: [decision, gotcha, packaging, pointclouds]
related: ["[[2026-09-23-potreeconverter-in-the-frozen-sidecar]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]"]
---

# `collect_submodules("app")` silently returned nothing, so every dynamically-loaded router/startup module vanished from the frozen exe

## Context

Task 15's Phase 2 smoke run froze cleanly (`build.ps1` succeeded, `dist/kestrel-backend: 3,618.1 MB
in 14,508 files`) and `pointcloud-selftest` passed end to end (`pointcloud ok 50000 32639 BROTLI
laz 50000`) — but the very next smoke step, `POST /projects/{id}/pointclouds` (Task 14's new
endpoint), answered 404. The frozen exe's own stderr explained why:

```
ERROR app.api: app.pointclouds.router failed to load; its endpoints will be unavailable
ModuleNotFoundError: No module named 'app.pointclouds.router'
```

...and the same for `app.pointclouds.startup`, `app.surfaces.router`, `app.surfaces.startup`,
`app.surfaces.design.router`, `app.surfaces.design.startup`, `app.volumes.router`,
`app.volumes.startup` — every `router.py`/`startup.py` across all four F0-guarded packages, while
every *other* module in `app.pointclouds` (`selftest.py`, `importer.py`, `export.py`, `validate.py`
...) was present and working.

The pattern points straight at the mechanism: `app/api.py` loads each package's router with
`importlib.import_module(_module)` where `_module` is a plain string (`"app.pointclouds.router"`,
...), guarded by `try/except` so a broken native stack costs only its own endpoints (AGENTS.md: the
app must start even when startup work fails). `app/main.py`'s `project_opened` does the same for
the four startup sweeps. Neither is a static `from app.pointclouds import router` PyInstaller's
bytecode scanner can see — they rely entirely on `kestrel_backend.spec`'s
`hiddenimports = collect_submodules("app") + ...` to bundle them. Everything reachable from
`app/__main__.py`'s *actual* static import graph (via `pointcloud-selftest`'s own imports) got
bundled regardless of `collect_submodules`; everything reachable *only* dynamically did not.

Probing the real spec-execution context (`kestrel_backend.spec` run via `pyinstaller.exe
kestrel_backend.spec`, not `python spec.py`) found the root cause: `sys.path` there has no entry
for the backend directory or the current working directory at all —
`sys.path[0]` is `...\.venv\Scripts\pyinstaller.exe` (the entry-point script's own directory),
because the console-script wrapper resolves `sys.path[0]` from itself, not from
`Set-Location $backend` (`build.ps1`)'s process cwd, and this happens **before**
`Analysis(["app/__main__.py"], pathex=["."])` ever runs — `pathex` only helps modulegraph resolve
imports starting from the entry script, not the earlier `collect_submodules("app")` call at spec
module scope. `collect_submodules(package, on_error="warn once")` calls `is_package(package)` →
`can_import_module(package)`, and when `"app"` cannot be imported at all it just returns `[]` —
**no warning, no error**, because "app is not importable" isn't treated as an error case worth
warning about (only per-submodule import failures are). `build/kestrel_backend/warn-*.txt` had zero
mentions of pointclouds/surfaces/volumes; the omission was completely silent.

## Decision

Before computing `hiddenimports`, make `"app"` importable in the spec's own process regardless of
how `pyinstaller.exe` was invoked, using `SPECPATH` — the directory containing the spec file,
which PyInstaller always injects into the spec's exec namespace:

```python
if SPECPATH not in sys.path:
    sys.path.insert(0, SPECPATH)
```

This runs once, before `hiddenimports = (collect_submodules("app") + ...)`. Verified by probe: the
`app`-only submodule count for `collect_submodules("app")` went from **0** to **184**, and all
eight dynamically-loaded targets (four packages × {router, startup}) came back `True`.

Also added `backend/tests/test_packaging_spec.py`: it extracts the `app.*` module-name strings that
`app/api.py`'s router loader and `app/main.py`'s startup-sweep loader load dynamically, then
re-executes the spec's own hiddenimports-computing prelude in a subprocess whose `sys.path`
excludes the backend directory (reproducing the exact failure condition), and asserts every one of
those names still ends up in `hiddenimports`. It fails without the fix (confirmed: reverting the
`sys.path.insert` reproduces the same eight missing names the frozen build hit) and passes with it,
so the next package added under one of these four F0-guarded trees (S2's `app.surfaces.*`, S3's
`app.volumes.*`, or anything else routed through the same dynamic-import pattern) cannot regress
this silently again — it needs a real frozen build to notice otherwise.

## Rationale

The gap survived every gate up to this point because nothing in the ordinary test suite ever runs
`kestrel_backend.spec` — pytest imports `app.pointclouds.router` directly, which trivially works,
so 388+ tests stayed green while the frozen bundle silently shipped without four routers and four
startup sweeps. `smoke_frozen.ps1` is the only thing in the gate that would ever have caught it, and
only because Task 14/15 added an API call (`POST /projects/{id}/pointclouds`) that actually
exercises one of the dynamically-loaded routers — `geo-selftest` and `pointcloud-selftest` both
pass without touching `app.pointclouds.router` at all, since they reach their dependencies through
the static graph, not through `api.py`.

`sys.path.insert(0, SPECPATH)` was chosen over alternatives considered:
- Explicitly listing `"app.pointclouds.router"` etc. as `hiddenimports` literals would have fixed
  today's eight names but not the next one S2/S3 adds — the root cause (collect_submodules("app")
  returning `[]`) would still be silently broken for anything new.
- Setting `PYTHONPATH` before invoking `pyinstaller.exe` (in `build.ps1`) would only fix this on the
  machine/script that remembers to set it; the spec file is what every build path (CI, a future
  packaging script, a different operator's shell) actually goes through.

## Consequences

### Positive

- `collect_submodules("app")` now does what its name says regardless of how `pyinstaller.exe`'s own
  `sys.path[0]` resolves. Confirmed by the full smoke run: `pointcloud ok 50000 32639 BROTLI laz
  50000`, `cloud ok 50000 206`, `smoke ok`.
- The regression test generalizes to S2 (`app.surfaces`) and S3 (`app.volumes`) without any change
  on their part — it reads the dynamic-import call sites directly from `app/api.py`/`app/main.py`,
  so any new package wired the same way is covered automatically.

### Negative

- The regression test spawns a real subprocess that calls `collect_submodules("app")` (~10 s) —
  not free, but isolated to `test_packaging_spec.py`, not run on every file's tests.
- `collect_submodules("app")`'s silent-empty-list-on-unimportable-package behavior is a real
  PyInstaller design choice (`on_error="warn once"` only covers *per-submodule* import failures,
  not "the package itself never resolved"), not a bug filed upstream by this project; the fix works
  around it rather than reporting it.

### Open follow-ups

- No test currently asserts "no `ERROR ... failed to load` lines in the frozen exe's stderr" as a
  general property; `smoke_frozen.ps1` only catches the specific case where the missing router's
  endpoint got exercised. A future smoke step could `grep` the captured stderr for "failed to load"
  and fail loudly on any such line, closing the gap for a package whose endpoints happen not to be
  called by the smoke script.

## Related

- [[2026-09-23-potreeconverter-in-the-frozen-sidecar]] — the ADR this Phase 2 run was filling in
  measurements for when this gap surfaced.
- [[2026-09-22-rasterio-in-the-frozen-sidecar]] — the precedent for "a frozen build starts fine and
  fails only when the missing piece is actually exercised."
