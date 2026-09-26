"""`scripts/checkpoint2_backend.py` reuses a library model only when the import was a duplicate."""

import hashlib
import importlib.util
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "checkpoint2_backend.py"


@pytest.fixture(scope="module")
def cp2():
    spec = importlib.util.spec_from_file_location("checkpoint2_backend", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def library_api(items: list[dict]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/library/models"
        return httpx.Response(200, json={"items": items, "total": len(items)})

    return httpx.Client(base_url="http://test", transport=httpx.MockTransport(handler))


def test_sha256_file_matches_hashlib(cp2, tmp_path):
    f = tmp_path / "w.pt"
    f.write_bytes(b"x" * 3_000_000)
    assert cp2.sha256_file(f) == hashlib.sha256(f.read_bytes()).hexdigest()


def test_base_model_id_of_a_succeeded_import(cp2, tmp_path):
    job = {"state": "succeeded", "result": {"model_id": "m1"}, "error": None}
    assert cp2.base_model_id(library_api([]), job, tmp_path / "missing.pt") == "m1"


def test_base_model_id_reuses_the_duplicate(cp2, tmp_path):
    f = tmp_path / "w.pt"
    f.write_bytes(b"weights")
    digest = hashlib.sha256(b"weights").hexdigest()
    job = {"state": "failed", "error": "This file is already in the library as yolo11n."}
    api = library_api([{"id": "other", "sha256": "0" * 64}, {"id": "dup", "sha256": digest}])
    assert cp2.base_model_id(api, job, f) == "dup"


def test_base_model_id_stops_on_any_other_failure(cp2, tmp_path):
    f = tmp_path / "w.pt"
    f.write_bytes(b"weights")
    job = {"state": "failed", "error": "UnpicklingError: not a checkpoint"}
    with pytest.raises(SystemExit, match="UnpicklingError: not a checkpoint"):
        cp2.base_model_id(library_api([]), job, f)
