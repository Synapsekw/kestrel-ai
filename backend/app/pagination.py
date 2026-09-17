"""Opaque cursors for list endpoints (base64 JSON) and the shared limit clamp."""

import base64
import json

DEFAULT_LIMIT = 100
MAX_LIMIT = 1000


def encode_cursor(**kv) -> str:
    return base64.urlsafe_b64encode(json.dumps(kv, default=str).encode()).decode()


def decode_cursor(s: str | None) -> dict:
    if not s:
        return {}
    try:
        return json.loads(base64.urlsafe_b64decode(s.encode()).decode())
    except Exception:
        from app.errors import AppError

        raise AppError("validation_error", "invalid cursor", 422) from None


def clamp_limit(limit: int | None) -> int:
    return max(1, min(MAX_LIMIT, limit or DEFAULT_LIMIT))
