"""Adopting a training project's old models into the library (spec 2026-09-23 section 6, unit BM)."""

import json
import sqlite3
import time
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from conftest import COLOURS, EIGHT_CLASSES
from library_helpers import stub_checkpoint
from sqlalchemy import func, select

from app.db.models import (
    Box,
    Dataset,
    GeoMap,
    Image,
    Job,
    MapRun,
    Model,
    ModelAdoption,
    QueryRun,
    Source,
)
from app.db.session import MIGRATIONS
from app.library import adoption
from app.library.db import LibraryModel
from app.projects.service import DEFAULT_IMPORT_SETTINGS, SUBDIRS, normalise_classes

BASE = "/api/v1/projects"
WEIGHTS = b"old project weights, identical bytes in every project"
METRICS = {"map50": 0.7, "map50_95": 0.5, "precision": 0.8, "recall": 0.6}


def _library_count(app) -> int:
    with app.state.library.session() as s:
        return s.execute(select(func.count()).select_from(LibraryModel)).scalar_one()


def _new_project(client, folder: Path, kind: str = "train") -> str:
    classes = [{"name": n, "colour": c} for n, c in zip(EIGHT_CLASSES[:2], COLOURS[:2], strict=True)]
    r = client.post(
        BASE, json={"name": f"P {folder.name}", "folder": str(folder), "classes": classes, "kind": kind}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _old_model(handle, name: str, rel: str, content: bytes | None, **kw) -> str:
    """An old per-project `model` row; its weights file is written only when `content` is given."""
    if content is not None:
        path = handle.folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    with handle.session() as s:
        row = Model(
            name=name,
            kind=kw.pop("kind", "trained"),
            weights_path=rel,
            class_names=kw.pop("class_names", ["excavator", "dump_truck"]),
            **kw,
        )
        s.add(row)
        s.flush()
        return row.id


def _references(handle, model_id: str) -> dict[str, str]:
    """A pre-annotation choice, a query run, a map run and a box, all pointing at `model_id`."""
    with handle.session() as s:
        handle.row(s).preannotation_model_id = model_id
        src = Source(folder="C:/photos", site="site")
        s.add(src)
        s.flush()
        img = Image(path="images/a.jpg", width=10, height=10, source_id=src.id)
        gmap = GeoMap(name="m", source_path="C:/maps/m.tif", source_size=1)
        qr = QueryRun(kind="local_model", model_id=model_id)
        s.add_all([img, gmap, qr])
        s.flush()
        mr = MapRun(map_id=gmap.id, kind="local_model", model_id=model_id)
        box = Box(
            image_id=img.id,
            class_id="c",
            x=0,
            y=0,
            w=1,
            h=1,
            provenance_kind="local_model",
            model_id=model_id,
        )
        s.add_all([mr, box])
        s.flush()
        return {"query_run": qr.id, "map_run": mr.id, "box": box.id}


def _ids_now(handle, refs: dict[str, str]) -> dict[str, str | None]:
    with handle.session() as s:
        return {
            "preannotation": handle.row(s).preannotation_model_id,
            "query_run": s.get(QueryRun, refs["query_run"]).model_id,
            "map_run": s.get(MapRun, refs["map_run"]).model_id,
            "box": s.get(Box, refs["box"]).model_id,
        }


def _adoptions(handle) -> dict[str, ModelAdoption]:
    with handle.session() as s:
        rows = list(s.execute(select(ModelAdoption)).scalars())
        for r in rows:
            s.expunge(r)
    return {r.old_model_id: r for r in rows}


def _run(app, handle, wait_job) -> dict:
    job = app.state.jobs.submit(handle, adoption.ADOPT_JOB, {})
    done = wait_job(handle.id, job.id)
    assert done["state"] == "succeeded", done
    return done


# --- the job ---------------------------------------------------------------------------------------


def test_adoption_copies_models_rewrites_ids_and_is_safe_to_rerun(app, client, handle, wait_job):
    with handle.session() as s:
        s.add(Dataset(id="ds1", name="Spring set", split_method="random", path="datasets/spring"))
    (handle.folder / "runs" / "r1").mkdir(parents=True)
    (handle.folder / "runs" / "r1" / "results.csv").write_text("epoch\n1\n")
    good = _old_model(
        handle,
        "Spring model",
        "models/spring-1234.pt",
        WEIGHTS,
        dataset_id="ds1",
        run_id="r1",
        base_weights="models/yolo11n.pt",
        metrics=METRICS,
        hyperparameters={"epochs": 5},
        class_aliases={"truck": "dump_truck"},
        artifacts={"results_csv": "runs/r1/results.csv", "pr_curve": "runs/r1/gone.png"},
    )
    gone = _old_model(handle, "Lost model", "models/lost.pt", None, kind="imported")
    refs = _references(handle, good)

    result = _run(app, handle, wait_job)["result"]
    assert result == {"adopted": 1, "missing": 1, "failed": 0}

    rows = _adoptions(handle)
    assert rows[good].status == "adopted" and rows[good].library_model_id
    assert rows[gone].status == "missing"
    assert rows[gone].error == "weights file not found: models/lost.pt"
    new_id = rows[good].library_model_id
    assert _ids_now(handle, refs) == dict.fromkeys(("preannotation", "query_run", "map_run", "box"), new_id)

    model = client.get(f"/api/v1/library/models/{new_id}").json()
    assert model["name"] == "Spring model"
    assert model["origin"] == "trained"
    assert model["class_names"] == ["excavator", "dump_truck"]
    assert model["class_aliases"] == {"truck": "dump_truck"}
    assert model["metrics"]["map50"] == 0.7
    assert set(model["artifacts"]) == {"results_csv"}  # the missing curve is not carried over
    prov = model["provenance"]
    assert prov["project_id"] == handle.id and prov["project_folder"] == str(handle.folder)
    assert prov["dataset_id"] == "ds1" and prov["dataset_name"] == "Spring set"
    assert prov["run_id"] == "r1"
    # the project's own models folder is never touched
    assert (handle.folder / "models" / "spring-1234.pt").read_bytes() == WEIGHTS

    again = _run(app, handle, wait_job)["result"]
    assert again == {"adopted": 0, "missing": 0, "failed": 0}
    assert _library_count(app) == 1
    assert _ids_now(handle, refs)["box"] == new_id


def test_imported_old_model_becomes_an_imported_library_model(app, client, handle, wait_job):
    old = _old_model(handle, "Bought", "models/bought.pt", b"bought weights", kind="imported")
    _run(app, handle, wait_job)
    new_id = _adoptions(handle)[old].library_model_id
    assert client.get(f"/api/v1/library/models/{new_id}").json()["origin"] == "imported"


def test_empty_class_list_is_read_from_the_checkpoint(app, client, handle, wait_job, monkeypatch):
    stub_checkpoint(monkeypatch, task="obb", names=["crane"])
    old = _old_model(handle, "No names", "models/nn.pt", b"weights without names", class_names=[])
    _run(app, handle, wait_job)
    model = client.get(f"/api/v1/library/models/{_adoptions(handle)[old].library_model_id}").json()
    assert model["class_names"] == ["crane"] and model["task"] == "obb"


def test_a_model_that_fails_is_recorded_and_the_rest_carry_on(app, handle, wait_job, monkeypatch):
    def broken(path):
        raise RuntimeError("not a checkpoint")

    monkeypatch.setattr("app.library.service.read_checkpoint", broken)
    bad = _old_model(handle, "Broken", "models/broken.pt", b"broken", class_names=[])
    ok = _old_model(handle, "Fine", "models/fine.pt", b"fine weights")
    assert _run(app, handle, wait_job)["result"] == {"adopted": 1, "missing": 0, "failed": 1}
    rows = _adoptions(handle)
    assert rows[bad].status == "failed" and "not a checkpoint" in rows[bad].error
    assert rows[ok].status == "adopted"


def test_the_same_weights_in_two_projects_share_one_library_model(app, client, tmp_path, wait_job):
    handles = []
    for name in ("one", "two"):
        h = app.state.projects.get(_new_project(client, tmp_path / name))
        _old_model(h, f"model {name}", f"models/{name}.pt", WEIGHTS)
        _run(app, h, wait_job)
        handles.append(h)
    ids = {next(iter(_adoptions(h).values())).library_model_id for h in handles}
    assert len(ids) == 1
    assert _library_count(app) == 1


def test_without_a_library_the_job_fails_readably(app, handle, wait_job):
    _old_model(handle, "M", "models/m.pt", b"m")
    app.state.jobs.library = None
    job = app.state.jobs.submit(handle, adoption.ADOPT_JOB, {})
    done = wait_job(handle.id, job.id)
    assert done["state"] == "failed" and done["error"] == "The model library could not be opened."


# --- submitting on open ------------------------------------------------------------------------------


def _adopt_jobs(handle) -> list[Job]:
    with handle.session() as s:
        return list(s.execute(select(Job).where(Job.type == adoption.ADOPT_JOB)).scalars())


def test_submit_if_pending_submits_for_a_train_project_with_old_models(app, handle, wait_job):
    assert adoption.submit_if_pending(handle, app.state.jobs) is None  # nothing to adopt yet
    _old_model(handle, "M", "models/m.pt", b"m")
    job = adoption.submit_if_pending(handle, app.state.jobs)
    assert job is not None and job.type == adoption.ADOPT_JOB
    assert adoption.submit_if_pending(handle, app.state.jobs) is None  # one is already queued/running
    wait_job(handle.id, job.id)
    assert adoption.submit_if_pending(handle, app.state.jobs) is None  # all adopted


def test_submit_if_pending_does_nothing_for_a_detect_project(app, client, tmp_path):
    h = app.state.projects.get(_new_project(client, tmp_path / "d", kind="detect"))
    _old_model(h, "M", "models/m.pt", b"m")
    assert adoption.submit_if_pending(h, app.state.jobs) is None
    assert _adopt_jobs(h) == []


def test_submit_if_pending_does_nothing_without_a_library(app, handle):
    _old_model(handle, "M", "models/m.pt", b"m")
    app.state.jobs.library = None
    assert adoption.submit_if_pending(handle, app.state.jobs) is None
    assert _adopt_jobs(handle) == []


def test_opening_a_project_with_old_models_starts_adoption(app, client, handle, wait_job):
    old = _old_model(handle, "M", "models/m.pt", b"opened weights")
    registry = app.state.projects
    registry._handles.pop(handle.id)
    handle.engine.dispose()
    reopened = registry.open(handle.folder)
    deadline = time.time() + 30
    while time.time() < deadline and _adoptions(reopened).get(old) is None:
        time.sleep(0.05)
    assert _adoptions(reopened)[old].status == "adopted"


# --- routes -------------------------------------------------------------------------------------------


def test_adoption_status_and_retry(app, client, handle, project_id, wait_job):
    url = f"{BASE}/{project_id}/adoption"
    assert client.get(url).json() == {"pending": 0, "adopted": 0, "missing": [], "job_id": None}
    _old_model(handle, "Good", "models/good.pt", b"good")
    lost = _old_model(handle, "Lost", "models/lost.pt", None)
    assert client.get(url).json()["pending"] == 2

    _run(app, handle, wait_job)
    status = client.get(url).json()
    assert status["pending"] == 0 and status["adopted"] == 1 and status["job_id"] is None
    assert status["missing"] == [
        {"old_model_id": lost, "name": "Lost", "error": "weights file not found: models/lost.pt"}
    ]

    (handle.folder / "models" / "lost.pt").write_bytes(b"found again")
    r = client.post(f"{url}/retry")
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == adoption.ADOPT_JOB
    assert wait_job(project_id, job["id"])["state"] == "succeeded"
    assert client.get(url).json() == {"pending": 0, "adopted": 2, "missing": [], "job_id": None}


def test_retry_while_an_adoption_job_runs_is_409(client, handle, project_id):
    with handle.session() as s:
        s.add(Job(type=adoption.ADOPT_JOB, state="running"))
    url = f"{BASE}/{project_id}/adoption"
    assert client.get(url).json()["job_id"] is not None
    r = client.post(f"{url}/retry")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


@pytest.mark.parametrize("method, path", [("get", "/adoption"), ("post", "/adoption/retry")])
def test_adoption_routes_are_training_only(client, tmp_path, method, path):
    pid = _new_project(client, tmp_path / "d", kind="detect")
    r = getattr(client, method)(f"{BASE}/{pid}{path}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"


def test_retry_without_a_library_is_503(app, client, project_id):
    app.state.library = None
    r = client.post(f"{BASE}/{project_id}/adoption/retry")
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


# --- a real project copy, from before the library ------------------------------------------------


def _project_at_0005(folder: Path, weights: bytes) -> dict[str, str]:
    """A project folder as the app left it before the library: schema 0005, an old `model` row with
    its weights file under `models/`, and a detection run made with that model."""
    for sub in SUBDIRS:
        (folder / sub).mkdir(parents=True, exist_ok=True)
    db = folder / "project.db"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db.as_posix()}")
    command.upgrade(cfg, "0005")

    rel = "models/ahmadia-v1/weights/best.pt"
    (folder / rel).parent.mkdir(parents=True, exist_ok=True)
    (folder / rel).write_bytes(weights)
    pairs = zip(EIGHT_CLASSES[:2], COLOURS[:2], strict=True)
    classes = normalise_classes([{"name": n, "colour": c} for n, c in pairs])
    ids = {"project": "p0000000-0005-4000-8000-000000000001", "model": "m0000000-0005-4000-8000-000000000001"}
    ids["run"] = "q0000000-0005-4000-8000-000000000001"
    now = "2026-09-01 10:00:00"
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO project (id, name, classes, schema_version, preannotation_model_id, "
            "import_defaults, created_at) VALUES (?, 'Old Ahmadia', ?, 1, ?, ?, ?)",
            (ids["project"], json.dumps(classes), ids["model"], json.dumps(DEFAULT_IMPORT_SETTINGS), now),
        )
        conn.execute(
            "INSERT INTO model (id, name, kind, weights_path, base_weights, dataset_id, hyperparameters, "
            "metrics, class_names, class_aliases, exports, artifacts, run_id, created_at) VALUES "
            "(?, 'ahmadia-v1', 'trained', ?, NULL, NULL, '{}', ?, ?, '{}', '{}', '{}', NULL, ?)",
            (ids["model"], rel, json.dumps(METRICS), json.dumps(EIGHT_CLASSES[:2]), now),
        )
        conn.execute(
            "INSERT INTO query_run (id, kind, model_id, provider, model_name, query, image_ids, tiling, "
            "conf, job_id, promoted_at, created_at) VALUES "
            "(?, 'local_model', ?, NULL, NULL, '', '[]', '{}', 0.25, NULL, NULL, ?)",
            (ids["run"], ids["model"], now),
        )
        conn.commit()
    finally:
        conn.close()
    return ids


def test_real_project_copy(app, client, tmp_path, wait_job, monkeypatch):
    """Opening a pre-library project through the API migrates it, adopts its model into the library
    and points its old detection run at the library model; the old weights stay where they were."""
    stub_checkpoint(monkeypatch)
    folder = tmp_path / "Old Ahmadia"
    weights = b"weights trained before the library existed"
    ids = _project_at_0005(folder, weights)

    r = client.post(f"{BASE}/open", json={"folder": str(folder)})
    assert r.status_code == 200, r.text
    project = r.json()
    assert project["id"] == ids["project"] and project["kind"] == "train"

    jobs = client.get(f"{BASE}/{ids['project']}/jobs").json()["items"]
    adopt = [j for j in jobs if j["type"] == adoption.ADOPT_JOB]
    assert len(adopt) == 1, jobs
    assert wait_job(ids["project"], adopt[0]["id"])["state"] == "succeeded"

    models = client.get("/api/v1/library/models").json()["items"]
    [adopted] = [m for m in models if m["name"] == "ahmadia-v1"]
    assert adopted["origin"] == "trained"
    assert adopted["class_names"] == EIGHT_CLASSES[:2]
    assert adopted["provenance"]["project_id"] == ids["project"]
    assert adopted["provenance"]["project_name"] == "Old Ahmadia"

    runs = client.get(f"{BASE}/{ids['project']}/query-runs").json()["items"]
    assert [(q["id"], q["model_id"]) for q in runs] == [(ids["run"], adopted["id"])]
    assert client.get(f"{BASE}/{ids['project']}").json()["preannotation_model_id"] == adopted["id"]
    assert client.get(f"{BASE}/{ids['project']}/adoption").json() == {
        "pending": 0,
        "adopted": 1,
        "missing": [],
        "job_id": None,
    }
    # Nothing from the old models folder is ever deleted.
    assert (folder / "models/ahmadia-v1/weights/best.pt").read_bytes() == weights
