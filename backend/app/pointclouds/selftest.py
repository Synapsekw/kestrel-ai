"""`kestrel-backend.exe pointcloud-selftest` (spec §14): the frozen-bundle check for point clouds.

1. Verifies MANIFEST.json's sha256 for every bundled converter file (the build machine has the MSVC
   runtime installed system-wide, so a missing DLL would otherwise go unnoticed).
2. Writes the fixture LAZ through lazrs: 50 000 points, PF3 RGB, EPSG:32639, red west / green east,
   header max X shrunk 0.3 mm (the Pix4D trap).
3. Runs the real `import_cloud` - work copy, hash, scan, CRS, repair, admission, the bundled
   converter through laszip.dll, validation - and 4. asserts the facts; 5. runs the real LAZ writer.

Prints `pointcloud ok 50000 32639 BROTLI laz 50000` and exits 0; anything else exits 1.
`--write-fixture <path>` only writes the fixture (for the packaged-webview check).
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

NAME = "pointcloud-selftest"
FIXTURE_POINTS = 50_000
ORIGIN = (243_500.0, 3_178_000.0, 0.0)


class SelftestError(Exception):
    pass


def write_fixture(path: Path, n: int = FIXTURE_POINTS) -> Path:
    import laspy
    import numpy as np
    from pyproj import CRS

    from app.pointclouds.lasbounds import read_header_bounds, write_header_bounds

    rng = np.random.default_rng(0)
    xyz = np.asarray(ORIGIN) + rng.random((n, 3)) * np.array([100.0, 100.0, 10.0])
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.floor(xyz.min(axis=0))
    header.add_crs(CRS.from_epsg(32639))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    west = xyz[:, 0] < ORIGIN[0] + 50.0
    las.red = np.where(west, 65535, 0).astype(np.uint16)
    las.green = np.where(west, 0, 65535).astype(np.uint16)
    las.blue = np.zeros(n, dtype=np.uint16)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path, do_compress=True, laz_backend=laspy.LazBackend.Lazrs)
    bounds = read_header_bounds(path)
    bounds[3] -= 0.0003  # the header misses the true max X by 0.3 mm, like Pix4D's
    write_header_bounds(path, bounds)
    return path


def verify_manifest(folder: Path) -> int:
    manifest = folder / "MANIFEST.json"
    if not manifest.is_file():
        raise SelftestError(f"no MANIFEST.json in {folder}")
    # utf-8-sig: fetch_potreeconverter.ps1 (PowerShell) writes MANIFEST.json with a UTF-8 BOM.
    files = json.loads(manifest.read_text("utf-8-sig"))["files"]
    for entry in files:
        f = folder / entry["name"]
        if not f.is_file():
            raise SelftestError(f"{entry['name']} is missing from {folder}")
        digest = hashlib.sha256(f.read_bytes()).hexdigest()
        if digest != entry["sha256"].lower():
            raise SelftestError(f"{entry['name']} does not match MANIFEST.json")
    return len(files)


def run(tmp: Path) -> dict:
    import laspy

    from app.pointclouds.converter_path import converter_exe
    from app.pointclouds.export import verify_laz, write_laz
    from app.pointclouds.importer import import_cloud

    exe = converter_exe()
    if exe is None:
        raise SelftestError("PotreeConverter.exe is not in the bundle")
    verify_manifest(exe.parent)
    fixture = write_fixture(tmp / "fixture.laz")
    result = import_cloud(fixture, tmp / "cloud", progress=lambda *_: None, check_cancelled=lambda: None)
    # utf-8-sig: PotreeConverter 2.1.5 writes metadata.json with a UTF-8 BOM.
    meta = json.loads((tmp / "cloud" / "octree" / "metadata.json").read_text("utf-8-sig"))
    out = tmp / "export.laz"
    write_laz(
        fixture,
        out,
        bounds=result.bounds_native,
        scale=result.scale,
        assign_epsg=None,
        progress=lambda *_: None,
        check_cancelled=lambda: None,
    )
    verify_laz(out, point_count=result.point_count, epsg=result.crs.epsg)
    with laspy.open(out) as r:
        laz_points = int(r.header.point_count)
    return {
        "bounds_repaired": result.bounds_repaired,
        "epsg": result.crs.epsg,
        "points": meta["points"],
        "encoding": meta["encoding"],
        "laz_points": laz_points,
    }


def main(argv: list[str] | None = None) -> int:
    argv = list(argv or [])
    if argv[:1] == ["--write-fixture"] and len(argv) == 2:
        path = write_fixture(Path(argv[1]))
        print(f"fixture ok {path}", flush=True)
        return 0
    try:
        with tempfile.TemporaryDirectory(prefix="kestrel-pc-") as tmp:
            facts = run(Path(tmp))
        problems = []
        if not facts["bounds_repaired"]:
            problems.append("the header bounds were not repaired")
        if facts["epsg"] != 32639:
            problems.append(f"EPSG {facts['epsg']}")
        if facts["points"] != FIXTURE_POINTS or facts["laz_points"] != FIXTURE_POINTS:
            problems.append(f"{facts['points']} octree / {facts['laz_points']} LAZ points")
        if facts["encoding"] != "BROTLI":
            problems.append(f"encoding {facts['encoding']}")
        if problems:
            raise SelftestError("; ".join(problems))
    except Exception as e:
        print(f"pointcloud FAIL {type(e).__name__}: {e}", flush=True)
        return 1
    print(
        f"pointcloud ok {facts['points']} {facts['epsg']} {facts['encoding']} laz {facts['laz_points']}",
        flush=True,
    )
    return 0
