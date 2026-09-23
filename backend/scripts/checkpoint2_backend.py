"""Integration checkpoint 2, backend half (spec 13.4): import the ahmadia sample through the real API,
label a few images, freeze a dataset, train 1 epoch and export ONNX, all over HTTP + websocket.

Usage (dev backend running with APP_TOKEN=<token> APP_PORT=8765):
  python scripts/checkpoint2_backend.py --token <token> --project-folder E:\\tmp\\cp2 \
      --source E:\\Dev\\Yolo\\data\\raw\\ahmadia --frames 20 --weights E:\\Dev\\Yolo\\models\\yolo11n.pt \
      --evidence ..\\docs\\evidence\\checkpoint2
Copies `--frames` files from --source into a temp folder first; the source is only read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

import httpx
from websockets.sync.client import connect as ws_connect

CLASSES = [
    "excavator",
    "wheel_loader",
    "bulldozer",
    "dump_truck",
    "crane",
    "concrete_mixer",
    "roller",
    "backhoe",
]
COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]


def check(r: httpx.Response, *codes: int) -> dict:
    if r.status_code not in (codes or (200, 201, 202)):
        raise SystemExit(f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:400]}")
    return r.json() if r.content else {}


def wait_job(api: httpx.Client, pid: str | None, jid: str, timeout: float = 900) -> dict:
    """Poll a project job, or a library job (import, export) when `pid` is None."""
    jobs = "/api/v1/library/jobs" if pid is None else f"/api/v1/projects/{pid}/jobs"
    t0 = time.time()
    last = ""
    while time.time() - t0 < timeout:
        j = check(api.get(f"{jobs}/{jid}"))
        msg = f"{j['state']} {j['progress']:.2f} {j['message']}"
        if msg != last:
            print("  job", j["type"], msg, flush=True)
            last = msg
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.5)
    raise SystemExit(f"job {jid} timed out")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8765")
    ap.add_argument("--token", required=True)
    ap.add_argument("--project-folder", required=True)
    ap.add_argument("--source", default=r"E:\Dev\Yolo\data\raw\ahmadia")
    ap.add_argument("--frames", type=int, default=20)
    ap.add_argument("--weights", default=r"E:\Dev\Yolo\models\yolo11n.pt")
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--imgsz", type=int, default=640)
    a = ap.parse_args()

    evidence = Path(a.evidence)
    evidence.mkdir(parents=True, exist_ok=True)
    record: dict = {"steps": []}

    def step(name: str, payload) -> None:
        record["steps"].append({"name": name, "at": time.time(), "payload": payload})
        print("PASS", name, flush=True)

    api = httpx.Client(base_url=a.base, headers={"Authorization": f"Bearer {a.token}"}, timeout=60)
    events: list[dict] = []
    stop = threading.Event()

    def listen() -> None:
        url = a.base.replace("http", "ws", 1) + f"/api/v1/events?token={a.token}"
        with ws_connect(url) as ws:
            while not stop.is_set():
                try:
                    events.append(json.loads(ws.recv(timeout=1)))
                except TimeoutError:
                    continue

    listener = threading.Thread(target=listen, daemon=True)
    listener.start()

    # 1. project
    folder = Path(a.project_folder)
    folder.mkdir(parents=True, exist_ok=True)
    classes = [
        {"name": n, "colour": c, "hotkey": str(i + 1)}
        for i, (n, c) in enumerate(zip(CLASSES, COLOURS, strict=True))
    ]
    project = check(
        api.post(
            "/api/v1/projects",
            json={"name": "Checkpoint 2", "folder": str(folder), "classes": classes, "kind": "train"},
        )
    )
    pid = project["id"]
    step("create project", {"id": pid, "classes": len(project["classes"])})

    # 2. import sample frames (copied; the source is only read)
    sample = Path(tempfile.mkdtemp(prefix="cp2-sample-"))
    files = sorted(Path(a.source).glob("*.jpg"))[: a.frames]
    for f in files:
        shutil.copy2(f, sample / f.name)
    created = check(
        api.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(sample), "site": "ahmadia"})
    )
    job = wait_job(api, pid, created["job"]["id"])
    assert job["state"] == "succeeded", job
    stats = check(api.get(f"/api/v1/projects/{pid}/stats"))
    step("import", {"result": job["result"], "image_count": stats["image_count"], "groups": stats["groups"]})
    assert stats["image_count"] == len(files)

    # 3. label 10 images through the boxes API (one excavator + one dump_truck each)
    page = check(api.get(f"/api/v1/projects/{pid}/images", params={"limit": 10, "sort": "path"}))
    cls = {c["name"]: c["id"] for c in project["classes"]}
    for i, img in enumerate(page["items"]):
        for cid, x in ((cls["excavator"], 400 + 50 * i), (cls["dump_truck"], 1800 + 40 * i)):
            check(
                api.post(
                    f"/api/v1/projects/{pid}/images/{img['id']}/boxes",
                    json={"class_id": cid, "x": x, "y": 600, "w": 180, "h": 120},
                )
            )
    stats = check(api.get(f"/api/v1/projects/{pid}/stats"))
    step("label", {"labeled_count": stats["labeled_count"], "box_count": stats["box_count"]})
    assert stats["labeled_count"] == 10 and stats["box_count"] == 20

    # 4. dataset
    ds = check(
        api.post(
            f"/api/v1/projects/{pid}/datasets",
            json={"name": "v1", "split_method": "by_group", "val_fraction": 0.2, "seed": 42},
        )
    )
    job = wait_job(api, pid, ds["job"]["id"])
    assert job["state"] == "succeeded", job
    dataset = check(api.get(f"/api/v1/projects/{pid}/datasets/{ds['dataset']['id']}"))
    data_yaml = folder / dataset["path"] / "data.yaml"
    dstats = check(api.get(f"/api/v1/projects/{pid}/datasets/{dataset['id']}/stats"))
    step(
        "dataset",
        {
            "train": dataset["train_count"],
            "val": dataset["val_count"],
            "data_yaml": data_yaml.read_text("utf-8"),
            "stats": dstats,
        },
    )
    assert data_yaml.exists() and dataset["train_count"] + dataset["val_count"] == 10

    # 5. import base weights into the model library and train
    imp = check(
        api.post(
            "/api/v1/library/models/import",
            json={
                "name": "yolo11n-coco",
                "weights_path": a.weights,
                "class_aliases": {"truck": "dump_truck"},
            },
        )
    )
    job = wait_job(api, None, imp["job"]["id"])
    if job["state"] == "succeeded":
        base_id = job["result"]["model_id"]
    else:  # the library is app-wide: an earlier run may have imported these weights already
        digest = hashlib.sha256(Path(a.weights).read_bytes()).hexdigest()
        library = check(api.get("/api/v1/library/models", params={"limit": 1000}))["items"]
        base_id = next((m["id"] for m in library if m["sha256"] == digest), None)
        assert base_id, job
    base = check(api.get(f"/api/v1/library/models/{base_id}"))
    step("import model", {"id": base["id"], "class_names": len(base["class_names"])})
    tr = check(
        api.post(
            f"/api/v1/projects/{pid}/train",
            json={
                "name": "cp2",
                "dataset_id": dataset["id"],
                "base_model_id": base["id"],
                "epochs": a.epochs,
                "imgsz": a.imgsz,
                "batch": 4,
                "patience": 5,
                "augmentation": "aerial",
                "device": "0",
            },
        )
    )
    t0 = time.time()
    job = wait_job(api, pid, tr["job"]["id"])
    assert job["state"] == "succeeded", job
    model = check(api.get(f"/api/v1/library/models/{job['result']['model_id']}"))
    progress_events = [
        e for e in events if e.get("job_id") == tr["job"]["id"] and e["type"] == "job.progress"
    ]
    step(
        "train",
        {
            "seconds": round(time.time() - t0, 1),
            "metrics": model["metrics"],
            "artifacts": model["artifacts"],
            "progress_events": len(progress_events),
            "sample_messages": [e["message"] for e in progress_events[:3]],
        },
    )
    assert model["origin"] == "trained" and model["metrics"] and progress_events

    # 6. export onnx
    ex = check(
        api.post(f"/api/v1/library/models/{model['id']}/export", json={"format": "onnx", "imgsz": a.imgsz})
    )
    job = wait_job(api, None, ex["job"]["id"])
    assert job["state"] == "succeeded", job
    model = check(api.get(f"/api/v1/library/models/{model['id']}"))
    # exports are relative to the model's own folder, `<library>/models/<slug>-<id8>/`
    library_root = Path(check(api.get("/api/v1/library/status"))["root"])
    model_dir = next((library_root / "models").glob(f"*-{model['id'][:8]}"))
    onnx_path = model_dir / model["exports"]["onnx"]
    step("export onnx", {"path": str(onnx_path), "bytes": onnx_path.stat().st_size})

    stop.set()
    (evidence / "checkpoint2-backend.json").write_text(json.dumps(record, indent=2, default=str), "utf-8")
    print("evidence:", evidence / "checkpoint2-backend.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
