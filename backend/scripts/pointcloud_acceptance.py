"""Point-cloud acceptance driver (spec §17.1-§17.4, §17.13) against a running backend.

  import  create a detection project in --project-folder, import --source, report wall time,
          the cloud's facts, the converter's peak RSS and the backend's RSS growth
  cancel  start an import, cancel it once the converter runs, report how long until no
          PotreeConverter.exe is left, and the cloud's final state
  export  export --cloud-id (in --project-id) as LAZ, report wall time and size ratio

Each prints one JSON line. The backend's pid (--backend-pid) is needed for the RSS figures.
"""

from __future__ import annotations

import argparse
import json
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


def client(base: str, token: str) -> httpx.Client:
    return httpx.Client(
        base_url=f"{base.rstrip('/')}/api/v1", headers={"Authorization": f"Bearer {token}"}, timeout=120
    )


def wait_job(c: httpx.Client, project_id: str, job_id: str, timeout: float = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = c.get(f"/projects/{project_id}/jobs/{job_id}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.25)
    raise TimeoutError(job_id)


def new_project(c: httpx.Client, folder: Path) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    body = {
        "name": "Point-cloud acceptance",
        "folder": str(folder),
        "classes": [{"name": "excavator", "colour": "#f97316"}],
        "kind": "detect",
    }
    r = c.post("/projects", json=body)
    r.raise_for_status()
    return r.json()["id"]


def run_import(a) -> dict:
    c = client(a.base, a.token)
    pid = a.project_id or new_project(c, Path(a.project_folder))
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
    pid = a.project_id or new_project(c, Path(a.project_folder))
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


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("scenario", choices=["import", "cancel", "export"])
    p.add_argument("--base", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--project-folder", required=True)
    p.add_argument("--project-id")
    p.add_argument("--source")
    p.add_argument("--cloud-id")
    p.add_argument("--backend-pid", type=int)
    a = p.parse_args()
    out = {"import": run_import, "cancel": run_cancel, "export": run_export}[a.scenario](a)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
