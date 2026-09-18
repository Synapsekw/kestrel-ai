"""Model registry: import, list, get, delete and registering a finished training run (spec section 7).

The import tests load the real `yolo11n.pt` on the CPU to read its class names; that is the one
place the backend touches torch outside the worker subprocess.
"""

from pathlib import Path

import pytest
from sqlalchemy import select

from app.db.models import Dataset, Model
from app.training.presets import TrainParams
from app.training.registry import register_trained, slug
from app.training.trainer import TrainResult

YOLO11N = Path("E:/Dev/Yolo/models/yolo11n.pt")
BASE = "/api/v1/projects"


def models_url(project_id: str) -> str:
    return f"{BASE}/{project_id}/models"


@pytest.fixture
def fake_weights(tmp_path, monkeypatch) -> Path:
    """A stand-in weights file; reading class names is stubbed so these tests never load torch."""
    monkeypatch.setattr("app.training.registry.read_class_names", lambda path: ["excavator", "dump_truck"])
    p = tmp_path / "fake.pt"
    p.write_bytes(b"not a checkpoint")
    return p


@pytest.fixture
def imported(client, project_id):
    body = {"name": "yolo11n coco", "weights_path": str(YOLO11N), "class_aliases": {"truck": "dump_truck"}}
    r = client.post(f"{models_url(project_id)}/import", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_import_copies_the_weights_and_reads_the_class_names(imported, handle):
    assert imported["kind"] == "imported"
    assert imported["name"] == "yolo11n coco"
    assert imported["class_aliases"] == {"truck": "dump_truck"}
    assert imported["class_names"][:3] == ["person", "bicycle", "car"]
    assert len(imported["class_names"]) == 80
    assert imported["metrics"] is None
    assert imported["base_weights"] is None
    assert imported["dataset_id"] is None
    assert imported["run_id"] is None
    assert imported["hyperparameters"] == {}
    assert imported["exports"] == {} and imported["artifacts"] == {}
    assert imported["weights_path"].startswith("models/yolo11n-coco-")
    assert imported["weights_path"].endswith(".pt")
    copied = handle.folder / imported["weights_path"]
    assert copied.exists()
    assert copied.stat().st_size == YOLO11N.stat().st_size
    assert YOLO11N.exists()  # the source is read-only input, never moved


def test_import_twice_with_the_same_name_gives_two_models(client, project_id, imported, handle):
    body = {"name": "yolo11n coco", "weights_path": str(YOLO11N)}
    second = client.post(f"{models_url(project_id)}/import", json=body).json()
    assert second["id"] != imported["id"]
    assert second["weights_path"] != imported["weights_path"]
    assert second["class_aliases"] == {}
    assert len(list((handle.folder / "models").glob("*.pt"))) == 2


@pytest.mark.parametrize(
    "weights_path",
    ["models/yolo11n.pt", str(YOLO11N.parent / "does-not-exist.pt"), str(YOLO11N.parent)],
)
def test_import_rejects_bad_weights_paths(client, project_id, weights_path):
    """A schema-valid path that names no usable file is a missing reference (404), not a 422.

    The contract cannot express "this file exists", and its conformance gate fails any 422 on a
    schema-compliant body; only the empty string is a schema violation (see the test below).
    """
    r = client.post(f"{models_url(project_id)}/import", json={"name": "x", "weights_path": weights_path})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "not_found"


def test_import_rejects_an_empty_weights_path(client, project_id):
    """`minLength: 1` in the contract, so pydantic rejects it before the service sees it."""
    r = client.post(f"{models_url(project_id)}/import", json={"name": "x", "weights_path": ""})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_import_rejects_an_empty_name(client, project_id):
    r = client.post(f"{models_url(project_id)}/import", json={"name": "", "weights_path": str(YOLO11N)})
    assert r.status_code == 422


def test_list_is_newest_first_and_paginates(client, project_id, handle, fake_weights):
    names = [f"m{i}" for i in range(3)]
    for n in names:
        client.post(f"{models_url(project_id)}/import", json={"name": n, "weights_path": str(fake_weights)})
    page = client.get(models_url(project_id), params={"limit": 2}).json()
    assert [m["name"] for m in page["items"]] == ["m2", "m1"]
    assert page["next_cursor"]
    rest = client.get(models_url(project_id), params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert [m["name"] for m in rest["items"]] == ["m0"]
    assert rest["next_cursor"] is None


def test_get_returns_the_model_and_404s_on_an_unknown_id(client, project_id, imported):
    got = client.get(f"{models_url(project_id)}/{imported['id']}")
    assert got.status_code == 200
    assert got.json() == imported
    missing = client.get(f"{models_url(project_id)}/nope")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_delete_removes_the_row_the_weights_and_the_exports(client, project_id, handle, fake_weights):
    body = {"name": "gone", "weights_path": str(fake_weights)}
    model = client.post(f"{models_url(project_id)}/import", json=body).json()
    weights = handle.folder / model["weights_path"]
    export = handle.models_dir / "gone.onnx"
    export.write_bytes(b"x")
    with handle.session() as s:
        row = s.get(Model, model["id"])
        row.exports = {"onnx": "models/gone.onnx", "engine": "models/missing.engine"}

    assert client.delete(f"{models_url(project_id)}/{model['id']}").status_code == 204
    assert not weights.exists()
    assert not export.exists()
    with handle.session() as s:
        assert s.get(Model, model["id"]) is None
    assert client.delete(f"{models_url(project_id)}/{model['id']}").status_code == 404


def test_delete_keeps_box_provenance(client, project_id, handle, fake_weights):
    """Spec section 7 / contract: boxes keep their `model_id` after the model is deleted."""
    from app.db.models import Box, Image, Source

    model = client.post(
        f"{models_url(project_id)}/import", json={"name": "m", "weights_path": str(fake_weights)}
    ).json()
    with handle.session() as s:
        src = Source(folder="f", site="s")
        s.add(src)
        s.flush()
        img = Image(path="images/a.jpg", width=10, height=10, source_id=src.id)
        s.add(img)
        s.flush()
        s.add(
            Box(
                image_id=img.id,
                class_id="c1",
                x=1,
                y=1,
                w=2,
                h=2,
                provenance_kind="local_model",
                model_id=model["id"],
            )
        )
    client.delete(f"{models_url(project_id)}/{model['id']}")
    with handle.session() as s:
        assert s.execute(select(Box)).scalar_one().model_id == model["id"]


def test_slug_makes_a_file_safe_stem():
    assert slug("yolo11n coco") == "yolo11n-coco"
    assert slug("Ahmadia v1 / n") == "ahmadia-v1-n"
    assert slug("   ") == "model"


def test_register_trained_writes_the_registry_row(client, project_id, handle, fake_weights, tmp_path):
    base = client.post(
        f"{models_url(project_id)}/import", json={"name": "base", "weights_path": str(fake_weights)}
    ).json()
    run_dir = handle.runs_dir / "job-1234abcd"
    save_dir = run_dir / "train"
    (save_dir / "weights").mkdir(parents=True)
    (save_dir / "weights" / "best.pt").write_bytes(b"best")
    (save_dir / "results.csv").write_text("epoch\n1\n", encoding="utf-8")
    (save_dir / "confusion_matrix.png").write_bytes(b"\x89PNG")
    params = TrainParams(
        data_yaml=str(handle.datasets_dir / "v1" / "data.yaml"),
        base_weights=str(handle.folder / base["weights_path"]),
        run_dir=str(run_dir),
        epochs=2,
        imgsz=640,
        augmentation="aerial",
    )
    metrics = {"map50": 0.7, "map50_95": 0.4, "precision": 0.8, "recall": 0.6, "per_class": []}
    result = TrainResult.from_save_dir(save_dir / "weights" / "best.pt", save_dir, metrics)

    with handle.session() as s:
        dataset = Dataset(
            name="v1",
            classes=[{"id": "c1", "name": "excavator"}, {"id": "c2", "name": "dump_truck"}],
            split_method="by_group",
            path="datasets/v1",
        )
        s.add(dataset)
        s.flush()
        s.expunge(dataset)
    with handle.session() as s:
        base_row = s.get(Model, base["id"])
        s.expunge(base_row)

    model = register_trained(
        handle,
        name="ahmadia v1 n",
        base_model=base_row,
        dataset=dataset,
        params=params,
        result=result,
        job_id="job-1234abcd",
    )

    assert model.kind == "trained"
    assert model.weights_path == "models/ahmadia-v1-n-job-1234.pt"
    assert (handle.folder / model.weights_path).read_bytes() == b"best"
    assert model.base_weights == base["weights_path"]
    assert model.dataset_id == dataset.id
    assert model.metrics == metrics
    assert model.class_names == ["excavator", "dump_truck"]
    assert model.run_id == "job-1234abcd"
    assert model.hyperparameters == {
        "epochs": 2,
        "imgsz": 640,
        "batch": None,
        "patience": 50,
        "augmentation": "aerial",
        "device": "0",
    }
    assert model.artifacts == {
        "results_csv": "runs/job-1234abcd/train/results.csv",
        "confusion_matrix": "runs/job-1234abcd/train/confusion_matrix.png",
    }
    out = client.get(f"{models_url(project_id)}/{model.id}").json()
    assert out["metrics"]["map50"] == 0.7
    assert out["artifacts"]["results_csv"] == "runs/job-1234abcd/train/results.csv"
    assert (handle.folder / out["artifacts"]["confusion_matrix"]).exists()


def test_import_of_an_unreadable_checkpoint_leaves_nothing_behind(client, project_id, handle, tmp_path):
    """A .pt that torch cannot load is rejected and the half-imported copy is removed."""
    broken = tmp_path / "broken.pt"
    broken.write_bytes(b"not a checkpoint")
    r = client.post(f"{models_url(project_id)}/import", json={"name": "broken", "weights_path": str(broken)})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert list(handle.models_dir.glob("*.pt")) == []


def test_model_artifacts_are_served(client, project, project_id, handle):
    from app.db.models import Model

    run_dir = handle.folder / "runs" / "r1" / "train"
    run_dir.mkdir(parents=True)
    (run_dir / "results.csv").write_text("epoch,time\n1,2\n", encoding="utf-8")
    (run_dir / "confusion_matrix.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    with handle.session() as s:
        m = Model(
            name="m",
            kind="trained",
            weights_path="models/m.pt",
            artifacts={
                "results_csv": "runs/r1/train/results.csv",
                "confusion_matrix": "runs/r1/train/confusion_matrix.png",
            },
        )
        s.add(m)
        s.flush()
        mid = m.id
    base = f"/api/v1/projects/{project_id}/models/{mid}/artifacts"
    r = client.get(f"{base}/results_csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "epoch" in r.text
    r = client.get(f"{base}/confusion_matrix")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get(f"{base}/pr_curve").status_code == 404
    assert client.get(f"{base}/nope").status_code == 422
    assert (
        client.get(
            f"/api/v1/projects/{project_id}/models/00000000-0000-4000-8000-000000000000/artifacts/pr_curve"
        ).status_code
        == 404
    )
