### Task 6: Job runner, jobs endpoints and websocket events

**Files:**
- Create: `backend/app/jobs/runner.py`, `backend/app/jobs/registry.py`, `backend/app/jobs/events.py`, `backend/app/jobs/schemas.py`, `backend/app/jobs/router.py`, `backend/app/pagination.py`, `backend/tests/test_jobs.py`

**Interfaces:**
- Produces:
  - `register_job_type(name: str)` decorator in `app/jobs/registry.py`; `get_job_type(name) -> Callable`. A job function has signature `fn(ctx: JobContext) -> dict | None` and runs on a worker thread.
  - `JobContext` with `project: ProjectHandle`, `job_id: str`, `params: dict`, `log: logging.Logger` (writes to the job log file), `progress(fraction: float, message: str = "")`, `cancelled: threading.Event`, `check_cancelled()` (raises `JobCancelled`), `publish(type: str, payload: dict)` for domain events such as `images.changed`.
  - `JobRunner(events: EventBus)` with `submit(project: ProjectHandle, type: str, params: dict) -> Job` (creates the row queued, log path `runs/<job_id>/job.log`, schedules on a thread pool of 2 workers), `cancel(project, job_id) -> Job`, `start()`, `stop()`.
  - `EventBus.publish(event: dict)` (thread-safe) and `EventBus.subscribe() -> asyncio.Queue`; event dict `{type: "job.progress"|"job.state"|"boxes.changed"|"images.changed", project_id, job_id, progress, message, payload}`.
  - `encode_cursor(**kv) -> str` and `decode_cursor(s) -> dict` in `app/pagination.py` (base64 JSON), plus `clamp_limit(limit) -> int` (1..1000, default 100).
- Consumes: `ProjectHandle`, `Job` model.

- [ ] **Step 1: Write failing tests**

`tests/test_jobs.py`:

```python
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.jobs.registry import register_job_type


@register_job_type("test_sleep")
def _sleep_job(ctx):
    for i in range(5):
        ctx.check_cancelled()
        ctx.progress(i / 5, f"step {i}")
        ctx.log.info("step %d", i)
        time.sleep(0.05)
    return {"steps": 5}


@register_job_type("test_fail")
def _fail_job(ctx):
    raise RuntimeError("boom")


def _project(client, project_dir):
    return client.post("/api/v1/projects", json={"name": "A", "folder": str(project_dir), "classes": []}).json()["id"]


def _wait(client, pid, jid, states=("succeeded", "failed", "cancelled"), timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/projects/{pid}/jobs/{jid}").json()
        if j["state"] in states:
            return j
        time.sleep(0.05)
    raise AssertionError("timeout waiting for job")


def test_job_runs_to_success_with_progress_and_log(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "succeeded" and j["progress"] == 1.0 and j["result"] == {"steps": 5}
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log", params={"tail": 50}).json()
    assert any("step 4" in line for line in log["lines"])


def test_failed_job_records_error(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_fail", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "failed" and "boom" in j["error"]
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log").json()
    assert any("Traceback" in line for line in log["lines"])


def test_cancel_job(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    r = client.post(f"/api/v1/projects/{pid}/jobs/{job.id}/cancel")
    assert r.status_code == 200
    assert _wait(client, pid, job.id)["state"] == "cancelled"


def test_jobs_list_paginates(client, project_dir, app):
    pid = _project(client, project_dir)
    for _ in range(3):
        app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    page = client.get(f"/api/v1/projects/{pid}/jobs", params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = client.get(f"/api/v1/projects/{pid}/jobs", params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None


def test_unknown_job_type_is_422(client, project_dir, app):
    pid = _project(client, project_dir)
    from app.errors import AppError
    with pytest.raises(AppError):
        app.state.jobs.submit(app.state.projects.get(pid), "nope", {})


def test_websocket_receives_job_events(client, project_dir, app):
    pid = _project(client, project_dir)
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
        seen = set()
        for _ in range(40):
            ev = ws.receive_json()
            if ev["job_id"] != job.id:
                continue
            seen.add(ev["type"])
            if ev["type"] == "job.state" and ev["payload"]["state"] == "succeeded":
                break
        assert {"job.progress", "job.state"} <= seen


def test_websocket_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/events?token=wrong"):
            pass
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_jobs.py`
Expected: ImportError.

- [ ] **Step 3: Implement**

`app/jobs/events.py`:

```python
import asyncio

from fastapi import WebSocket


class EventBus:
    def __init__(self):
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: dict) -> None:  # safe to call from worker threads
        if self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self._fanout, event)

    def _fanout(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass


async def events_websocket(ws: WebSocket) -> None:
    from app.auth import ws_token_ok

    if not ws_token_ok(ws):
        await ws.close(code=4401)
        return
    await ws.accept()
    bus: EventBus = ws.app.state.events
    q = bus.subscribe()
    try:
        while True:
            ev = await q.get()
            await ws.send_json(ev)
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
```

`app/jobs/registry.py`:

```python
from collections.abc import Callable

from app.errors import AppError

_TYPES: dict[str, Callable] = {}


def register_job_type(name: str):
    def deco(fn: Callable):
        _TYPES[name] = fn
        return fn
    return deco


def get_job_type(name: str) -> Callable:
    try:
        return _TYPES[name]
    except KeyError:
        raise AppError("validation_error", f"unknown job type {name!r}", 422) from None
```

`app/jobs/runner.py`:

```python
import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models import Job
from app.errors import not_found
from app.jobs.events import EventBus
from app.jobs.registry import get_job_type
from app.projects.service import ProjectHandle


class JobCancelled(Exception):
    pass


class JobContext:
    def __init__(self, runner: "JobRunner", project: ProjectHandle, job_id: str, params: dict, log: logging.Logger):
        self.runner, self.project, self.job_id, self.params, self.log = runner, project, job_id, params, log
        self.cancelled = threading.Event()
        self._last_db_write = 0.0

    def check_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, float(fraction)))
        now = time.monotonic()
        if now - self._last_db_write >= 0.25:
            self._last_db_write = now
            self.runner._update(self.project, self.job_id, progress=fraction, message=message)
        self.runner.events.publish({"type": "job.progress", "project_id": self.project.id, "job_id": self.job_id,
                                    "progress": fraction, "message": message, "payload": {}})

    def publish(self, type: str, payload: dict) -> None:
        self.runner.events.publish({"type": type, "project_id": self.project.id, "job_id": self.job_id,
                                    "progress": None, "message": "", "payload": payload})


class JobRunner:
    def __init__(self, events: EventBus, workers: int = 2):
        self.events = events
        self._pool: ThreadPoolExecutor | None = None
        self._contexts: dict[str, JobContext] = {}
        self._workers = workers

    def start(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=self._workers, thread_name_prefix="job")

    def stop(self) -> None:
        for ctx in self._contexts.values():
            ctx.cancelled.set()
        if self._pool:
            self._pool.shutdown(wait=False, cancel_futures=True)

    def submit(self, project: ProjectHandle, type: str, params: dict) -> Job:
        fn = get_job_type(type)
        with project.session() as s:
            job = Job(type=type, params=params, log_path="")
            s.add(job)
            s.flush()
            job.log_path = f"runs/{job.id}/job.log"
            s.flush()
            s.expunge(job)
        log_dir = project.runs_dir / job.id
        log_dir.mkdir(parents=True, exist_ok=True)
        logger = logging.getLogger(f"job.{job.id}")
        logger.setLevel(logging.INFO)
        logger.propagate = False
        handler = logging.FileHandler(log_dir / "job.log", encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        ctx = JobContext(self, project, job.id, params, logger)
        self._contexts[job.id] = ctx
        self._pool.submit(self._run, ctx, fn, handler)
        return job

    def cancel(self, project: ProjectHandle, job_id: str) -> Job:
        ctx = self._contexts.get(job_id)
        if ctx is None:
            job = self.get(project, job_id)
            if job.state == "queued":
                return self._update(project, job_id, state="cancelled", finished_at=datetime.now(timezone.utc))
            return job
        ctx.cancelled.set()
        return self.get(project, job_id)

    def get(self, project: ProjectHandle, job_id: str) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            if job is None:
                raise not_found("job", job_id)
            s.expunge(job)
            return job

    def _update(self, project: ProjectHandle, job_id: str, **fields) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            for k, v in fields.items():
                setattr(job, k, v)
            s.flush()
            s.expunge(job)
        if "state" in fields:
            self.events.publish({"type": "job.state", "project_id": project.id, "job_id": job_id,
                                 "progress": job.progress, "message": job.message,
                                 "payload": {"state": job.state, "result": job.result, "error": job.error}})
        return job

    def _run(self, ctx: JobContext, fn, handler: logging.Handler) -> None:
        try:
            if ctx.cancelled.is_set():
                raise JobCancelled()
            self._update(ctx.project, ctx.job_id, state="running", started_at=datetime.now(timezone.utc))
            ctx.log.info("job %s started with %s", ctx.job_id, ctx.params)
            result = fn(ctx)
            self._update(ctx.project, ctx.job_id, state="succeeded", progress=1.0, result=result,
                         finished_at=datetime.now(timezone.utc))
            ctx.log.info("job succeeded")
        except JobCancelled:
            self._update(ctx.project, ctx.job_id, state="cancelled", finished_at=datetime.now(timezone.utc))
            ctx.log.info("job cancelled")
        except Exception as e:
            ctx.log.error("job failed\n%s", traceback.format_exc())
            self._update(ctx.project, ctx.job_id, state="failed", error=f"{type(e).__name__}: {e}",
                         finished_at=datetime.now(timezone.utc))
        finally:
            ctx.log.removeHandler(handler)
            handler.close()
            self._contexts.pop(ctx.job_id, None)
```

Note the select import is unused in the sketch above; drop it in the real file.

`app/pagination.py`:

```python
import base64
import json


def encode_cursor(**kv) -> str:
    return base64.urlsafe_b64encode(json.dumps(kv, default=str).encode()).decode()


def decode_cursor(s: str | None) -> dict:
    if not s:
        return {}
    try:
        return json.loads(base64.urlsafe_b64decode(s.encode()).decode())
    except Exception:
        from app.errors import AppError
        raise AppError("validation_error", "invalid cursor", 422) from None


def clamp_limit(limit: int | None) -> int:
    return max(1, min(1000, limit or 100))
```

`app/jobs/router.py`: `GET /projects/{projectId}/jobs` (query `state`, `type`, `limit`, `cursor`; ordered by `created_at desc, id desc`; the cursor carries `{created_at, id}` of the last item; fetch `limit + 1` rows to decide `next_cursor`), `GET .../jobs/{jobId}`, `POST .../jobs/{jobId}/cancel` (200 with the Job), `GET .../jobs/{jobId}/log?tail=200` returning `{"lines": [...], "path": "<relative log path>"}` reading the last `tail` lines of the file (empty list when the file does not exist yet). `app/jobs/schemas.py` holds `JobOut` with `from_row(row, project_id)` (adds `project_id`).

- [ ] **Step 4: Run tests, lint, commit**

Run: `.\.venv\Scripts\python -m pytest -q && .\.venv\Scripts\ruff check .`
Expected: all pass.

```bash
git add backend && git commit -m "feat(backend): job runner, jobs api and websocket events"
```

---

