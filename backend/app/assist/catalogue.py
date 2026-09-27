"""The assist-model catalogue (spec 2026-09-26-image-inspection §10, §16).

Which smart-polygon weights the app knows, where they live (`<library>/assist/`), and whether the
file on disk is the one that was pinned. Reading the state never imports torch and hashes a file at
most once per (size, mtime).
"""

from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

from app.errors import AppError, not_found

CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class AssistSpec:
    key: str
    name: str
    description: str
    file_name: str
    size_bytes: int
    sha256: str


# Pinned 2026-09-27 from https://github.com/ultralytics/assets/releases/download/v8.4.0/sam2.1_t.pt
SAM2_1_TINY = AssistSpec(
    key="sam2.1_t",
    name="SAM 2.1 tiny",
    description="Smart polygon: click an object and get its outline.",
    file_name="sam2.1_t.pt",
    size_bytes=78_105_722,
    sha256="3c1e81ca9b037dd39d70a014ddb9a813d6c4c4e12555420db7eaff31689bd4e3",
)
ASSIST_MODELS: dict[str, AssistSpec] = {SAM2_1_TINY.key: SAM2_1_TINY}
SAM_KEY = SAM2_1_TINY.key
#: The `Box.assist` value of a polygon drawn with smart polygon (spec §8.1, §10 step 6).
ASSIST_SAM = "sam"

_verified: dict[str, tuple[int, int, bool]] = {}  # resolved path -> (size, mtime_ns, ok)
_verified_lock = threading.Lock()

# "missing" matches the contract's AssistModel.reason example verbatim (controller ruling).
MESSAGES = {
    "missing": "The smart-polygon model is not on this machine.",
    "invalid": "The smart polygon model file is damaged or is not the expected version. Get it again.",
}


def get_spec(key: str) -> AssistSpec:
    spec = ASSIST_MODELS.get(key)
    if spec is None:
        raise not_found("assist model", key)
    return spec


def weights_path(library_folder: Path, spec: AssistSpec) -> Path:
    """`<library>/assist/<file>`; pass `library_root(data_dir)` or a library handle's `folder`."""
    return Path(library_folder) / "assist" / spec.file_name


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as f:
        while chunk := f.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def forget_verified() -> None:
    with _verified_lock:
        _verified.clear()


def file_ok(path: Path, spec: AssistSpec) -> bool:
    """Size first (free), then sha256 once per file version (ruling BS9)."""
    st = Path(path).stat()
    if st.st_size != spec.size_bytes:
        return False
    key = str(Path(path).resolve())
    with _verified_lock:
        hit = _verified.get(key)
    if hit is not None and hit[:2] == (st.st_size, st.st_mtime_ns):
        return hit[2]
    ok = sha256_file(path) == spec.sha256
    with _verified_lock:
        _verified[key] = (st.st_size, st.st_mtime_ns, ok)
    return ok


def _file_state(spec: AssistSpec, library_folder: Path) -> str:
    path = weights_path(library_folder, spec)
    if not path.is_file():
        return "missing"
    return "ready" if file_ok(path, spec) else "invalid"


def _unavailable_message(reason: str) -> str:
    """The one place that builds the "unavailable" sentence (Task 3 reuses it via this module)."""
    return f"Smart polygon is not available in this build: {reason}"


def status(
    spec: AssistSpec, library_folder: Path, job_id: str | None, unavailable_reason: str | None = None
) -> dict:
    """One `AssistModel` (contract, I-C0): exactly its eight fields; `unavailable` wins (ruling BS1)."""
    if unavailable_reason:
        state, reason = "unavailable", _unavailable_message(unavailable_reason)
    else:
        state = _file_state(spec, library_folder)
        reason = MESSAGES.get(state)
    return {
        "key": spec.key,
        "name": spec.name,
        "description": spec.description,
        "size_mb": round(spec.size_bytes / 1_000_000, 1),
        "sha256": spec.sha256,
        "state": state,
        "reason": reason,
        "job_id": job_id,
    }


def missing_error(state: str, message: str) -> AppError:
    return AppError("assist_model_missing", message, 409, {"key": SAM_KEY, "state": state})


def require_ready(library_folder: Path, unavailable_reason: str | None) -> Path:
    """The SAM weights path, or 409 `assist_model_missing` saying why S cannot run (ruling BS1)."""
    if unavailable_reason:
        raise missing_error("unavailable", _unavailable_message(unavailable_reason))
    spec = get_spec(SAM_KEY)
    state = _file_state(spec, library_folder)
    if state != "ready":
        raise missing_error(state, MESSAGES[state])
    return weights_path(library_folder, spec)
