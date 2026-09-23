"""Manual smoke test: train against a running dev backend and print live progress.

    python scripts/smoke_train.py --project <id> --dataset <id> --weights E:\\Dev\\Yolo\\models\\yolo11n.pt

It imports the base weights into the model library (unless `--base-model` names one already
there), starts a training job and prints `job.progress` and `job.state` events from the websocket
until the job ends.
No tests cover this file; it is an operator aid.
"""

import argparse
import json
import sys
import time
from urllib.parse import urlencode

import httpx
import websockets.sync.client as ws_client


def api(base: str, token: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=60)


def check(r: httpx.Response) -> dict:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} -> {r.status_code} {r.text}")
    return r.json() if r.content else {}


def wait_library_job(client: httpx.Client, job_id: str, timeout: float = 600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = check(client.get(f"/api/v1/library/jobs/{job_id}"))
        if job["state"] in ("succeeded", "failed", "cancelled"):
            return job
        time.sleep(0.5)
    raise SystemExit(f"library job {job_id} did not finish within {timeout} s")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://127.0.0.1:8765", help="backend origin")
    p.add_argument("--token", default="dev-token", help="per-launch token")
    p.add_argument("--project", required=True, help="project id")
    p.add_argument("--dataset", required=True, help="materialised dataset id")
    p.add_argument("--weights", help="absolute path to base .pt weights to import")
    p.add_argument("--base-model", help="library model id to train from instead of importing")
    p.add_argument("--name", default="smoke run")
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=None)
    p.add_argument("--device", default="0")
    p.add_argument("--augmentation", default="aerial", choices=["default", "aerial"])
    a = p.parse_args(argv)

    if not a.base_model and not a.weights:
        p.error("pass --base-model or --weights")

    client = api(a.base, a.token)
    base_model_id = a.base_model
    if not base_model_id:
        body = {"name": "smoke base", "weights_path": a.weights}
        queued = check(client.post("/api/v1/library/models/import", json=body))["job"]
        job = wait_library_job(client, queued["id"])
        if job["state"] != "succeeded":
            raise SystemExit(f"import {job['state']}: {job.get('error')}")
        imported = check(client.get(f"/api/v1/library/models/{job['result']['model_id']}"))
        base_model_id = imported["id"]
        print(f"imported {imported['name']} -> {base_model_id} ({len(imported['class_names'])} classes)")

    body = {
        "name": a.name,
        "dataset_id": a.dataset,
        "base_model_id": base_model_id,
        "epochs": a.epochs,
        "imgsz": a.imgsz,
        "batch": a.batch,
        "augmentation": a.augmentation,
        "device": a.device,
    }
    ws_url = a.base.replace("http", "ws", 1) + "/api/v1/events?" + urlencode({"token": a.token})
    with ws_client.connect(ws_url) as ws:
        job = check(client.post(f"/api/v1/projects/{a.project}/train", json=body))["job"]
        print(f"job {job['id']} queued; log at {job['log_path']}")
        while True:
            event = json.loads(ws.recv())
            if event.get("job_id") != job["id"]:
                continue
            if event["type"] == "job.progress":
                print(f"  {event['progress'] * 100:5.1f}%  {event['message']}")
            if event["type"] == "job.state":
                state = event["payload"]["state"]
                print(f"job {state}: {event['payload'].get('error') or event['payload'].get('result')}")
                if state in ("succeeded", "failed", "cancelled"):
                    return 0 if state == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
