"""Thread-pool job runner. Each job writes its state to the project DB and publishes events."""

import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from app.db.models import Job
from app.errors import not_found
from app.jobs.cancellation import JobCancelled
from app.jobs.events import EventBus
from app.jobs.registry import get_job_type
from app.projects.service import ProjectHandle

PROGRESS_DB_INTERVAL_S = 0.25
log = logging.getLogger(__name__)


__all__ = ["JobCancelled", "JobContext", "JobRunner"]


class JobContext:
    """What a job function receives: project handle, params, a logger, progress and cancellation."""

    def __init__(
        self, runner: "JobRunner", project: ProjectHandle, job_id: str, params: dict, log: logging.Logger
    ):
        self.runner, self.project, self.job_id, self.params, self.log = runner, project, job_id, params, log
        self.cancelled = threading.Event()
        self._last_db_write = 0.0
        # The newest message, stored with the terminal state: the throttled write may have skipped it.
        self.last_message: str | None = None

    def check_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, float(fraction)))
        self.last_message = message
        now = time.monotonic()
        if now - self._last_db_write >= PROGRESS_DB_INTERVAL_S:
            self._last_db_write = now
            self.runner.update(self.project, self.job_id, progress=fraction, message=message)
        self.runner.events.publish(
            {
                "type": "job.progress",
                "project_id": self.project.id,
                "job_id": self.job_id,
                "progress": fraction,
                "message": message,
                "payload": {},
            }
        )

    def publish(self, type: str, payload: dict) -> None:
        """Domain events such as images.changed or boxes.changed."""
        self.runner.events.publish(
            {
                "type": type,
                "project_id": self.project.id,
                "job_id": self.job_id,
                "progress": None,
                "message": "",
                "payload": payload,
            }
        )


class JobRunner:
    def __init__(self, events: EventBus, workers: int = 2):
        self.events = events
        self._workers = workers
        self._pool: ThreadPoolExecutor | None = None
        self._contexts: dict[str, JobContext] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=self._workers, thread_name_prefix="job")

    def stop(self) -> None:
        with self._lock:
            contexts = list(self._contexts.values())
        for ctx in contexts:
            ctx.cancelled.set()
        if self._pool:
            self._pool.shutdown(wait=True, cancel_futures=True)
            self._pool = None
        for ctx in contexts:  # jobs that were still queued never ran; mark them cancelled
            try:
                job = self.get(ctx.project, ctx.job_id)
                if job.state == "queued":
                    self.update(ctx.project, ctx.job_id, state="cancelled", finished_at=datetime.now(UTC))
                    ctx.log.info("job cancelled before it started")
            except Exception:
                log.exception("could not mark queued job %s cancelled at shutdown", ctx.job_id)
            finally:
                self._close_log(ctx)
        with self._lock:
            self._contexts.clear()

    @staticmethod
    def _close_log(ctx: "JobContext") -> None:
        for h in list(ctx.log.handlers):
            ctx.log.removeHandler(h)
            h.close()

    def submit(self, project: ProjectHandle, type: str, params: dict) -> Job:
        fn = get_job_type(type)
        with project.session() as s:
            job = Job(type=type, params=params)
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
        with self._lock:
            self._contexts[job.id] = ctx
        self._pool.submit(self._run, ctx, fn)
        return job

    def cancel(self, project: ProjectHandle, job_id: str) -> Job:
        with self._lock:
            ctx = self._contexts.get(job_id)
        if ctx is not None:
            ctx.cancelled.set()
            return self.get(project, job_id)
        job = self.get(project, job_id)
        if job.state == "queued":  # left over from a previous process
            return self.update(project, job_id, state="cancelled", finished_at=datetime.now(UTC))
        return job

    def is_live(self, job_id: str) -> bool:
        """True while this process holds the job: queued in the pool or running right now."""
        with self._lock:
            return job_id in self._contexts

    def get(self, project: ProjectHandle, job_id: str) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            if job is None:
                raise not_found("job", job_id)
            s.expunge(job)
            return job

    def update(self, project: ProjectHandle, job_id: str, **fields) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            for k, v in fields.items():
                setattr(job, k, v)
            s.flush()
            s.expunge(job)
        if "state" in fields:
            self.events.publish(
                {
                    "type": "job.state",
                    "project_id": project.id,
                    "job_id": job_id,
                    "progress": job.progress,
                    "message": job.message,
                    "payload": {"state": job.state, "result": job.result, "error": job.error},
                }
            )
        return job

    def _run(self, ctx: JobContext, fn) -> None:
        try:
            if ctx.cancelled.is_set():
                raise JobCancelled()
            self.update(ctx.project, ctx.job_id, state="running", started_at=datetime.now(UTC))
            ctx.log.info("job %s started", ctx.job_id)
            result = fn(ctx)
            final = {"message": ctx.last_message} if ctx.last_message is not None else {}
            self._finish(ctx, state="succeeded", progress=1.0, result=result, **final)
            ctx.log.info("job succeeded")
        except JobCancelled:
            self._finish(ctx, state="cancelled")
            ctx.log.info("job cancelled")
        except Exception as e:
            ctx.log.error("job failed\n%s", traceback.format_exc())
            log.warning("job %s failed: %s: %s", ctx.job_id, type(e).__name__, e)  # params may hold secrets
            self._finish(ctx, state="failed", error=f"{type(e).__name__}: {e}")
        finally:
            self._close_log(ctx)
            with self._lock:
                self._contexts.pop(ctx.job_id, None)

    def _finish(self, ctx: JobContext, **fields) -> None:
        """Terminal state write; a DB failure here is logged and never escapes into the executor future."""
        try:
            self.update(ctx.project, ctx.job_id, finished_at=datetime.now(UTC), **fields)
        except Exception:
            log.exception("could not record terminal state %s for job %s", fields.get("state"), ctx.job_id)
