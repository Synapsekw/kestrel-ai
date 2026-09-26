"""Detection runs (spec 2026-09-23 sections 7.2-7.4, plan 2 unit R): one run per source, class
mapping before any job, the union list, pinning, recount, and the timeline's pinned override."""

from datetime import UTC, date, datetime

import pytest
from geotiffs import make_squares_geotiff
from library_helpers import add_library_model
from project_factory import new_project

from app.db.models import Box, GeoMap, Image, MapDetection, MapRun, QueryRun, Source
from app.maps.timeline import Basis, build_timeline
from app.providers.base import Detection, TileResult

BASE = "/api/v1/projects"


def _ids(client, project_id) -> dict[str, str]:
    return {c["name"]: c["id"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]}


def _add_images_source(handle, make_jpeg, n=2, label="Flight 1") -> str:
    with handle.session() as s:
        source = Source(folder=str(handle.folder), site="test", kind="images", label=label, image_count=n)
        s.add(source)
        s.flush()
        for i in range(n):
            rel = f"images/{source.id[:8]}-{i}.jpg"
            make_jpeg(handle.folder / rel, 320, 240, seed=i)
            s.add(Image(path=rel, width=320, height=240, source_id=source.id))
        return source.id


@pytest.fixture
def images_source(handle, make_jpeg) -> str:
    return _add_images_source(handle, make_jpeg)


@pytest.fixture
def map_source(client, project_id, handle, wait_job, tmp_path) -> str:
    path = make_squares_geotiff(tmp_path / "sq.tif", 1200, 800, [(200, 200, 60), (700, 400, 60)])
    r = client.post(f"{BASE}/{project_id}/maps", json={"path": str(path)})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    map_id = r.json()["map"]["id"]
    with handle.session() as s:
        source = Source(folder=str(path.parent), site="", kind="map", label="May survey")
        s.add(source)
        s.flush()
        s.get(GeoMap, map_id).source_id = source.id
        return source.id


class ModelLikeProvider:
    """Emits one detection per model class on every tile, translated through the provider's
    `class_map` exactly as `LocalYoloProvider` does: a class the map leaves out is dropped."""

    name = "fake"

    def __init__(self, model_classes, class_map):
        self.model_classes, self.class_map = model_classes, class_map

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        dets = []
        for i, name in enumerate(self.model_classes):
            label = self.class_map.get(name)
            if label is not None:
                dets.append(Detection(label, tile.x + 10 + 60 * i, tile.y + 10, 20, 20, 0.9))
        return TileResult(tile=tile, detections=dets)


@pytest.fixture
def model_provider(monkeypatch):
    """Both job modules build a provider that honours the class map they pass in."""
    seen: list[dict] = []

    def factory(kind, **kw):
        seen.append(kw)
        return ModelLikeProvider(kw["model_row"].class_names, kw["class_map"])

    monkeypatch.setattr("app.inference.jobs.get_provider", factory)
    monkeypatch.setattr("app.maps.jobs_detect.get_provider", factory)
    return seen


def _post(client, project_id, **body):
    return client.post(f"{BASE}/{project_id}/runs", json=body)


def _jobs(client, project_id) -> list[dict]:
    return client.get(f"{BASE}/{project_id}/jobs").json()["items"]


# ----------------------------------------------------------------- creation and mapping


def test_the_first_run_in_an_empty_project_seeds_its_classes(
    client, app, tmp_path, make_jpeg, wait_job, model_provider
):
    project = new_project(client, tmp_path / "empty", name="Empty")
    handle = app.state.projects.get(project["id"])
    source_id = _add_images_source(handle, make_jpeg)
    m = add_library_model(app, tmp_path, class_names=["car", "truck"])

    r = _post(client, project["id"], source_ids=[source_id], model_id=m.id)

    assert r.status_code == 202, r.text
    ids = _ids(client, project["id"])
    assert list(ids) == ["car", "truck"]
    run = r.json()["runs"][0]
    assert run["kind"] == "images" and run["source_id"] == source_id
    assert wait_job(project["id"], run["job"]["id"])["state"] == "succeeded"
    got = client.get(f"{BASE}/{project['id']}/query-runs/{run['run_id']}").json()
    assert got["class_map"] == ids
    assert got["source_id"] == source_id
    assert got["counts"] == {ids["car"]: 2, ids["truck"]: 2}  # one of each per photo


def test_unmapped_classes_are_refused_before_any_job(client, app, tmp_path, project_id, images_source):
    m = add_library_model(app, tmp_path, class_names=["excavator", "tower crane", "car"])
    r = _post(client, project_id, source_ids=[images_source], model_id=m.id)
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "unmapped_classes"
    assert err["details"] == {"model_id": m.id, "unmapped": ["tower crane", "car"]}
    assert _jobs(client, project_id) == []
    assert client.get(f"{BASE}/{project_id}/runs").json()["items"] == []


def test_after_mapping_the_same_request_succeeds_and_stores_the_map(
    client, app, tmp_path, project_id, images_source, map_source, wait_job, model_provider
):
    m = add_library_model(app, tmp_path, class_names=["excavator", "tower crane"], train_gsd_cm=3.0)
    ids = _ids(client, project_id)
    body = {"source_ids": [images_source, map_source], "model_id": m.id, "conf": 0.3}
    assert client.post(f"{BASE}/{project_id}/runs", json=body).status_code == 422

    put = client.put(f"{BASE}/{project_id}/model-class-maps/{m.id}", json={"mapping": {"tower crane": None}})
    assert put.status_code == 200, put.text
    r = client.post(f"{BASE}/{project_id}/runs", json=body)

    assert r.status_code == 202, r.text
    runs = {item["kind"]: item for item in r.json()["runs"]}
    assert set(runs) == {"images", "map"}
    for item in runs.values():
        assert wait_job(project_id, item["job"]["id"])["state"] == "succeeded"
    expected_map = {"excavator": ids["excavator"], "tower crane": None}
    snapshot = {
        "id": m.id,
        "name": m.name,
        "task": "detect",
        "format": "pt",
        "class_names": ["excavator", "tower crane"],
        "origin": "imported",
    }
    q = client.get(f"{BASE}/{project_id}/query-runs/{runs['images']['run_id']}").json()
    assert q["class_map"] == expected_map and q["model_snapshot"] == snapshot and q["conf"] == 0.3
    mr = client.get(f"{BASE}/{project_id}/map-runs/{runs['map']['run_id']}").json()
    assert mr["class_map"] == expected_map and mr["model_snapshot"] == snapshot
    assert mr["source_id"] == map_source
    assert mr["target_gsd_cm"] == 3.0  # the model's training GSD by default
    # the provider was handed the run's map as model name -> project class name
    assert all(kw["class_map"] == {"excavator": "excavator"} for kw in model_provider)


def test_an_ignored_class_is_never_written(
    client, app, handle, tmp_path, project_id, images_source, map_source, wait_job, model_provider
):
    m = add_library_model(app, tmp_path, class_names=["excavator", "tower crane"])
    client.put(f"{BASE}/{project_id}/model-class-maps/{m.id}", json={"mapping": {"tower crane": None}})
    r = _post(client, project_id, source_ids=[images_source, map_source], model_id=m.id)
    assert r.status_code == 202, r.text
    for item in r.json()["runs"]:
        assert wait_job(project_id, item["job"]["id"])["state"] == "succeeded"
    excavator = _ids(client, project_id)["excavator"]
    with handle.session() as s:
        box_classes = {b.class_id for b in s.query(Box).all()}
        det_classes = {d.class_id for d in s.query(MapDetection).all()}
        map_run = s.query(MapRun).one()
        assert box_classes == {excavator}
        assert det_classes == {excavator}
        # the job's closing recount fills counts from the rows it wrote
        assert map_run.counts == {excavator: s.query(MapDetection).count()}
        assert map_run.verified_counts == {}


def test_a_cloud_run_skips_mapping(client, app, project_id, images_source, monkeypatch):
    monkeypatch.setattr(
        "app.inference.jobs.get_provider", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x"))
    )
    app.state.keys.set("anthropic", "sk-fake")
    r = _post(client, project_id, source_ids=[images_source], provider="anthropic", query="dump trucks")
    assert r.status_code == 202, r.text
    run_id = r.json()["runs"][0]["run_id"]
    q = client.get(f"{BASE}/{project_id}/query-runs/{run_id}").json()
    assert q["kind"] == "cloud_provider" and q["class_map"] == {} and q["model_snapshot"] == {}


@pytest.mark.parametrize(
    "body",
    [
        {},  # neither a model nor a provider
        {"provider": "anthropic"},  # a provider without a query
    ],
)
def test_a_run_needs_a_model_or_a_provider_with_a_query(client, project_id, images_source, body):
    r = _post(client, project_id, source_ids=[images_source], **body)
    assert r.status_code == 422, r.text
    assert _jobs(client, project_id) == []


def test_an_unknown_source_is_404_and_nothing_is_queued(client, app, tmp_path, project_id, images_source):
    m = add_library_model(app, tmp_path, class_names=["excavator"])
    r = _post(client, project_id, source_ids=[images_source, "nope"], model_id=m.id)
    assert r.status_code == 404, r.text
    assert _jobs(client, project_id) == []


def test_an_unavailable_model_is_409_and_no_library_is_503(client, app, tmp_path, project_id, images_source):
    from app.library import service

    m = add_library_model(app, tmp_path, class_names=["excavator"])
    service.weights_file(app.state.library, m).unlink()
    r = _post(client, project_id, source_ids=[images_source], model_id=m.id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"
    app.state.library = None
    r = _post(client, project_id, source_ids=[images_source], model_id=m.id)
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"
    assert _jobs(client, project_id) == []


# ------------------------------------------------------------------ list, pin, recount


def _query_run(s, source_id, created, **kw) -> QueryRun:
    row = QueryRun(
        kind="local_model",
        model_id="m1",
        model_name="v1",
        source_id=source_id,
        created_at=datetime(2026, 9, created, tzinfo=UTC),
        **kw,
    )
    s.add(row)
    s.flush()
    return row


def _map_run(s, map_id, source_id, created, **kw) -> MapRun:
    row = MapRun(
        map_id=map_id,
        kind="local_model",
        model_id="m1",
        model_name="v1",
        source_id=source_id,
        created_at=datetime(2026, 9, created, tzinfo=UTC),
        **kw,
    )
    s.add(row)
    s.flush()
    return row


def _map_id(handle, source_id) -> str:
    with handle.session() as s:
        return s.query(GeoMap).filter(GeoMap.source_id == source_id).one().id


def test_the_runs_list_is_a_union_newest_first_with_review_progress(
    client, handle, project_id, images_source, map_source
):
    map_id = _map_id(handle, map_source)
    with handle.session() as s:
        image_id = s.query(Image).first().id
        q = _query_run(s, images_source, 1, counts={"c1": 2}, verified_counts={"c1": 1})
        for state in ("accepted", "unreviewed"):
            s.add(
                Box(
                    image_id=image_id,
                    class_id="c1",
                    x=0,
                    y=0,
                    w=1,
                    h=1,
                    provenance_kind="local_model",
                    query_run_id=q.id,
                    review_state=state,
                )
            )
        mr = _map_run(s, map_id, map_source, 3)
        for state in ("accepted", "rejected", "edited", "unreviewed"):
            s.add(
                MapDetection(
                    run_id=mr.id, class_id="c1", confidence=0.9, x=0, y=0, w=1, h=1, review_state=state
                )
            )
        q_id, mr_id = q.id, mr.id

    page = client.get(f"{BASE}/{project_id}/runs").json()

    assert [i["id"] for i in page["items"]] == [mr_id, q_id]
    m, p = page["items"]
    assert (
        m["kind"] == "map"
        and m["source_label"] == "May survey"
        and m["review"] == {"total": 4, "reviewed": 3}
    )
    assert (
        p["kind"] == "images"
        and p["source_label"] == "Flight 1"
        and p["review"] == {"total": 2, "reviewed": 1}
    )
    assert p["counts"] == {"c1": 2} and p["verified_counts"] == {"c1": 1}
    assert p["job_state"] is None and p["pinned"] is False and p["model_name"] == "v1"

    only = client.get(f"{BASE}/{project_id}/runs", params={"source_id": images_source}).json()
    assert [i["id"] for i in only["items"]] == [q_id]


def test_the_runs_list_pages_with_a_cursor(client, handle, project_id, images_source, map_source):
    map_id = _map_id(handle, map_source)
    with handle.session() as s:
        ids = [_query_run(s, images_source, d).id for d in (1, 3, 5)]
        ids += [_map_run(s, map_id, map_source, d).id for d in (2, 4)]
    by_date = {1: ids[0], 3: ids[1], 5: ids[2], 2: ids[3], 4: ids[4]}
    expected = [by_date[d] for d in (5, 4, 3, 2, 1)]

    seen, cursor = [], None
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = client.get(f"{BASE}/{project_id}/runs", params=params).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == expected


def test_pinning_a_run_unpins_the_other_runs_of_its_source(
    client, handle, project_id, images_source, make_jpeg
):
    other_source = _add_images_source(handle, make_jpeg, n=1, label="Flight 2")
    with handle.session() as s:
        a = _query_run(s, images_source, 1).id
        b = _query_run(s, images_source, 2).id
        other = _query_run(s, other_source, 3, pinned=True).id

    r = client.patch(f"{BASE}/{project_id}/runs/{a}", json={"pinned": True})
    assert r.status_code == 200 and r.json()["pinned"] is True
    r = client.patch(f"{BASE}/{project_id}/runs/{b}", json={"pinned": True})
    assert r.status_code == 200, r.text

    pinned = {i["id"]: i["pinned"] for i in client.get(f"{BASE}/{project_id}/runs").json()["items"]}
    assert pinned == {a: False, b: True, other: True}  # another source's pin is untouched

    assert client.patch(f"{BASE}/{project_id}/runs/{b}", json={"pinned": False}).json()["pinned"] is False
    assert client.patch(f"{BASE}/{project_id}/runs/nope", json={"pinned": True}).status_code == 404


def test_pinning_a_map_run_unpins_the_other_runs_of_its_map(client, handle, project_id, map_source):
    map_id = _map_id(handle, map_source)
    with handle.session() as s:
        a = _map_run(s, map_id, map_source, 1, pinned=True).id
        b = _map_run(s, map_id, None, 2).id  # a run made before the map had a source
    assert client.patch(f"{BASE}/{project_id}/runs/{b}", json={"pinned": True}).status_code == 200
    with handle.session() as s:
        assert s.get(MapRun, a).pinned is False and s.get(MapRun, b).pinned is True


def test_recount_rebuilds_a_runs_counts_in_a_job(
    client, handle, project_id, images_source, map_source, wait_job
):
    map_id = _map_id(handle, map_source)
    with handle.session() as s:
        image_id = s.query(Image).first().id
        q = _query_run(s, images_source, 1, counts={"stale": 9})
        s.add(
            Box(
                image_id=image_id,
                class_id="c1",
                x=0,
                y=0,
                w=1,
                h=1,
                provenance_kind="local_model",
                query_run_id=q.id,
                review_state="accepted",
            )
        )
        mr = _map_run(s, map_id, map_source, 2, counts={"stale": 9})
        s.add(
            MapDetection(
                run_id=mr.id, class_id="c2", confidence=0.9, x=0, y=0, w=1, h=1, review_state="edited"
            )
        )
        q_id, mr_id = q.id, mr.id

    for run_id in (q_id, mr_id):
        r = client.post(f"{BASE}/{project_id}/runs/{run_id}/recount")
        assert r.status_code == 202, r.text
        assert r.json()["job"]["type"] == "recount"
        assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    with handle.session() as s:
        assert s.get(QueryRun, q_id).counts == {"c1": 1} and s.get(QueryRun, q_id).verified_counts == {
            "c1": 1
        }
        assert s.get(MapRun, mr_id).counts == {"c2": 1} and s.get(MapRun, mr_id).verified_counts == {"c2": 1}
    assert client.post(f"{BASE}/{project_id}/runs/nope/recount").status_code == 404


# ------------------------------------------------------------------------- timeline


def _tmap(name, captured):
    return GeoMap(
        id=f"m-{name}",
        name=name,
        status="ready",
        source_path="x",
        source_size=1,
        captured_on=captured,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _trun(map_id, created, *, model_id="mod-a", counts=None, verified=None, pinned=False):
    return MapRun(
        id=f"r-{map_id}-{created}",
        map_id=map_id,
        kind="local_model",
        model_id=model_id,
        model_name=model_id,
        conf=0.25,
        counts=counts or {},
        verified_counts=verified or {},
        pinned=pinned,
        created_at=datetime(2026, 2, created, tzinfo=UTC),
    )


def test_the_timeline_prefers_a_pinned_run():
    maps = [_tmap("april", date(2026, 4, 1))]
    older = _trun("m-april", 1, counts={"c1": 5}, pinned=True)
    newer = _trun("m-april", 2, counts={"c1": 7})
    [survey] = build_timeline(maps, {"m-april": [older, newer]}, Basis("mod-a", "mod-a", 0.25))
    assert survey.run_id == older.id and survey.pinned is True and survey.counts == {"c1": 5}
    assert survey.state == "ok"


def test_a_pinned_run_on_another_model_is_shown_but_not_compared():
    maps = [_tmap("april", date(2026, 4, 1))]
    pinned = _trun("m-april", 1, model_id="mod-b", counts={"c1": 5}, pinned=True)
    matching = _trun("m-april", 2, counts={"c1": 7})
    [survey] = build_timeline(maps, {"m-april": [pinned, matching]}, Basis("mod-a", "mod-a", 0.25))
    assert survey.run_id == pinned.id and survey.state == "not_comparable" and survey.reason


def test_verified_only_counts_from_verified_counts():
    maps = [_tmap("april", date(2026, 4, 1)), _tmap("may", date(2026, 5, 1))]
    runs = {
        "m-april": [_trun("m-april", 1, counts={"c1": 5}, verified={"c1": 2})],
        "m-may": [_trun("m-may", 2, counts={"c1": 8}, verified={"c1": 6})],
    }
    april, may = build_timeline(maps, runs, Basis("mod-a", "mod-a", 0.25), verified_only=True)
    assert april.counts == {"c1": 2} and april.verified_counts == {"c1": 2}
    assert may.counts == {"c1": 6} and may.deltas == {"c1": 4}
    total_april, _ = build_timeline(maps, runs, Basis("mod-a", "mod-a", 0.25))
    assert total_april.counts == {"c1": 5} and total_april.verified_counts == {"c1": 2}


def test_the_timeline_api_takes_verified_only(client, handle, project_id):
    with handle.session() as s:
        s.add(_tmap("april", date(2026, 4, 1)))
        s.flush()
        s.add(_trun("m-april", 1, counts={"c1": 5}, verified={"c1": 2}, pinned=True))
    url = f"{BASE}/{project_id}/survey-timeline"
    [total] = client.get(url).json()["surveys"]
    [verified] = client.get(url, params={"verified_only": True}).json()["surveys"]
    assert total["counts"] == {"c1": 5} and total["verified_counts"] == {"c1": 2} and total["pinned"] is True
    assert verified["counts"] == {"c1": 2}


def test_a_failed_submit_leaves_no_run_that_will_never_start(app, handle, make_jpeg, tmp_path):
    """A job-queue failure part-way through keeps the runs already queued and removes the rest,
    so the runs list never shows a 'Not started' row with no job behind it."""
    from types import SimpleNamespace

    from app.detect import runs
    from app.detect.schemas import RunCreate

    first = _add_images_source(handle, make_jpeg, label="A")
    second = _add_images_source(handle, make_jpeg, label="B")
    third = _add_images_source(handle, make_jpeg, label="C")
    app.state.keys.set("anthropic", "sk-fake")
    calls: list[dict] = []

    def submit(job_type, params):
        calls.append(params)
        if len(calls) == 2:
            raise RuntimeError("queue is down")
        return SimpleNamespace(id=f"job-{len(calls)}")

    body = RunCreate(source_ids=[first, second, third], provider="anthropic", query="trucks")
    with pytest.raises(RuntimeError, match="queue is down"):
        runs.create_runs(handle, None, app.state.keys, app.state.provider_config, body, submit)

    with handle.session() as s:
        left = s.query(QueryRun).all()
        assert [(r.source_id, r.job_id) for r in left] == [(first, "job-1")]
