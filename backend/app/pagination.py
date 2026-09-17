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
