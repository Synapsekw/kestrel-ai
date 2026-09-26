"""Shared test helpers for the model library: add models without loading a real checkpoint."""

import time
import uuid
from pathlib import Path

from app.library import service

LIB = "/api/v1/library"
CLASSES = ["excavator", "dump_truck"]


def stub_checkpoint(monkeypatch, task: str = "detect", names: list[str] | None = None) -> None:
    """`read_checkpoint` without torch: every file reads as a YOLO checkpoint with these classes."""
    monkeypatch.setattr(service, "read_checkpoint", lambda path: (task, list(names or CLASSES)))


def fake_weights(folder: Path, name: str = "fake.pt", content: bytes | None = None) -> Path:
    """A stand-in weights file with unique content, so each one is a distinct library model."""
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(content if content is not None else f"not a checkpoint {uuid.uuid4()}".encode())
    return p


def add_library_model(app, tmp_path: Path, name: str = "m", class_names=None, **kw):
    """A ready library model row (with a real weights file) in the app's library."""
    return service.add_model(
        app.state.library,
        source_weights=fake_weights(tmp_path / "weights-src", f"{uuid.uuid4().hex}.pt"),
        name=name,
        origin=kw.pop("origin", "imported"),
        task=kw.pop("task", "detect"),
        class_names=list(class_names or CLASSES),
        **kw,
    )


def wait_library_job(client, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"{LIB}/jobs/{job_id}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.05)
    raise AssertionError(f"library job {job_id} did not finish within {timeout}s")
