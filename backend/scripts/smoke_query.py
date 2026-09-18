"""Manual smoke test: run a cloud query over N images of a project and promote the result.

    set ANTHROPIC_API_KEY=...
    python scripts/smoke_query.py --project <id> --provider anthropic --query "dump trucks" --images 3

The key is read from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` and stored through the API into Windows
Credential Manager; it is never taken from an argument, printed or logged. The script prints the
cost estimate, asks for confirmation, then follows `job.progress` on the websocket and promotes the
run. No tests cover this file; it is an operator aid.
"""

import argparse
import json
import os
import sys
from urllib.parse import urlencode

import httpx
import websockets.sync.client as ws_client

KEY_ENV = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}


def api(base: str, token: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=60)


def check(r: httpx.Response) -> dict:
    if r.status_code >= 400:
        raise SystemExit(f"{r.request.method} {r.request.url} -> {r.status_code} {r.text}")
    return r.json() if r.content else {}


def store_key(client: httpx.Client, provider: str) -> None:
    key = os.environ.get(KEY_ENV[provider])
    if not key:
        raise SystemExit(f"set {KEY_ENV[provider]} in the environment first")
    check(client.put(f"/api/v1/providers/{provider}/key", json={"api_key": key}))
    print(f"stored the {provider} key in Credential Manager")
    test = check(client.post(f"/api/v1/providers/{provider}/test"))
    print(f"provider test: ok={test['ok']} model={test['model_name']} ({test['message']})")
    if not test["ok"]:
        raise SystemExit("the stored key was rejected")


def follow(base: str, token: str, job_id: str) -> dict:
    url = base.replace("http", "ws", 1).rstrip("/") + "/api/v1/events?" + urlencode({"token": token})
    with ws_client.connect(url) as ws:
        while True:
            event = json.loads(ws.recv())
            if event.get("job_id") != job_id:
                continue
            if event["type"] == "job.progress":
                print(f"  {event['progress']:.0%} {event['message']}")
            if event["type"] == "job.state":
                state = event["payload"]["state"]
                print(f"  job {state}")
                if state in ("succeeded", "failed", "cancelled"):
                    return event["payload"]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default="http://127.0.0.1:8765", help="backend origin")
    p.add_argument("--token", default="dev-token", help="per-launch token")
    p.add_argument("--project", required=True, help="project id")
    p.add_argument("--provider", default="anthropic", choices=sorted(KEY_ENV))
    p.add_argument("--query", default="construction machinery")
    p.add_argument("--images", type=int, default=2, help="how many of the project's images to run on")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--tile-size", type=int, default=1280)
    p.add_argument("--promote", type=float, default=None, help="min_confidence to promote with at the end")
    p.add_argument("--yes", action="store_true", help="skip the cost confirmation")
    a = p.parse_args(argv)

    client = api(a.base, a.token)
    store_key(client, a.provider)

    listed = check(client.get(f"/api/v1/projects/{a.project}/images", params={"limit": a.images}))
    image_ids = [i["id"] for i in listed["items"]]
    if not image_ids:
        raise SystemExit("the project has no images; import a folder first")

    body = {
        "kind": "cloud_provider",
        "provider": a.provider,
        "query": a.query,
        "image_ids": image_ids,
        "tiling": {"enabled": True, "tile_size": a.tile_size, "overlap": 0.2, "nms_iou": 0.5},
        "conf": a.conf,
    }
    estimate = check(client.post(f"/api/v1/projects/{a.project}/query-runs/estimate", json=body))
    print(
        f"{estimate['images']} images, {estimate['tiles']} tiles, "
        f"about ${estimate['estimated_cost']:.2f} at ${estimate['cost_per_request']} per request"
    )
    if not a.yes and input("run it? [y/N] ").strip().lower() != "y":
        return 1

    created = check(client.post(f"/api/v1/projects/{a.project}/query-runs", json=body))
    run_id, job_id = created["query_run"]["id"], created["job"]["id"]
    print(f"query run {run_id} as job {job_id}")
    payload = follow(a.base, a.token, job_id)
    print(json.dumps(payload.get("result") or {"error": payload.get("error")}, indent=2))

    run = check(client.get(f"/api/v1/projects/{a.project}/query-runs/{run_id}"))
    print(f"{run['box_count']} proposal boxes written")
    if a.promote is not None:
        promoted = check(
            client.post(
                f"/api/v1/projects/{a.project}/query-runs/{run_id}/promote",
                json={"min_confidence": a.promote},
            )
        )
        print(f"promoted {promoted['accepted']} boxes at min_confidence {a.promote}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
