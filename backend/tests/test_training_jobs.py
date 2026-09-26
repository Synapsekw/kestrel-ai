"""The `train` job in the library (foundation F §12.2 step 4; plan BM Task 10, decisions 5, 9, 10 and
13; Review Focus 2 and 3), end to end with the in-process FakeTrainer (no GPU, no ultralytics)."""

import time
from pathlib import Path

import pytest
from catalogue_fake import catalogue  # noqa: F401 - fixture
from fakes import FakeTrainer
from library_datasets_helpers import (
    LIB,
    build_dataset,
    create_body,
    legacy_project_dataset,
    make_project,
    two_projects,
)
from library_helpers import add_library_model, jobs_finish_before_submit_returns, wait_library_job

from app.db.models import Job
from app.jobs.startup import sweep_orphans
from app.library import service
from app.library.datasets.legacy import register_legacy_dataset
from app.library.db import LibraryDataset, TrainingRun

RUNS = f"{LIB}/training-runs"


@pytest.fixture
def base_model(app, tmp_path):
    return add_library_model(app, tmp_path, name="yolo11n", origin="starter")


@pytest.fixture
def use_fake_trainer(monkeypatch):
    def install(**kwargs) -> FakeTrainer:
        trainer = FakeTrainer(**kwargs)
        monkeypatch.setattr("app.training.jobs.get_trainer", lambda: trainer)
        return trainer

    return install


@pytest.fixture
def built(client, app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    a, b, exc, truck = two_projects(app, tmp_path, make_jpeg, catalogue)
    return build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))


@pytest.fixture
def legacy(app, tmp_path, make_jpeg) -> str:
    handle = make_project(app, tmp_path / "old", "Ahmadia")
    return register_legacy_dataset(app.state.library, handle, legacy_project_dataset(handle, make_jpeg))


def train_body(dataset_id: str, base_model_id: str, **over) -> dict:
    return {
        "name": "ahmadia v1 n",
        "dataset_id": dataset_id,
        "base_model_id": base_model_id,
        "epochs": 3,
        "imgsz": 640,
        "augmentation": "aerial",
        "device": "cpu",
        **over,
    }


def start(client, dataset_id: str, base_model_id: str, **over) -> dict:
    r = client.post(RUNS, json=train_body(dataset_id, base_model_id, **over))
    assert r.status_code == 202, r.text
    assert r.json()["job"]["type"] == "train" and r.json()["job"]["project_id"] == "library"
    return r.json()


def test_training_a_built_dataset_exports_it_first_and_registers_the_model(
    client, app, built, base_model, use_fake_trainer
):
    use_fake_trainer(map50=0.61)
    started = start(client, built["id"], base_model.id)
    assert started["training_run"]["state"] == "queued"
    done = wait_library_job(client, started["job"]["id"])
    assert done["state"] == "succeeded", done["error"]

    assert client.get(f"{LIB}/datasets/{built['id']}").json()["export_state"] == "ready"
    run = client.get(f"{RUNS}/{started['training_run']['id']}").json()
    assert run["state"] == "succeeded" and run["model_id"] == done["result"]["model_id"]
    assert run["metrics"]["map50"] == 0.61 and run["finished_at"] is not None
    model = client.get(f"{LIB}/models/{run['model_id']}").json()
    assert model["origin"] == "trained" and model["task"] == "detect"
    assert model["class_names"] == ["Excavator", "Dump truck"]
    exc, truck = (c["type_id"] for c in built["classes"])
    assert model["class_map"] == {"Excavator": exc, "Dump truck": truck}  # pre-filled (F §12.2)
    p = model["provenance"]
    assert p["dataset_id"] == built["id"] and p["run_id"] == started["job"]["id"]
    assert p["base_model_id"] == base_model.id and "project_id" not in p  # two projects: none named
    assert (app.state.library.runs_dir / started["job"]["id"] / "train" / "results.csv").is_file()


def test_the_start_answer_is_the_run_as_queued_even_when_training_is_quicker(
    client, app, built, base_model, use_fake_trainer, monkeypatch
):
    """The 202 says `queued` (the contract's "run created, training job queued"), never a race with
    the job: here training has finished before the route answers."""
    use_fake_trainer()
    jobs_finish_before_submit_returns(app, monkeypatch)
    started = start(client, built["id"], base_model.id)
    assert started["job"]["state"] == "queued"
    assert started["training_run"]["state"] == "queued"
    assert started["training_run"]["job_id"] == started["job"]["id"]
    assert started["training_run"]["model_id"] is None and started["training_run"]["finished_at"] is None
    assert client.get(f"{RUNS}/{started['training_run']['id']}").json()["state"] == "succeeded"


def test_training_a_legacy_dataset_reads_its_own_folder(client, app, legacy, base_model, use_fake_trainer):
    use_fake_trainer()
    started = start(client, legacy, base_model.id)
    done = wait_library_job(client, started["job"]["id"])
    assert done["state"] == "succeeded", done["error"]
    log = client.get(f"{LIB}/jobs/{started['job']['id']}/log").json()["lines"]
    with app.state.library.session() as s:
        legacy_path = s.get(LibraryDataset, legacy).legacy_path
    assert any(legacy_path in line for line in log)
    assert list(app.state.library.datasets_dir.iterdir()) == []  # nothing exported for a legacy set
    p = client.get(f"{LIB}/models/{done['result']['model_id']}").json()["provenance"]
    assert p["project_name"] == "Ahmadia" and p["dataset_id"] == legacy


def test_training_publishes_epoch_progress(client, built, base_model, use_fake_trainer):
    use_fake_trainer()
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = start(client, built["id"], base_model.id)["job"]
        messages: list[str] = []
        for _ in range(200):
            ev = ws.receive_json()
            if ev["job_id"] != job["id"]:
                continue
            if ev["type"] == "job.progress":
                messages.append(ev["message"])
            if ev["type"] == "job.state" and ev["payload"]["state"] in ("succeeded", "failed"):
                assert ev["payload"]["state"] == "succeeded"
                break
    assert [m for m in messages if m.startswith("epoch")] == [
        "epoch 1/3 mAP50 0.500",
        "epoch 2/3 mAP50 0.500",
        "epoch 3/3 mAP50 0.500",
    ]


def test_cancelling_training_leaves_no_model_and_the_run_cancelled(
    client, legacy, base_model, use_fake_trainer
):
    use_fake_trainer(epoch_sleep_s=0.3)
    started = start(client, legacy, base_model.id, epochs=50)
    job_id = started["job"]["id"]
    deadline = time.time() + 20
    while client.get(f"{LIB}/jobs/{job_id}").json()["progress"] == 0 and time.time() < deadline:
        time.sleep(0.02)
    assert client.post(f"{LIB}/jobs/{job_id}/cancel").status_code == 200
    assert wait_library_job(client, job_id)["state"] == "cancelled"
    assert client.get(f"{RUNS}/{started['training_run']['id']}").json()["state"] == "cancelled"
    assert [m["origin"] for m in client.get(f"{LIB}/models").json()["items"]] == ["starter"]


def test_a_failing_trainer_fails_the_job_and_the_run(client, legacy, base_model, use_fake_trainer):
    use_fake_trainer(fail=True)
    started = start(client, legacy, base_model.id)
    done = wait_library_job(client, started["job"]["id"])
    assert done["state"] == "failed" and "fake trainer failure" in done["error"]
    assert client.get(f"{RUNS}/{started['training_run']['id']}").json()["state"] == "failed"


def test_refusals_come_before_any_job(client, app, tmp_path, built, legacy, base_model):
    assert client.post(RUNS, json=train_body(built["id"], "nope")).status_code == 404
    assert client.post(RUNS, json=train_body("nope", base_model.id)).status_code == 404
    assert client.post(RUNS, json=train_body(built["id"], base_model.id, epochs=0)).status_code == 422
    gone = add_library_model(app, tmp_path, name="gone")
    service.weights_file(app.state.library, gone).unlink()
    r = client.post(RUNS, json=train_body(built["id"], gone.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"
    assert client.get(f"{LIB}/jobs", params={"type": "train"}).json()["items"] == []
    app.state.library = None
    r = client.post(RUNS, json=train_body(built["id"], base_model.id))
    assert r.status_code == 503 and r.json()["error"]["code"] == "library_unavailable"


def test_a_detect_base_on_an_obb_dataset_is_refused(client, app, tmp_path, make_jpeg, catalogue, base_model):  # noqa: F811
    a, b, exc, truck = two_projects(app, tmp_path, make_jpeg, catalogue)
    oriented = build_dataset(client, create_body("oriented", [b.id], [truck.id], task="obb"))
    r = client.post(RUNS, json=train_body(oriented["id"], base_model.id))
    assert r.status_code == 422 and r.json()["error"]["code"] == "task_mismatch"
    assert r.json()["error"]["details"] == {"base_task": "detect", "dataset_task": "obb"}
    assert client.get(f"{LIB}/jobs", params={"type": "train"}).json()["items"] == []


def test_a_segment_dataset_cannot_train_yet(client, app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    a, _, exc, _ = two_projects(app, tmp_path, make_jpeg, catalogue)
    masks = build_dataset(client, create_body("masks", [a.id], [exc.id], task="segment"))
    seg_base = add_library_model(app, tmp_path, name="yolo11n-seg", task="segment", origin="starter")
    r = client.post(RUNS, json=train_body(masks["id"], seg_base.id))
    assert r.status_code == 422 and r.json()["error"]["code"] == "task_not_supported"


def test_a_legacy_dataset_whose_yaml_drifted_is_refused(client, app, legacy, base_model):
    with app.state.library.session() as s:
        path = Path(s.get(LibraryDataset, legacy).legacy_path) / "data.yaml"
    path.write_text(path.read_text("utf-8").replace("excavator", "digger"), "utf-8")
    r = client.post(RUNS, json=train_body(legacy, base_model.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert "digger" in r.json()["error"]["message"] and "excavator" in r.json()["error"]["message"]


def test_a_dataset_still_being_built_is_409(client, app, base_model):
    lib = app.state.library
    with lib.session() as s:
        job = Job(type="dataset_build", state="running", params={}, log_path="")
        s.add(job)
        s.flush()
        row = LibraryDataset(name="busy", classes=[], split_method="random", state="resolving", job_id=job.id)
        s.add(row)
        s.flush()
        dataset_id = row.id
    r = client.post(RUNS, json=train_body(dataset_id, base_model.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_a_legacy_dataset_whose_yaml_is_gone_is_not_ready(client, app, legacy, base_model):
    with app.state.library.session() as s:
        (Path(s.get(LibraryDataset, legacy).legacy_path) / "data.yaml").unlink()
    r = client.post(RUNS, json=train_body(legacy, base_model.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_a_dataset_whose_export_is_being_written_is_409(client, app, base_model):
    lib = app.state.library
    with lib.session() as s:
        job = Job(type="dataset", state="running", params={}, log_path="")
        s.add(job)
        s.flush()
        row = LibraryDataset(
            name="exporting",
            classes=[],
            split_method="random",
            state="ready",
            export_state="building",
            export_job_id=job.id,
        )
        s.add(row)
        s.flush()
        dataset_id = row.id
    r = client.post(RUNS, json=train_body(dataset_id, base_model.id))
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert client.get(f"{LIB}/jobs", params={"type": "train"}).json()["items"] == []


def test_a_restart_mid_training_shows_the_run_failed(client, app, legacy, base_model):
    lib = app.state.library
    with lib.session() as s:
        job = Job(type="train", state="running", params={"dataset_id": legacy}, log_path="")
        s.add(job)
        s.flush()
        run = TrainingRun(
            name="x",
            dataset_id=legacy,
            base_model_id=base_model.id,
            params={},
            job_id=job.id,
            state="running",
        )
        s.add(run)
        s.flush()
        run_id = run.id
    sweep_orphans(lib, app.state.jobs)
    assert client.get(f"{RUNS}/{run_id}").json()["state"] == "failed"


def test_runs_list_newest_first(client, legacy, base_model, use_fake_trainer):
    use_fake_trainer()
    first = start(client, legacy, base_model.id, name="first")
    wait_library_job(client, first["job"]["id"])
    second = start(client, legacy, base_model.id, name="second")
    wait_library_job(client, second["job"]["id"])
    page = client.get(RUNS, params={"limit": 1}).json()
    assert [r["name"] for r in page["items"]] == ["second"] and page["next_cursor"]
    rest = client.get(RUNS, params={"limit": 1, "cursor": page["next_cursor"]}).json()
    assert [r["name"] for r in rest["items"]] == ["first"]


def test_runs_filter_by_dataset(client, app, tmp_path, make_jpeg, legacy, base_model, use_fake_trainer):
    use_fake_trainer()
    other_project = make_project(app, tmp_path / "other", "Other")
    other = register_legacy_dataset(
        app.state.library, other_project, legacy_project_dataset(other_project, make_jpeg)
    )
    for dataset_id, name in ((legacy, "on legacy"), (other, "on other")):
        wait_library_job(client, start(client, dataset_id, base_model.id, name=name)["job"]["id"])
    items = client.get(RUNS, params={"dataset_id": other}).json()["items"]
    assert [r["name"] for r in items] == ["on other"]


def test_runs_filter_by_the_state_they_read(client, app, legacy, base_model, use_fake_trainer):
    """`state` filters on the effective state: a run a restart interrupted is found as `failed`."""
    use_fake_trainer()
    done = start(client, legacy, base_model.id, name="done")
    wait_library_job(client, done["job"]["id"])
    lib = app.state.library
    with lib.session() as s:
        job = Job(type="train", state="failed", params={"dataset_id": legacy}, log_path="")
        s.add(job)
        s.flush()
        s.add(
            TrainingRun(
                name="interrupted",
                dataset_id=legacy,
                base_model_id=base_model.id,
                params={},
                job_id=job.id,
                state="running",
            )
        )

    def names(state: str) -> list[str]:
        return [r["name"] for r in client.get(RUNS, params={"state": state}).json()["items"]]

    assert names("failed") == ["interrupted"]
    assert names("succeeded") == ["done"]
    assert names("running") == []


def test_the_per_project_train_route_is_gone(client, app, tmp_path):
    handle = make_project(app, tmp_path / "p", "P")
    assert client.post(f"/api/v1/projects/{handle.id}/train", json={}).status_code in (404, 405)


def test_a_run_whose_weights_are_already_in_the_library_returns_that_model(
    client, legacy, base_model, use_fake_trainer
):
    use_fake_trainer()  # writes the same bytes every run: the second run's weights are a sha hit
    results = []
    for name in ("first", "second"):
        done = wait_library_job(client, start(client, legacy, base_model.id, name=name)["job"]["id"])
        assert done["state"] == "succeeded", done["error"]
        results.append(done["result"])
    assert results[1]["model_id"] == results[0]["model_id"]
    trained = [m for m in client.get(f"{LIB}/models").json()["items"] if m["origin"] == "trained"]
    assert [m["name"] for m in trained] == ["first"]


# ------------------------------------------------ one export at a time (review fix round 1)


def test_an_export_is_refused_while_a_train_job_names_the_dataset(client, app, built):
    """A new export would replace the folder the training reads: 409 `job_running`, no job queued."""
    with app.state.library.session() as s:
        job = Job(type="train", state="queued", params={"dataset_id": built["id"]}, log_path="")
        s.add(job)
        s.flush()
        job_id = job.id
    for state in ("queued", "running"):
        with app.state.library.session() as s:
            s.get(Job, job_id).state = state
        r = client.post(f"{LIB}/datasets/{built['id']}/export")
        assert r.status_code == 409 and r.json()["error"]["code"] == "job_running", r.text
    assert client.get(f"{LIB}/jobs", params={"type": "dataset"}).json()["items"] == []


def test_a_train_does_not_start_a_second_export_while_another_job_writes_it(
    client, app, built, base_model, monkeypatch
):
    """The export began after the run was accepted: the job fails clearly instead of racing it."""
    from app.library.datasets import service as datasets

    lib = app.state.library
    with lib.session() as s:
        other = Job(type="dataset", state="running", params={"dataset_id": built["id"]}, log_path="")
        s.add(other)
        s.flush()
        other_id = other.id
        run = TrainingRun(
            name="late", dataset_id=built["id"], base_model_id=base_model.id, params={}, state="queued"
        )
        s.add(run)
        s.flush()
        run_id = run.id
    datasets.mark_export_queued(lib, built["id"], other_id)
    exports: list[str] = []
    monkeypatch.setattr("app.training.jobs.export_dataset", lambda ctx, d, p: exports.append(d))
    params = {**train_body(built["id"], base_model.id, name="late"), "training_run_id": run_id}
    job = app.state.jobs.submit(lib, "train", params)
    done = wait_library_job(client, job.id)
    assert done["state"] == "failed" and "being exported by another job" in done["error"]
    assert exports == []
    with lib.session() as s:
        assert s.get(LibraryDataset, built["id"]).export_job_id == other_id
    assert client.get(f"{RUNS}/{run_id}").json()["state"] == "failed"


def test_a_failing_chained_export_fails_the_run_and_leaves_no_export_building(
    client, built, base_model, use_fake_trainer, monkeypatch
):
    use_fake_trainer()

    def boom(*a, **k):
        raise RuntimeError("disk gone")

    monkeypatch.setattr("app.library.datasets.export._place", boom)
    started = start(client, built["id"], base_model.id)
    done = wait_library_job(client, started["job"]["id"])
    assert done["state"] == "failed" and "disk gone" in done["error"]
    assert client.get(f"{RUNS}/{started['training_run']['id']}").json()["state"] == "failed"
    assert client.get(f"{LIB}/datasets/{built['id']}").json()["export_state"] == "failed"
