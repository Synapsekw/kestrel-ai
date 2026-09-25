---
type: decision
date: 2026-09-23
status: accepted
tags: [adr, packaging, pointclouds, potreeconverter]
related: ["[[2026-09-23-point-clouds-design]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]"]
---

# PotreeConverter inside the frozen sidecar

**Context.** Point clouds need a display copy (a Potree 2.0 octree) that the 3D viewer streams.
PotreeConverter 2.1.5 builds it in seconds (21.7 M points in 9 s, 195 M in 52 s on the spike); a
Python octree builder would take weeks to write and run slower. It is a native Windows exe.

**Decision.** `backend/scripts/fetch_potreeconverter.ps1` downloads the pinned release zip
(SHA-256 `a05bc3a9…6248`), takes `PotreeConverter.exe`, `laszip.dll` and `licenses/`, adds the four
MSVC runtime DLLs from the newest installed redist, proves the import closure with `dumpbin
/dependents`, **runs `PotreeConverter.exe --help` from that folder**, and writes `MANIFEST.json`.
`kestrel_backend.spec` ships the folder as **datas** into `_internal/potreeconverter/`, so
PyInstaller keeps the layout and never moves the DLLs away from the exe. `build.ps1` refuses to
build (and refuses the result) when any manifest file is missing. `kestrel-backend.exe
pointcloud-selftest` re-checks every sha256 and runs the real import on a fixture;
`smoke_frozen.ps1` runs it and one API import with a Range read.

**Traps this records.**

- *The zip lacks the MSVC runtime.* `msvcp140.dll`, `msvcp140_atomic_wait.dll`, `vcruntime140.dll`
  and `vcruntime140_1.dll` are not in the release zip.
- *The build machine masks it.* It has the runtime installed system-wide, so the converter runs
  there without the DLLs and fails on a clean machine. The dumpbin closure check, the `--help` run
  from the payload folder (a DLL next to the exe loads before System32) and the selftest's sha256
  check each catch it at build time.
- *Pix4D's header bounding box is 0.3 mm too small*, and PotreeConverter aborts with "encountered
  point outside bounding box". The import scans the work copy and writes the true bounds, widened
  by one scale step, at header byte 179; the source is never modified.
- *PotreeConverter drops the CRS.* The import parses it with laspy and stores it on the cloud.
- *Narrow-string argv.* The converter runs in the work folder with relative ASCII arguments only
  (`input.las -o octree`), so project paths with spaces or non-ASCII characters are safe.
- *PotreeConverter writes `metadata.json` with a UTF-8 BOM* (`\xef\xbb\xbf` before the `{`), and so
  does `fetch_potreeconverter.ps1`'s own `MANIFEST.json` (PowerShell's default `Out-File`/
  `Set-Content` encoding is UTF-8 with a BOM). Plain `json.loads(path.read_text("utf-8"))` raises
  `JSONDecodeError: Unexpected UTF-8 BOM`; both `app/pointclouds/validate.py::validate_octree` and
  `app/pointclouds/selftest.py::verify_manifest`/`run` read these two files with `"utf-8-sig"`
  instead, which strips a BOM when present and is a no-op otherwise. This surfaced only once the
  selftest ran the real converter and read its real manifest for the first time; the offline test
  double never wrote a BOM.

**Consequences.** The bundle grows by the converter payload (about 4 MB) plus laspy and lazrs;
measured: `<pending Phase 2: this worktree's build.ps1 "bundle: … MB" line>` against
`<pending Phase 2: the same line from a build of main before Task 2, or docs/progress.md's last
packaging entry>`. This ADR is committed with the two spans still open per the controller's
phasing (Task 15 ships selftest.py, the smoke script and this ADR in Phase 1; `build.ps1` /
`smoke_frozen.ps1` run in Phase 2 once Task 14's `/projects/{id}/pointclouds` endpoint is on this
branch) — replace both spans with the two measured `bundle: … MB` lines before the branch merges.
A new MSVC toolset in a future PotreeConverter release shows up as a failed `--help` run in the
fetch script: pass `-CrtDir` with a newer redist.
