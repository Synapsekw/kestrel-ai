"""Plain text -> reportlab Paragraph markup (spec §8.1: text is escaped at the renderer)."""

from __future__ import annotations

import re
from xml.sax.saxutils import escape

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_CELL_CHARS = 2000


def text(value: object, limit: int | None = None) -> str:
    """Control characters dropped, XML escaped, newlines kept as <br/>, optionally cut with an ellipsis."""
    s = _CONTROL.sub("", "" if value is None else str(value))
    if limit is not None and len(s) > limit:
        s = s[: limit - 1] + "…"
    return escape(s).replace("\n", "<br/>")
