"""Batch detection over a scope as one `infer` job (image inspection spec §11.3, §15)."""

import pytest
from library_helpers import add_library_model
from sqlalchemy import select

from app.db.models import Box, Image, Job, QueryRun, Source
from app.library import service as library
from app.providers.base import Detection, TileResult

BASE = "/api/v1/projects"


class MappedProvider:
    """One detection per tile for the model class `excavator`, dropped when the run's map leaves it out."""

    name = "fake"

    def __init__(self, class_map):
        self.class_map = class_map or {}

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        label = self.class_map.get("excavator")
        dets = [] if label is None else [Detection(label, tile.x + 10, tile.y + 10, 40, 30, 0.9, raw_ref)]
        return TileResult(tile=tile, detections=dets)


@pytest.fixture(autouse=True)
def provider(monkeypatch):
    monkeypatch.setattr(
        "app.inference.jobs.get_provider", lambda kind, **kw: MappedProvider(kw.get("class_map"))
    )


def _source(handle, make_jpeg, n, label) -> tuple[str, list[str]]:
    with handle.session() as s:
        source = Source(folder=str(handle.folder), site="test", kind="images", label=label, image_count=n)
        s.add(source)
        s.flush()
        ids = []
        for i in range(n):
            rel = f"images/{source.id[:8]}-{i}.jpg"
            make_jpeg(handle.folder / rel, 320, 240, seed=i)
            row = Image(path=rel, width=320, height=240, source_id=source.id)
            s.add(row)
            s.flush()
            ids.append(row.id)
        return source.id, ids


@pytest.fixture
def flights(handle, make_jpeg) -> dict:
    a, a_ids = _source(handle, make_jpeg, 3, "Flight A")
    b, b_ids = _source(handle, make_jpeg, 1, "Flight B")
    return {"a": a, "a_ids": a_ids, "b": b, "b_ids": b_ids}


@pytest.fixture
def model(app, tmp_path):
    return add_library_model(app, tmp_path, name="m", class_names=["excavator", "zzz_not_a_type"])


def batch(client, project_id, **body):
    body.setdefault("kind", "local_model")
    return client.post(f"{BASE}/{project_id}/images/detect-batch", json=body)


def jobs(handle) -> list[Job]:
    with handle.session() as s:
        return list(s.execute(select(Job)).scalars())


def runs(handle) -> list[QueryRun]:
    with handle.session() as s:
        return list(s.execute(select(QueryRun)).scalars())


def test_an_image_ids_scope_queues_one_infer_job(client, wait_job, project_id, handle, flights, model):
    ids = flights["a_ids"][:2]
    r = batch(client, project_id, model_id=model.id, scope={"image_ids": ids})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job"]["type"] == "infer"
    run = body["query_run"]
    assert run["image_ids"] == ids and run["source_id"] is None and run["kind"] == "local_model"
    assert run["class_map"]["excavator"] is not None and "zzz_not_a_type" not in run["class_map"]
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    with handle.session() as s:
        rows = list(s.execute(select(Box).where(Box.query_run_id == run["id"])).scalars())
    assert len(rows) == 2 and {r.image_id for r in rows} == set(ids)


def test_a_source_scope_runs_that_sources_photos_in_path_order(client, project_id, flights, model):
    run = batch(client, project_id, model_id=model.id, scope={"source_id": flights["a"]}).json()["query_run"]
    assert run["source_id"] == flights["a"] and run["image_ids"] == flights["a_ids"]


def test_a_filter_scope_is_resolved_to_ids_at_creation(client, project_id, flights, model):
    r = batch(client, project_id, model_id=model.id, scope={"filter": {"source_id": flights["b"]}})
    assert r.status_code == 202, r.text
    assert r.json()["query_run"]["image_ids"] == flights["b_ids"]


def test_a_filter_matching_nothing_is_no_images(client, project_id, handle, flights, model):
    r = batch(client, project_id, model_id=model.id, scope={"filter": {"search": "no-such-frame-zzz"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_images"
    assert runs(handle) == [] and jobs(handle) == []


def test_a_filter_severity_reaches_the_index_as_text(client, project_id, flights, model):
    # No image has findings, so a severity filter matches nothing: the ints were accepted and passed on.
    r = batch(client, project_id, model_id=model.id, scope={"filter": {"severity": [3, 4]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_images"


@pytest.mark.parametrize(
    "scope",
    [
        {},
        {"image_ids": ["x"], "source_id": "y"},
        {"source_id": "y", "colour": "red"},
        {"filter": {"severity": [0]}},
    ],
)
def test_a_scope_outside_the_schema_is_a_validation_error(client, project_id, handle, flights, model, scope):
    r = batch(client, project_id, model_id=model.id, scope=scope)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert jobs(handle) == []


def test_unknown_images_or_sources_are_404_before_anything_is_written(
    client, project_id, handle, flights, model
):
    assert batch(client, project_id, model_id=model.id, scope={"image_ids": ["nope"]}).status_code == 404
    assert batch(client, project_id, model_id=model.id, scope={"source_id": "nope"}).status_code == 404
    assert runs(handle) == [] and jobs(handle) == []


def test_the_kind_decides_what_is_required(client, project_id, handle, flights, model):
    local_without_model = batch(client, project_id, kind="local_model", scope={"source_id": flights["a"]})
    cloud_without_provider = batch(
        client, project_id, kind="cloud_provider", query="trucks", scope={"source_id": flights["a"]}
    )
    for r in (local_without_model, cloud_without_provider):
        assert r.status_code == 422 and r.json()["error"]["code"] == "model_or_provider_required"
    # the other kind's field is ignored, not refused
    r = batch(
        client,
        project_id,
        kind="local_model",
        model_id=model.id,
        provider="anthropic",
        scope={"source_id": flights["a"]},
    )
    assert r.status_code == 202, r.text
    assert r.json()["query_run"]["provider"] is None


def test_a_model_with_nothing_mapped_is_refused_before_any_job(
    client, app, tmp_path, project_id, handle, flights
):
    m = add_library_model(app, tmp_path, name="odd", class_names=["zzz_not_a_type"])
    r = batch(client, project_id, model_id=m.id, scope={"source_id": flights["a"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unmapped_classes"
    assert runs(handle) == [] and jobs(handle) == []


def test_missing_weights_is_409_before_any_job(client, app, project_id, handle, flights, model):
    library.weights_file(app.state.library, model).unlink()
    r = batch(client, project_id, model_id=model.id, scope={"source_id": flights["a"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"
    assert runs(handle) == [] and jobs(handle) == []


def test_a_segmentation_model_is_accepted(client, wait_job, app, tmp_path, project_id, flights):
    m = add_library_model(app, tmp_path, name="seg", task="segment", class_names=["excavator"])
    r = batch(client, project_id, model_id=m.id, scope={"source_id": flights["b"]})
    assert r.status_code == 202, r.text
    assert r.json()["query_run"]["model_snapshot"]["task"] == "segment"
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"


def test_a_cloud_batch_needs_a_key_and_a_query(client, app, project_id, handle, flights):
    cloud = {"kind": "cloud_provider", "provider": "anthropic", "scope": {"source_id": flights["a"]}}
    no_key = batch(client, project_id, query="trucks", **cloud)
    assert no_key.status_code == 409 and no_key.json()["error"]["code"] == "conflict"
    app.state.keys.set("anthropic", "sk-fake-key")
    no_query = batch(client, project_id, query="   ", **cloud)
    assert no_query.status_code == 422 and no_query.json()["error"]["code"] == "query_required"
    assert runs(handle) == []
