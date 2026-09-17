"""Job type registry. Sub-projects register their long-running work here (spec section 4, Job)."""

from collections.abc import Callable

from app.errors import AppError

_TYPES: dict[str, Callable] = {}


def register_job_type(name: str):
    """Decorator: `@register_job_type("import")` on `fn(ctx: JobContext) -> dict | None`."""

    def deco(fn: Callable):
        _TYPES[name] = fn
        return fn

    return deco


def get_job_type(name: str) -> Callable:
    try:
        return _TYPES[name]
    except KeyError:
        raise AppError("validation_error", f"unknown job type {name!r}", 422) from None
