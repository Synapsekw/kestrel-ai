"""The project kind guard (spec 2026-09-23 section 5.2).

Every route under `/projects/{projectId}` declares which kinds of project it serves, with a
`require_kind(...)` dependency on its router or on the route itself. `tests/test_project_kinds.py`
walks `app.routes` and fails when one does not, so a new router cannot forget.
"""

from collections.abc import Callable

from fastapi import Depends, Request

from app.errors import AppError
from app.projects.service import ProjectHandle, get_project

KIND_ATTR = "__kestrel_kind__"
TRAIN = "train"
DETECT = "detect"
ANY_KIND: tuple[str, ...] = (TRAIN, DETECT)
_READ_METHODS = frozenset({"GET", "HEAD"})
_NOUN = {TRAIN: "a training project", DETECT: "a detection project"}


def project_kind(handle: ProjectHandle) -> str:
    """The project's kind. It never changes after creation, so it is read once per open handle."""
    kind = getattr(handle, "_kind", None)
    if kind is None:
        with handle.session() as s:
            kind = handle.row(s).kind or TRAIN
        handle._kind = kind
    return kind


def _refusal(kind: str, allowed: tuple[str, ...]) -> AppError:
    wanted = " or ".join(_NOUN[k] for k in allowed)
    return AppError(
        "wrong_project_kind",
        f"This is {_NOUN.get(kind, 'a ' + kind + ' project')}; this can only be done in {wanted}.",
        409,
        {"kind": kind, "allowed": list(allowed)},
    )


def require_kind(write: tuple[str, ...], read: tuple[str, ...] | None = None) -> Callable:
    """A FastAPI dependency: GET/HEAD are checked against `read` (defaults to `write`), other
    methods against `write`. A wrong kind is `409 wrong_project_kind` with `{kind, allowed}`."""
    write = tuple(write)
    read = write if read is None else tuple(read)
    if set(write) >= set(ANY_KIND) and set(read) >= set(ANY_KIND):

        def _any_kind() -> None:
            """Serves both kinds: nothing to check, and no need to open the project here."""

        guard = _any_kind
    else:

        def _check_kind(request: Request, handle: ProjectHandle = Depends(get_project)) -> None:
            allowed = read if request.method in _READ_METHODS else write
            kind = project_kind(handle)
            if kind not in allowed:
                raise _refusal(kind, allowed)

        guard = _check_kind
    setattr(guard, KIND_ATTR, (write, read))
    return guard
