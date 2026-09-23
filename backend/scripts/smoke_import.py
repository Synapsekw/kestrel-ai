"""Drive a running backend through one import, end to end, and print what came out.

This is a manual aid for the integration checkpoints, not a test: it talks to a real sidecar
over HTTP instead of the in-process test client.

Usage:
  python scripts/smoke_import.py --base http://127.0.0.1:8765 --token $env:APP_TOKEN \
      --project-folder E:\\tmp\\smoke --source E:\\Dev\\Yolo\\data\\raw\\ahmadia
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

CLASSES = [
    ("excavator", "#f97316"),
    ("wheel_loader", "#eab308"),
    ("bulldozer", "#22c55e"),
    ("dump_truck", "#06b6d4"),
    ("crane", "#3b82f6"),
    ("concrete_mixer", "#a855f7"),
    ("roller", "#ec4899"),
    ("backhoe", "#ef4444"),
]


def _check(r: httpx.Response) -> dict:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} -> {r.status_code} {r.text}")
    return r.json()


def open_or_create_project(client: httpx.Client, folder: Path) -> dict:
    if (folder / "project.db").exists():
        return _check(client.post("/api/v1/projects/open", json={"folder": str(folder)}))
    folder.mkdir(parents=True, exist_ok=True)
    classes = [{"name": n, "colour": c, "hotkey": str(i + 1)} for i, (n, c) in enumerate(CLASSES)]
    body = {"name": folder.name, "folder": str(folder), "classes": classes, "kind": "train"}
    return _check(client.post("/api/v1/projects", json=body))


def poll(client: httpx.Client, project_id: str, job_id: str) -> dict:
    last = ""
    while True:
        job = _check(client.get(f"/api/v1/projects/{project_id}/jobs/{job_id}"))
        line = f"{job['state']:10} {job['progress'] * 100:5.1f}%  {job['message']}"
        if line != last:
            print(line, flush=True)
            last = line
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.5)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8765", help="backend base url")
    ap.add_argument("--token", required=True, help="the sidecar's APP_TOKEN")
    ap.add_argument("--project-folder", required=True, type=Path)
    ap.add_argument("--source", required=True, type=Path, help="folder of originals to import")
    ap.add_argument("--site", default=None)
    args = ap.parse_args()

    headers = {"Authorization": f"Bearer {args.token}"}
    with httpx.Client(base_url=args.base, headers=headers, timeout=60.0) as client:
        health = _check(client.get("/api/v1/health"))
        print(f"backend {health['version']} pid {health['pid']}")

        project = open_or_create_project(client, args.project_folder.resolve())
        print(f"project {project['id']} at {project['folder']}")

        body = {"folder": str(args.source.resolve())}
        if args.site:
            body["site"] = args.site
        created = _check(client.post(f"/api/v1/projects/{project['id']}/sources", json=body))
        source, job = created["source"], created["job"]
        print(f"source {source['id']} site {source['site']}, import job {job['id']}")

        finished = poll(client, project["id"], job["id"])
        if finished["state"] != "succeeded":
            print(f"import {finished['state']}: {finished['error']}", file=sys.stderr)
            return 1
        print(f"result {finished['result']}")

        stats = _check(client.get(f"/api/v1/projects/{project['id']}/stats"))
        print(
            f"images {stats['image_count']} labeled {stats['labeled_count']} "
            f"duplicates {stats['duplicate_count']} groups {len(stats['groups'])}"
        )
        print(f"resolutions {stats['resolution_histogram']}")
        print(f"capture {stats['capture_time_range']}  gps {stats['gps_bounds']}")

        page = _check(client.get(f"/api/v1/projects/{project['id']}/images", params={"limit": 5}))
        print(f"first {len(page['items'])} of {page['total']} images:")
        for image in page["items"]:
            print(
                f"  {image['file_name']:32} {image['width']}x{image['height']} "
                f"group {image['group_key']} phash {image['phash']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
