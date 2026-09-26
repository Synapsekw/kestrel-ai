"""Opaque cursors for list endpoints (base64 JSON) and the shared limit clamp."""

import base64
import json

DEFAULT_LIMIT = 100
MAX_LIMIT = 1000


def encode_cursor(**kv) -> str:
    return base64.urlsafe_b64encode(json.dumps(kv, default=str).encode()).decode()


def decode_cursor(s: str | None, *required: str) -> dict:
    """Decode an opaque cursor; `required` names the keys it must carry (422 otherwise)."""
    if not s:
        return {}
    try:
        value = json.loads(base64.urlsafe_b64decode(s.encode()).decode())
        if not isinstance(value, dict) or any(k not in value for k in required):
            raise ValueError("missing cursor keys")
        return value
    except Exception:
        from app.errors import AppError

        raise AppError("validation_error", "invalid cursor", 422) from None


def clamp_limit(limit: int | None) -> int:
    return max(1, min(MAX_LIMIT, limit or DEFAULT_LIMIT))


def newest_first_page(
    s, q, created_at, id_, limit: int | None, cursor: str | None
) -> tuple[list, str | None]:
    """One keyset page of `q` (a `select` of one entity), newest first by `(created_at, id)`.

    `created_at` and `id_` are the entity's columns. Shared by the library's dataset and training-run
    lists (plan BM amendment A13), so both page, and reject a bad cursor, the same way.
    """
    from datetime import datetime

    from sqlalchemy import tuple_

    from app.errors import AppError

    n = clamp_limit(limit)
    q = q.order_by(created_at.desc(), id_.desc())
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        try:
            after = datetime.fromisoformat(str(c["created_at"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(tuple_(created_at, id_) < (after, str(c["id"])))
    rows = list(s.execute(q.limit(n + 1)).scalars())
    if len(rows) <= n:
        return rows, None
    rows = rows[:n]
    last = rows[-1]
    return rows, encode_cursor(
        created_at=getattr(last, created_at.key).isoformat(), id=getattr(last, id_.key)
    )
