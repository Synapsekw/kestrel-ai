"""createDrawingPages: which pages, at which DPI, under which names (plant-model spec §8.1; plan
2026-10-03-plant-model-i1 Rulings 2 to 5). Light imports only: the router loads this module."""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

from app.drawings import placement as placing
from app.drawings import store
from app.errors import AppError

MAX_PAGES = 500
MAX_NAME = 200
_SUFFIX = re.compile(r" · p\d+$")


def page_name(name: str, stem: str, page: int, page_count: int) -> str:
    """`<base> · p<k>` (the dialog's own naming), the base cut so the whole stays <= 200 chars; a
    one-page PDF keeps its plain name."""
    base = _SUFFIX.sub("", name.strip()).strip() or stem
    if page_count <= 1:
        return base[:MAX_NAME]
    suffix = f" · p{page}"
    return base[: MAX_NAME - len(suffix)] + suffix


def _refuse(message: str, reason: str) -> AppError:
    return AppError("invalid_pages", message, 422, {"reason": reason})


def check_pages(insp: dict, body, idir: Path) -> dict:
    """The pages to build, in order, each with its capped DPI, and the checked placement."""
    if insp["format"] != "pdf":
        raise _refuse("only a PDF has pages; import this file as one drawing", "pages")
    from app.drawings.pdf import DEFAULT_DPI, effective_dpi

    sizes = store.read_json(idir / "pages.json")["pages"]
    if body.pages == "all":
        chosen = list(range(1, len(sizes) + 1))
    else:
        chosen = list(dict.fromkeys(body.pages))
        if any(p > len(sizes) for p in chosen):
            raise _refuse(f"this PDF has {len(sizes)} page(s)", "page")
    if len(chosen) > MAX_PAGES:
        raise _refuse(f"import at most {MAX_PAGES} pages at a time", "pages")
    one = SimpleNamespace(page=chosen[0], dpi=body.dpi, layers=None, placement=body.placement)
    try:
        placement = placing.check(insp, one, idir)["placement"]
    except AppError as e:
        if e.code == "validation_error" and e.details.get("reason") == "page":
            raise _refuse(e.message, "page") from e
        raise
    wanted = body.dpi or DEFAULT_DPI
    planned = [
        (p, effective_dpi(wanted, sizes[p - 1]["width_pt"], sizes[p - 1]["height_pt"])) for p in chosen
    ]
    return {"pages": planned, "placement": placement}
