"""Job type registry. Sub-projects register their long-running work here (spec section 4, Job)."""

from collections.abc import Callable

from app.errors import AppError

_TYPES: dict[str, Callable] = {}
_CANCELLED_BEFORE_START: dict[str, Callable] = {}


def register_job_type(name: str, *, on_cancelled_before_start: Callable | None = None):
    """Decorator: `@register_job_type("import")` on `fn(ctx: JobContext) -> dict | None`.

    `on_cancelled_before_start(ctx)` runs when a queued job is cancelled before `fn` ever ran, so a
    job type whose rows `fn` would have settled can settle them (and tell the UI) itself."""

    def deco(fn: Callable):
        _TYPES[name] = fn
        if on_cancelled_before_start is not None:
            _CANCELLED_BEFORE_START[name] = on_cancelled_before_start
        return fn

    return deco


def get_job_type(name: str) -> Callable:
    try:
        return _TYPES[name]
    except KeyError:
        raise AppError("validation_error", f"unknown job type {name!r}", 422) from None


def cancelled_before_start_hook(name: str) -> Callable | None:
    return _CANCELLED_BEFORE_START.get(name)
