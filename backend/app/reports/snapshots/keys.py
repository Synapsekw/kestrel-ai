"""A snapshot spec's canonical form, its base64url wire form and its key (spec §9.1, §9.5).

The key is sha256(canonical JSON + source_version + RENDERER_VERSION)[:32]. The preview sends the
spec in the query; the server re-parses and re-canonicalises it, so a key never depends on the
client's bytes (contract/fixtures/report-snapshot-keys.json documents the rules for R6's parity)."""

from __future__ import annotations

import base64
import hashlib
import json
import math
from types import SimpleNamespace
from typing import Any

from app.reports.snapshots import RENDERER_VERSION

# uvicorn's h11 refuses a request head over 16 KiB; the spec is most of the request line.
MAX_SPEC_CHARS = 12_000


def plain(value: Any) -> Any:
    """A pydantic model, a SimpleNamespace, or nested dicts/lists of them, as plain JSON values."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, SimpleNamespace):
        return {k: plain(v) for k, v in vars(value).items()}
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


def _normalise(value: Any) -> Any:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("a snapshot spec cannot hold NaN or infinity")
        return int(value) if value.is_integer() else value
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        return {k: _normalise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalise(v) for v in value]
    raise TypeError(f"{type(value).__name__} cannot be part of a snapshot spec")


def canonical_json(spec: Any) -> str:
    return json.dumps(
        _normalise(plain(spec)), sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )


def encode_spec(spec: Any) -> str:
    return base64.urlsafe_b64encode(canonical_json(spec).encode("utf-8")).rstrip(b"=").decode("ascii")


def decode_spec(text: str) -> dict:
    """The JSON object inside an unpadded base64url string. ValueError for anything else."""
    if not text or len(text) > MAX_SPEC_CHARS:
        raise ValueError("the snapshot spec is empty or too long")
    raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("the snapshot spec is not a JSON object")
    return data


def key_of(canonical: str, source_version: str) -> str:
    payload = f"{canonical}\n{source_version}\n{RENDERER_VERSION}".encode()
    return hashlib.sha256(payload).hexdigest()[:32]


def snapshot_key(handle, spec) -> str:
    """The key `spec` has now (its sources' current versions included)."""
    from app.reports.snapshots.render import compute_key

    return compute_key(handle, spec)[0]
