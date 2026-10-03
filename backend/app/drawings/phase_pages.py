"""The `pages` phase (plant-model spec §8.1): one drawing_import job builds every chosen PDF page in
order, each through the `build` phase. A failing page fails only its own drawing (plan I1 Ruling 1);
a cancel fails the page in hand and every page left."""

from __future__ import annotations

from app.drawings import phase_build
from app.jobs.cancellation import JobCancelled, JobFailure


class PageCtx:
    """What `phase_build.run` sees for one page: the job's project, cancel flag and events, this
    page's build params, and progress mapped into the page's share of the job."""

    def __init__(self, ctx, item: dict, k: int, n: int):
        self._ctx = ctx
        self.project, self.job_id, self.cancelled = ctx.project, ctx.job_id, ctx.cancelled
        self.params = {
            "phase": "build",
            "drawing_id": item["drawing_id"],
            "inspection_id": ctx.params["inspection_id"],
            "page": item["page"],
            "dpi": item["dpi"],
            "layers": None,
            "placement": ctx.params["placement"],
        }
        self._lo, self._hi = k / n, (k + 1) / n
        self._label = f"Page {item['page']} ({k + 1} of {n})"

    def check_cancelled(self) -> None:
        self._ctx.check_cancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        f = max(0.0, min(1.0, float(fraction)))
        text = f"{self._label} · {message}" if message else self._label
        self._ctx.progress(self._lo + (self._hi - self._lo) * f, text)

    def publish(self, type: str, payload: dict) -> None:
        self._ctx.publish(type, payload)


def _fail_items(ctx, items: list[dict]) -> None:
    for item in items:
        phase_build._fail(ctx, item["drawing_id"], phase_build.CANCELLED)


def cancelled_before_start(ctx) -> None:
    _fail_items(ctx, ctx.params["items"])


def _reason(e: Exception) -> str:
    return str(e) if isinstance(e, JobFailure) else f"import failed: {type(e).__name__}"


def run(ctx) -> dict:
    items = list(ctx.params["items"])
    n = len(items)
    built: list[str] = []
    failed: list[dict] = []
    for k, item in enumerate(items):
        if ctx.cancelled.is_set():
            _fail_items(ctx, items[k:])
            raise JobCancelled()
        try:
            phase_build.run(PageCtx(ctx, item, k, n))
        except JobCancelled:
            _fail_items(ctx, items[k + 1 :])
            raise
        except Exception as e:  # phase_build already failed this page's row with the reason
            failed.append({"drawing_id": item["drawing_id"], "page": item["page"], "error": _reason(e)})
            continue
        built.append(item["drawing_id"])
    if not built:
        first = failed[0]
        raise JobFailure(f"none of the {n} pages could be imported; page {first['page']}: {first['error']}")
    ctx.progress(1.0, f"Imported {len(built)} of {n} pages" + (f"; {len(failed)} failed" if failed else ""))
    return {"drawing_ids": built, "failed": failed}
