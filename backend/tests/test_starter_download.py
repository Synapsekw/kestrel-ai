import io
import logging
import threading
from types import SimpleNamespace

import pytest

from app.jobs.cancellation import JobCancelled, JobFailure
from app.training import starter, starter_download


class Context:
    def __init__(self, handle=None, **params):
        self.params = params
        self.project = handle
        self.cancelled = threading.Event()
        self.messages = []
        self.log = logging.getLogger(__name__)

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise JobCancelled()

    def progress(self, fraction, message):
        self.messages.append((fraction, message))


class Response(io.BytesIO):
    def __init__(self, body, length=None, cancel=None):
        super().__init__(body)
        self.headers = {"Content-Length": str(len(body) if length is None else length)}
        self.cancel = cancel

    def read(self, size=-1):
        assert 0 < size <= starter_download.CHUNK_BYTES
        result = super().read(size)
        if self.cancel:
            self.cancel.set()
        return result


def test_streams_one_asset_with_bounded_reads_and_no_partial_cache(tmp_path, monkeypatch):
    ctx = Context()
    body = b"x" * (starter_download.CHUNK_BYTES + 1)
    urls = []

    def open_response(url, timeout):
        urls.append(url)
        assert timeout <= 15
        return Response(body)

    monkeypatch.setattr(starter_download, "urlopen", open_response)
    target = tmp_path / "yolo26n.pt"
    starter_download.download_weights(ctx, target)
    assert target.read_bytes() == body
    assert list(tmp_path.iterdir()) == [target]
    assert urls == [f"{starter_download.ASSET_BASE}/yolo26n.pt"]
    assert len(ctx.messages) == 2


@pytest.mark.parametrize("reason", ["truncated", "cancelled", "oversized"])
def test_failed_downloads_never_publish_or_leave_partial_files(tmp_path, monkeypatch, reason):
    ctx = Context()
    response = Response(
        b"data",
        length=10 if reason == "truncated" else 4,
        cancel=ctx.cancelled if reason == "cancelled" else None,
    )
    if reason == "oversized":
        response.headers["Content-Length"] = str(starter_download.MAX_BYTES + 1)
    monkeypatch.setattr(starter_download, "urlopen", lambda *args, **kwargs: response)
    with pytest.raises((JobFailure, JobCancelled)):
        starter_download.download_weights(ctx, tmp_path / "yolo26n.pt")
    assert list(tmp_path.iterdir()) == []


def test_acquisition_reuses_cache_and_removes_new_unloadable_weights(handle, tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    cache.mkdir()
    target = cache / "yolo26n.pt"
    calls = []

    def download(ctx, path):
        calls.append(path)
        path.write_bytes(b"checkpoint")

    monkeypatch.setattr(starter_download, "download_weights", download)
    monkeypatch.setattr(starter, "import_starter", lambda *args: SimpleNamespace(id="model-id"))
    ctx = Context(handle, key="yolo26n", cache_dir=str(cache), bundle_dir=str(tmp_path / "absent"))
    assert starter_download.run_acquire_starter(ctx) == {"model_id": "model-id"}
    assert starter_download.run_acquire_starter(ctx) == {"model_id": "model-id"}
    assert len(calls) == 1
    target.unlink()

    def invalid(*args):
        raise ValueError("bad checkpoint")

    monkeypatch.setattr(starter, "import_starter", invalid)
    with pytest.raises(ValueError, match="bad checkpoint"):
        starter_download.run_acquire_starter(ctx)
    assert not target.exists()


def test_catalogue_finds_downloaded_weights_in_writable_cache(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "yolo26n.pt").write_bytes(b"x" * 100)
    item = next(i for i in starter.list_starters(tmp_path / "bundle", cache) if i["key"] == "yolo26n")
    assert item["available"] is True


@pytest.mark.parametrize("source", ["bundle", "cache"])
@pytest.mark.parametrize("task", ["classify", "segment", "pose", "obb"])
def test_starter_rejects_renamed_non_detection_checkpoint_before_registration(
    handle, tmp_path, monkeypatch, source, task
):
    import sys

    from app.errors import AppError
    from app.training import registry

    folder = tmp_path / source
    folder.mkdir()
    (folder / "yolo26n.pt").write_bytes(b"checkpoint renamed to a detection filename")
    loads = []

    def load_model(path):
        loads.append(path)
        return SimpleNamespace(task=task, names={0: "truck"})

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=load_model))
    ctx = Context(
        handle, key="yolo26n", bundle_dir=str(tmp_path / "bundle"), cache_dir=str(tmp_path / "cache")
    )
    with pytest.raises(AppError, match="requires a detect checkpoint"):
        starter_download.run_acquire_starter(ctx)
    assert len(loads) == 1
    assert registry.list_models(handle, None, None)[0] == []
    assert list(handle.models_dir.glob("*.pt")) == []


def test_starter_validates_detection_and_reads_names_in_one_model_load(handle, tmp_path, monkeypatch):
    import sys

    from app.training import registry

    (tmp_path / "yolo26n.pt").write_bytes(b"detection checkpoint")
    loads = []

    def load_model(path):
        loads.append(path)
        return SimpleNamespace(task="detect", names={0: "truck"})

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=load_model))
    ctx = Context(handle, key="yolo26n", bundle_dir=str(tmp_path), cache_dir=str(tmp_path / "cache"))
    result = starter_download.run_acquire_starter(ctx)
    assert len(loads) == 1
    assert registry.get_model(handle, result["model_id"]).class_names == ["truck"]
