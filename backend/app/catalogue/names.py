"""Name and hotkey normalisation for catalogue types (spec 2026-09-26-foundation section 7.1)."""

import re

from app.errors import AppError

_SEPARATORS = re.compile(r"[_\-]+")
_SPACES = re.compile(r"\s+")
_HOTKEY = re.compile(r"^[1-9a-z]$")


def normalise_name(name: str) -> str:
    """Casefold, trim, `_` and `-` become spaces, runs of spaces collapse: "dump_truck" and
    "Dump truck" are one type."""
    return _SPACES.sub(" ", _SEPARATORS.sub(" ", (name or "").casefold())).strip()


def like_pattern(text: str) -> str:
    """`text` as a LIKE pattern matched anywhere, with a backslash, `%` and `_` taken literally. Use it with
    `escape="\\"`. The same rule as BK's `app.data_items.search.like_pattern`; a copy here because
    importing `app.data_items` from the catalogue would close an import cycle through
    `app.projects.service`."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def normalise_hotkey(key: str | None) -> str | None:
    """`1`-`9` or a letter, stored lower case; None or "" means no hotkey."""
    if key is None or key == "":
        return None
    k = key.strip().lower()
    if not _HOTKEY.match(k):
        raise AppError("hotkey_invalid", f"{key!r} is not a hotkey; use 1-9 or a letter.", 422)
    return k
