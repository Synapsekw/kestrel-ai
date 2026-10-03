"""Plain text -> reportlab Paragraph markup (spec §8.1: text is escaped at the renderer)."""

from __future__ import annotations

import re
from xml.sax.saxutils import escape

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_CELL_CHARS = 2000


_LONE_DASH = ("\u2014", "\u2013")


def undash(value: str) -> str:
    """The kit's house rule for PDF text (gen.py `clean`): no em or en dash. A lone dash (an empty
    cell) prints as a hyphen, a spaced en dash (a range) as "to", an em dash as a comma."""
    s = str(value)
    if s.strip() in _LONE_DASH:
        return "-"
    return (
        s.replace(" \u2013 ", " to ").replace(" \u2014 ", ", ").replace("\u2014", ", ").replace("\u2013", "-")
    )


def text(value: object, limit: int | None = None) -> str:
    """Control characters dropped, dashes undone, XML escaped, newlines kept as <br/>, optionally cut
    with an ellipsis."""
    s = undash(_CONTROL.sub("", "" if value is None else str(value)))
    if limit is not None and len(s) > limit:
        s = s[: limit - 1] + "…"
    return escape(s).replace("\n", "<br/>")
