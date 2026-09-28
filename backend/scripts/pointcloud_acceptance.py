"""Point-cloud acceptance driver (spec §17.1-§17.4, §17.13) against a running backend.

  import  create a detection project in --project-folder, import --source, report wall time,
          the cloud's facts, the converter's peak RSS and the backend's RSS growth
  cancel  start an import, cancel it once the converter runs, report how long until no
          PotreeConverter.exe is left, and the cloud's final state
  export  export --cloud-id (in --project-id) as LAZ, report wall time and size ratio
  setup      create a project (excavator + Crack types), import --source, and --photos when given;
             print the ids the dev-mode launcher keeps (C-G)
  shapes     write the synthetic 60-degree patch and 1-degree leaning cylinder, import them, and
             post area / rings / two-point measurements (spec 2026-09-26 point-cloud workspace §16.3-4)
  profile    post a cross-section across the stack at --rim, time the job, and report
             profile_width_max_m and the top-band widths (§16.5)
  crosscheck the same top-band widths straight from the source LAS, streamed in chunks (§16.5)
  views      every stored report view: bytes, sha256 against listCloudViews, size, stale (§16.10)
  cameras    the cameras payload's counts (§16.7 context)

Each prints one JSON line. The backend's pid (--backend-pid) is needed for the RSS figures. The token is
--token, else KESTREL_TOKEN, else APP_TOKEN (the launcher keeps it off the command line).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import threading
import time
from pathlib import Path

import httpx
import psutil

CONVERTER = "potreeconverter.exe"


def tree_rss(pid: int) -> int:
    try:
        root = psutil.Process(pid)
        procs = [root, *root.children(recursive=True)]
    except psutil.Error:
        return 0
    total = 0
    for p in procs:
        try:
            total += p.memory_info().rss
        except psutil.Error:
            pass
    return total


def converter_rss(pid: int) -> int:
    try:
        kids = psutil.Process(pid).children(recursive=True)
    except psutil.Error:
        return 0
    total = 0
    for p in kids:
        try:
            if p.name().lower() == CONVERTER:
                total += p.memory_info().rss
        except psutil.Error:
            pass
    return total


def converters_alive() -> int:
    n = 0
    for p in psutil.process_iter(["name"]):
        if (p.info.get("name") or "").lower() == CONVERTER:
            n += 1
    return n


class PeakSampler:
    """Samples a pid's own RSS and its converter children's RSS until stopped."""

    def __init__(self, pid: int, interval: float = 0.05):
        self.pid, self.interval = pid, interval
        self.peak_tree = self.peak_converter = self.peak_backend = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.peak_tree = max(self.peak_tree, tree_rss(self.pid))
            self.peak_converter = max(self.peak_converter, converter_rss(self.pid))
            try:
                self.peak_backend = max(self.peak_backend, psutil.Process(self.pid).memory_info().rss)
            except psutil.Error:
                pass
            time.sleep(self.interval)

    def start(self) -> None:
        self._t.start()

    def stop(self) -> int:
        self._stop.set()
        self._t.join(5)
        return self.peak_tree


def resolve_token(cli: str | None, environ) -> str:
    """--token when given, else KESTREL_TOKEN, else APP_TOKEN: the dev-mode launcher passes the token
    through the environment so it never appears on a process command line (C-G)."""
    token = cli or environ.get("KESTREL_TOKEN") or environ.get("APP_TOKEN")
    if not token:
        raise SystemExit("no token: pass --token or set KESTREL_TOKEN / APP_TOKEN")
    return token


def client(base: str, token: str, transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base.rstrip('/')}/api/v1",
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
        transport=transport,
    )


def wait_job(c: httpx.Client, project_id: str, job_id: str, timeout: float = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = c.get(f"/projects/{project_id}/jobs/{job_id}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.25)
    raise TimeoutError(job_id)


def ensure_catalogue_type(
    c: httpx.Client, name: str, colour: str, hotkey: str | None = None, kind: str = "object"
) -> str:
    """POST /catalogue/types (spec 2026-09-26-foundation section 13b): a fresh type keeps its new
    id; a 409 `type_exists` reuses the existing live type of that name; a 409 `hotkey_conflict`
    retries once without the hotkey."""
    body: dict = {"name": name, "colour": colour, "kind": kind}
    if hotkey:
        body["hotkey"] = hotkey
    r = c.post("/catalogue/types", json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "hotkey_conflict":
        body.pop("hotkey", None)
        r = c.post("/catalogue/types", json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "type_exists":
        return r.json()["error"]["details"]["type_id"]
    r.raise_for_status()
    return r.json()["id"]


def new_project(c: httpx.Client, folder: Path) -> tuple[str, str]:
    """A project with the excavator object type and the Crack defect type (3D findings need a
    defect type). Returns (project id, Crack type id)."""
    Path(folder).mkdir(parents=True, exist_ok=True)
    excavator = ensure_catalogue_type(c, "excavator", "#f97316")
    crack = ensure_catalogue_type(c, "Crack", "#ef4444", kind="defect")
    body = {"name": "Point-cloud acceptance", "folder": str(folder), "type_ids": [excavator, crack]}
    r = c.post("/projects", json=body)
    r.raise_for_status()
    return r.json()["id"], crack


def run_import(a) -> dict:
    c = client(a.base, a.token)
    pid = a.project_id or new_project(c, Path(a.project_folder))[0]
    before = psutil.Process(a.backend_pid).memory_info().rss if a.backend_pid else 0
    sampler = PeakSampler(a.backend_pid) if a.backend_pid else None
    if sampler:
        sampler.start()
    t0 = time.perf_counter()
    r = c.post(f"/projects/{pid}/pointclouds", json={"path": a.source})
    r.raise_for_status()
    created = r.json()
    job = wait_job(c, pid, created["job"]["id"])
    wall = time.perf_counter() - t0
    if sampler:
        sampler.stop()
    cloud = c.get(f"/projects/{pid}/pointclouds/{created['cloud']['id']}").json()
    return {
        "scenario": "import",
        "project_id": pid,
        "cloud_id": cloud["id"],
        "state": job["state"],
        "error": job.get("error"),
        "wall_s": round(wall, 2),
        "point_count": cloud["point_count"],
        "epsg": cloud["epsg"],
        "bounds_repaired": cloud["bounds_repaired"],
        "bounds_native": cloud["bounds_native"],
        "octree_bytes": cloud["octree_bytes"],
        "source_size": cloud["source_size"],
        "octree_ratio": round(cloud["octree_bytes"] / cloud["source_size"], 4)
        if cloud["octree_bytes"]
        else None,
        "converter_peak_rss_gb": round(sampler.peak_converter / 1e9, 2) if sampler else None,
        "backend_rss_growth_gb": round((sampler.peak_backend - before) / 1e9, 3) if sampler else None,
    }


def run_cancel(a) -> dict:
    c = client(a.base, a.token)
    pid = a.project_id or new_project(c, Path(a.project_folder))[0]
    created = c.post(f"/projects/{pid}/pointclouds", json={"path": a.source}).json()
    job_id = created["job"]["id"]
    deadline = time.time() + 1800
    while time.time() < deadline:
        j = c.get(f"/projects/{pid}/jobs/{job_id}").json()
        if (
            "building the 3D view copy" in (j.get("message") or "")
            or j["state"] != "running"
            and j["state"] != "queued"
        ):
            break
        time.sleep(0.1)
    t0 = time.perf_counter()
    c.post(f"/projects/{pid}/jobs/{job_id}/cancel")
    while converters_alive() and time.perf_counter() - t0 < 30:
        time.sleep(0.05)
    gone_s = time.perf_counter() - t0
    job = wait_job(c, pid, job_id)
    cloud = c.get(f"/projects/{pid}/pointclouds/{created['cloud']['id']}").json()
    folder = Path(a.project_folder) / "pointclouds" / cloud["id"]
    return {
        "scenario": "cancel",
        "job_state": job["state"],
        "converter_gone_s": round(gone_s, 2),
        "cloud_status": cloud["status"],
        "cloud_error": cloud["error"],
        "cloud_folder_exists": folder.exists(),
    }


def run_export(a) -> dict:
    c = client(a.base, a.token)
    t0 = time.perf_counter()
    r = c.post(
        f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/exports",
        json={"format": "laz", "include_measurements": True},
    )
    r.raise_for_status()
    job = wait_job(c, a.project_id, r.json()["job"]["id"])
    wall = time.perf_counter() - t0
    result = job.get("result") or {}
    laz = Path(a.project_folder) / result.get("folder", "") / result.get("laz", "")
    source_size = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}").json()["source_size"]
    return {
        "scenario": "export",
        "state": job["state"],
        "error": job.get("error"),
        "wall_s": round(wall, 2),
        "laz": str(laz),
        "laz_ratio": round(laz.stat().st_size / source_size, 4) if laz.is_file() else None,
        "point_count": result.get("point_count"),
    }


# ---- C-G: the point-cloud workspace (spec 2026-09-26-point-cloud-workspace sections 13 and 16) ----

PATCH_ORIGIN = (500100.0, 3200100.0, 50.0)
CYL_BASE = (500120.0, 3200100.0, 50.0)
SHAPES_EPSG = 32639


def tilted_patch(origin=PATCH_ORIGIN, width=2.0, height=1.5, tilt_deg=60.0, step=0.02):
    """A width x height rectangle: `width` runs grid east, `height` rises `tilt_deg` from horizontal
    towards grid north. Surface area width*height, plan area width*height*cos(tilt).
    Returns (points (n, 3), corners (4, 3))."""
    import numpy as np

    o = np.asarray(origin, dtype=np.float64)
    t = math.radians(tilt_deg)
    u = np.array([1.0, 0.0, 0.0])
    v = np.array([0.0, math.cos(t), math.sin(t)])
    s = np.linspace(0.0, width, round(width / step) + 1)
    r = np.linspace(0.0, height, round(height / step) + 1)
    S, R = np.meshgrid(s, r)
    pts = o + S.reshape(-1, 1) * u + R.reshape(-1, 1) * v
    corners = np.array([o, o + width * u, o + width * u + height * v, o + height * v])
    return pts, corners


def _axis_centre(z_rel: float, lean_deg: float, azimuth_deg: float, base=CYL_BASE) -> tuple[float, float]:
    shift = z_rel * math.tan(math.radians(lean_deg))
    a = math.radians(azimuth_deg)
    return base[0] + shift * math.sin(a), base[1] + shift * math.cos(a)


def leaning_cylinder(
    base=CYL_BASE, radius=1.0, height=20.0, lean_deg=1.0, azimuth_deg=90.0, dtheta_deg=5.0, dz=0.1
):
    """Horizontal circles of `radius` whose centres follow an axis leaning `lean_deg` from vertical
    towards grid azimuth `azimuth_deg` (clockwise from north: 90 is east)."""
    import numpy as np

    zs = np.linspace(0.0, height, round(height / dz) + 1)
    th = np.radians(np.arange(0.0, 360.0, dtheta_deg))
    Z, TH = np.meshgrid(zs, th)
    shift = Z * math.tan(math.radians(lean_deg))
    a = math.radians(azimuth_deg)
    x = base[0] + shift * math.sin(a) + radius * np.cos(TH)
    y = base[1] + shift * math.cos(a) + radius * np.sin(TH)
    return np.stack([x, y, base[2] + Z], axis=-1).reshape(-1, 3)


def ring_picks(rng, sigma=0.01, k=8, z_low=1.0, z_high=19.0, radius=1.0, lean_deg=1.0, azimuth_deg=90.0):
    """k picks round the lower ring (group 0) and k round the upper ring (group 1), each coordinate
    with Gaussian noise `sigma` (ruling G7), as `CloudMeasurementPoint` dicts."""
    out = []
    for group, z_rel in ((0, z_low), (1, z_high)):
        cx, cy = _axis_centre(z_rel, lean_deg, azimuth_deg)
        for i in range(k):
            t = 2 * math.pi * (i + 0.25) / k
            n = rng.normal(0.0, sigma, 3) if sigma else (0.0, 0.0, 0.0)
            out.append(
                {
                    "x": cx + radius * math.cos(t) + n[0],
                    "y": cy + radius * math.sin(t) + n[1],
                    "z": CYL_BASE[2] + z_rel + n[2],
                    "uncertainty_m": 0.01,
                    "group": group,
                }
            )
    return out


def face_picks(rng, sigma=0.01, z_low=1.0, z_high=19.0, radius=1.0, lean_deg=1.0, azimuth_deg=90.0):
    """The two-point method's picks: the east face at the bottom and at the top, with noise."""
    out = []
    for z_rel in (z_low, z_high):
        cx, cy = _axis_centre(z_rel, lean_deg, azimuth_deg)
        n = rng.normal(0.0, sigma, 3) if sigma else (0.0, 0.0, 0.0)
        out.append(
            {"x": cx + radius + n[0], "y": cy + n[1], "z": CYL_BASE[2] + z_rel + n[2], "uncertainty_m": 0.01}
        )
    return out


def write_shapes_las(path: Path) -> Path:
    """The patch and the cylinder in one LAS 1.2 format 3 file in EPSG:32639 (patch red, cylinder grey)."""
    import laspy
    import numpy as np
    from pyproj import CRS

    patch, _ = tilted_patch()
    cyl = leaning_cylinder()
    xyz = np.vstack([patch, cyl])
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.floor(xyz.min(axis=0))
    header.add_crs(CRS.from_epsg(SHAPES_EPSG))
    las = laspy.LasData(header)
    las.x, las.y, las.z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    colour = (
        np.vstack([np.tile([220, 40, 40], (len(patch), 1)), np.tile([160, 160, 160], (len(cyl), 1))]) * 257
    )
    las.red, las.green, las.blue = colour[:, 0], colour[:, 1], colour[:, 2]
    las.classification = np.full(len(xyz), 6, dtype=np.uint8)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(path)
    return path


def band_widths(s, z, z_lo: float, z_hi: float, bin_m: float = 0.1) -> list[dict]:
    """Per `bin_m` height bin in [z_lo, z_hi): the extent max(s) - min(s) of the points in it (the
    shell thickness when the section crosses one wall)."""
    import numpy as np

    s = np.asarray(s, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    keep = (z >= z_lo) & (z < z_hi)
    idx = np.floor((z[keep] - z_lo) / bin_m).astype(int)
    rows = []
    for b in np.unique(idx):
        sel = s[keep][idx == b]
        rows.append(
            {"z": z_lo + (b + 0.5) * bin_m, "width": float(sel.max() - sel.min()), "n": int(len(sel))}
        )
    return rows


def _summary(rows: list[dict]) -> dict:
    widths = sorted(r["width"] for r in rows if r["n"] >= 5)
    if not widths:
        return {"bins": 0, "median_m": None, "max_m": None}
    return {
        "bins": len(widths),
        "median_m": round(widths[len(widths) // 2], 4),
        "max_m": round(widths[-1], 4),
    }


def _import(c: httpx.Client, pid: str, source: str) -> tuple[dict, dict, float]:
    t0 = time.perf_counter()
    r = c.post(f"/projects/{pid}/pointclouds", json={"path": source})
    r.raise_for_status()
    created = r.json()
    job = wait_job(c, pid, created["job"]["id"])
    return created, job, round(time.perf_counter() - t0, 2)


def run_setup(a) -> dict:
    c = client(a.base, a.token, getattr(a, "transport", None))
    pid, crack = new_project(c, Path(a.project_folder))
    created, job, wall = _import(c, pid, a.source)
    out = {
        "scenario": "setup",
        "project_id": pid,
        "cloud_id": created["cloud"]["id"],
        "crack_type_id": crack,
        "import_state": job["state"],
        "import_error": job.get("error"),
        "import_wall_s": wall,
        "source_id": None,
        "photos_state": None,
        "photos_wall_s": None,
    }
    if getattr(a, "photos", None):
        t0 = time.perf_counter()
        r = c.post(f"/projects/{pid}/sources", json={"folder": a.photos})
        r.raise_for_status()
        made = r.json()
        pjob = wait_job(c, pid, made["job"]["id"])
        out.update(
            source_id=made["source"]["id"],
            photos_state=pjob["state"],
            photos_wall_s=round(time.perf_counter() - t0, 2),
        )
    return out


def run_shapes(a) -> dict:
    import numpy as np

    c = client(a.base, a.token, getattr(a, "transport", None))
    pid = a.project_id or new_project(c, Path(a.project_folder))[0]
    las = write_shapes_las(Path(a.project_folder) / "shapes.las")
    created, job, _ = _import(c, pid, str(las))
    cid = created["cloud"]["id"]
    rng = np.random.default_rng(7)
    _, corners = tilted_patch()
    cases = {
        "area": (
            [{"x": float(p[0]), "y": float(p[1]), "z": float(p[2]), "uncertainty_m": 0.01} for p in corners],
            "area",
            {"mode": "surface"},
        ),
        "rings": (ring_picks(rng), "vertical", {"method": "rings"}),
        "twopoint": (face_picks(rng), "vertical", {"method": "points"}),
    }
    out = {"scenario": "shapes", "project_id": pid, "cloud_id": cid, "import_state": job["state"]}
    for name, (points, kind, params) in cases.items():
        r = c.post(
            f"/projects/{pid}/pointclouds/{cid}/measurements",
            json={"kind": kind, "points": points, "params": params},
        )
        r.raise_for_status()
        out[name] = {"points": points, "params": params, "server": r.json()["results"], "id": r.json()["id"]}
    area = out["area"]["server"]
    rings = out["rings"]["server"]
    two = out["twopoint"]["server"]
    out["checks"] = {
        "surface_3_000_within_0_5pct": abs(area["area_surface_m2"] - 3.0) <= 0.015,
        "plan_1_500_within_0_5pct": abs(area["area_plan_m2"] - 1.5) <= 0.0075,
        "rings_angle_1_00_within_0_01": abs(rings["lean_angle_deg"] - 1.0) <= 0.01,
        "rings_azimuth_90_within_0_5": abs(rings["lean_azimuth_deg"] - 90.0) <= 0.5,
        "rings_error_deg": abs(rings["lean_angle_deg"] - 1.0),
        "twopoint_error_deg": abs(two["lean_angle_deg"] - 1.0),
    }
    return out


def _section(a) -> tuple[dict, dict, float]:
    """The section line: from --outside-m east of the rim centre to the centre, at the rim's z."""
    x, y, z = (float(v) for v in a.rim.split(","))
    A = {"x": x + a.outside_m, "y": y, "z": z, "uncertainty_m": 0.05}
    B = {"x": x, "y": y, "z": z, "uncertainty_m": 0.05}
    return A, B, z


def run_profile(a) -> dict:
    c = client(a.base, a.token, getattr(a, "transport", None))
    A, B, rim_z = _section(a)
    t0 = time.perf_counter()
    r = c.post(
        f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/measurements",
        json={"kind": "profile", "points": [A, B], "params": {"thickness_m": a.thickness}},
    )
    r.raise_for_status()
    made = r.json()
    job = wait_job(c, a.project_id, made["job"]["id"])
    wall = round(time.perf_counter() - t0, 2)
    mid = made["measurement"]["id"]
    m = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/measurements").json()
    row = next(x for x in m["items"] if x["id"] == mid)
    prof = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/measurements/{mid}/profile").json()
    top = band_widths(prof["s"], prof["z"], rim_z - 10.0, rim_z + 0.5)
    return {
        "scenario": "profile",
        "measurement_id": mid,
        "state": job["state"],
        "error": job.get("error"),
        "wall_s": wall,
        "line": [A, B],
        "thickness_m": a.thickness,
        "profile_width_max_m": row["results"]["profile_width_max_m"],
        "profile_point_count": row["results"]["profile_point_count"],
        "top_band": _summary(top),
        "top_band_rows": top,
    }


def run_crosscheck(a) -> dict:
    """The top-band widths from the source LAS itself (independent of app/pointclouds/profile.py):
    chunks of 2 M points, only the slab kept."""
    import laspy
    import numpy as np

    A, B, rim_z = _section(a)
    ax, ay = A["x"], A["y"]
    dx, dy = B["x"] - ax, B["y"] - ay
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    s_all, z_all = [], []
    with laspy.open(a.source) as f:
        for chunk in f.chunk_iterator(2_000_000):
            x = np.asarray(chunk.x, dtype=np.float64) - ax
            y = np.asarray(chunk.y, dtype=np.float64) - ay
            s = x * ux + y * uy
            t = -x * uy + y * ux
            keep = (np.abs(t) <= a.thickness / 2) & (s >= 0) & (s <= length)
            s_all.append(s[keep])
            z_all.append(np.asarray(chunk.z, dtype=np.float64)[keep])
    s = np.concatenate(s_all) if s_all else np.zeros(0)
    z = np.concatenate(z_all) if z_all else np.zeros(0)
    top = band_widths(s, z, rim_z - 10.0, rim_z + 0.5)
    return {
        "scenario": "crosscheck",
        "slab_points": int(len(s)),
        "line": [A, B],
        "thickness_m": a.thickness,
        "top_band": _summary(top),
        "top_band_rows": top,
    }


def run_views(a) -> dict:
    import hashlib
    import io

    from PIL import Image

    c = client(a.base, a.token, getattr(a, "transport", None))
    items = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/views").json()["items"]
    rows = []
    for v in items:  # one image in memory at a time (each at most 6 MiB)
        path = (
            f"/projects/{a.project_id}/findings/{v['subject_id']}/view3d"
            if v["subject_kind"] == "finding"
            else f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/measurements/{v['subject_id']}/view3d"
        )
        data = c.get(path).content
        with Image.open(io.BytesIO(data)) as im:
            size = [im.width, im.height]
        sha_ok = hashlib.sha256(data).hexdigest() == v["sha256"]
        rows.append(
            {
                "subject_kind": v["subject_kind"],
                "subject_id": v["subject_id"],
                "size": size,
                "bytes": len(data),
                "sha_ok": sha_ok,
                "stale": v["stale"],
                "complete": v["render"]["complete"],
                "edl": v["render"]["edl"],
                "ok": sha_ok and size == [1600, 1000],
            }
        )
    return {
        "scenario": "views",
        "count": len(rows),
        "ok": sum(r["ok"] for r in rows),
        "stale": sum(r["stale"] for r in rows),
        "incomplete": sum(not r["complete"] for r in rows),
        "rows": rows,
    }


def run_cameras(a) -> dict:
    c = client(a.base, a.token, getattr(a, "transport", None))
    r = c.get(f"/projects/{a.project_id}/pointclouds/{a.cloud_id}/cameras")
    if r.status_code != 200:
        return {"scenario": "cameras", "status": r.status_code, "error": r.json().get("error")}
    s = r.json()
    zs = sorted(v for v in s["z"] if v is not None)
    return {
        "scenario": "cameras",
        "status": 200,
        "cameras": len(s["image_id"]),
        "posed": sum(v is not None for v in s["yaw"]),
        "fov_assumed": sum(s["fov_assumed"]),
        "without_gps": s["without_gps"],
        "truncated": s["truncated"],
        "sources": s["sources"],
        "z_median": zs[len(zs) // 2] if zs else None,
        "z_p1": s["z_p1"],
        "z_p99": s["z_p99"],
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "scenario",
        choices=[
            "import",
            "cancel",
            "export",
            "setup",
            "shapes",
            "profile",
            "crosscheck",
            "views",
            "cameras",
        ],
    )
    p.add_argument("--base")
    p.add_argument("--token", help="default: KESTREL_TOKEN, else APP_TOKEN")
    p.add_argument("--project-folder")
    p.add_argument("--project-id")
    p.add_argument("--source")
    p.add_argument("--cloud-id")
    p.add_argument("--backend-pid", type=int)
    p.add_argument("--photos")
    p.add_argument("--rim", help="x,y,z of the stack's rim centre (profile, crosscheck)")
    p.add_argument("--outside-m", type=float, default=8.0)
    p.add_argument("--thickness", type=float, default=0.2)
    p.add_argument("--out", help="also write the JSON line to this file")
    a = p.parse_args()
    a.token = resolve_token(a.token, os.environ)
    run = {
        "import": run_import,
        "cancel": run_cancel,
        "export": run_export,
        "setup": run_setup,
        "shapes": run_shapes,
        "profile": run_profile,
        "crosscheck": run_crosscheck,
        "views": run_views,
        "cameras": run_cameras,
    }
    out = run[a.scenario](a)
    line = json.dumps(out)
    if a.out:
        Path(a.out).write_text(line + "\n", encoding="utf-8")
    print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
