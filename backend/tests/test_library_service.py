"""The app-wide model library: its database, folder layout and service functions (spec section 4)."""

from pathlib import Path

import pytest
from sqlalchemy import inspect

from app.errors import AppError
from app.library import service
from app.library.handle import open_library
from app.library.paths import library_root


@pytest.fixture
def lib(tmp_path):
    return open_library(tmp_path / "appdata")


def weights(tmp_path: Path, content: bytes = b"weights-a", name: str = "src.pt") -> Path:
    p = tmp_path / "src" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return p


def add(lib, tmp_path, content=b"weights-a", name="m", **kw):
    return service.add_model(
        lib,
        source_weights=weights(tmp_path, content, f"{name}.pt"),
        name=name,
        origin=kw.pop("origin", "imported"),
        task="detect",
        class_names=["excavator", "dump_truck"],
        **kw,
    )


def test_library_root_is_beside_the_app_data(tmp_path):
    assert library_root(tmp_path) == tmp_path / "library"


def test_open_library_creates_the_database_and_is_idempotent(tmp_path):
    lib = open_library(tmp_path / "appdata")
    assert lib.id == "library"
    assert lib.folder == tmp_path / "appdata" / "library"
    assert (lib.folder / "library.db").is_file()
    assert lib.runs_dir == lib.folder / "runs" and lib.runs_dir.is_dir()
    assert lib.models_dir == lib.folder / "models" and lib.models_dir.is_dir()
    tables = set(inspect(lib.engine).get_table_names())
    assert {"library_model", "job"} <= tables
    lib.engine.dispose()
    again = open_library(tmp_path / "appdata")
    assert {"library_model", "job"} <= set(inspect(again.engine).get_table_names())


def test_add_model_copies_the_weights_into_its_own_folder(lib, tmp_path):
    row = add(lib, tmp_path, name="Client X v1")
    assert row.weights_path.startswith("models/client-x-v1-")
    assert row.weights_path.endswith("/weights.pt")
    assert "\\" not in row.weights_path
    assert row.weights_path.split("/")[1] == f"client-x-v1-{row.id[:8]}"
    copied = service.weights_file(lib, row)
    assert copied.read_bytes() == b"weights-a"
    assert (tmp_path / "src" / "Client X v1.pt").is_file()  # the source is only read
    assert row.format == "pt" and row.origin == "imported" and row.task == "detect"
    assert row.sha256 == service.sha256_file(copied)
    assert service.state_of(lib, row) == "ready"


def test_the_same_weights_twice_is_a_409_naming_the_first_model(lib, tmp_path):
    first = add(lib, tmp_path, name="a")
    with pytest.raises(AppError) as e:
        add(lib, tmp_path, name="b")
    assert e.value.status == 409
    assert e.value.code == "already_exists"
    assert e.value.details == {"model_id": first.id}
    assert len(list(lib.models_dir.iterdir())) == 1
    assert service.find_by_sha(lib, first.sha256).id == first.id


def test_artifacts_and_exports_are_copied_and_kept_relative_to_the_model_folder(lib, tmp_path):
    csv = tmp_path / "run" / "results.csv"
    csv.parent.mkdir()
    csv.write_text("epoch\n1\n", encoding="utf-8")
    onnx = tmp_path / "run" / "best.onnx"
    onnx.write_bytes(b"onnx")
    row = add(lib, tmp_path, artifacts={"results_csv": csv}, exports={"onnx": onnx})
    assert row.artifacts == {"results_csv": "artifacts/results.csv"}
    assert row.exports == {"onnx": "exports/best.onnx"}
    folder = service.model_dir(lib, row)
    assert (folder / "artifacts" / "results.csv").read_text(encoding="utf-8") == "epoch\n1\n"
    assert (folder / "exports" / "best.onnx").read_bytes() == b"onnx"


def test_a_missing_weights_file_makes_the_model_unavailable(lib, tmp_path):
    row = add(lib, tmp_path)
    service.weights_file(lib, row).unlink()
    assert service.state_of(lib, row) == "unavailable"
    with pytest.raises(AppError) as e:
        service.require_ready(lib, row.id)
    assert e.value.status == 409 and e.value.code == "model_unavailable"


def test_get_model_of_an_unknown_id_is_a_404(lib):
    with pytest.raises(AppError) as e:
        service.get_model(lib, "nope")
    assert e.value.status == 404


def test_delete_model_removes_only_that_models_folder(lib, tmp_path):
    a = add(lib, tmp_path, b"a", name="a")
    b = add(lib, tmp_path, b"b", name="b")
    service.delete_model(lib, a.id)
    assert not service.model_dir(lib, a).exists()
    assert service.weights_file(lib, b).is_file()
    assert lib.models_dir.is_dir()
    with pytest.raises(AppError):
        service.get_model(lib, a.id)


def test_list_is_newest_first_paginates_and_filters_by_task(lib, tmp_path):
    for i in range(3):
        add(lib, tmp_path, f"w{i}".encode(), name=f"m{i}")
    service.add_model(
        lib,
        source_weights=weights(tmp_path, b"obb", "obb.pt"),
        name="rotated",
        origin="imported",
        task="obb",
        class_names=["x"],
    )
    rows, cursor = service.list_models(lib, 2, None)
    assert [r.name for r in rows] == ["rotated", "m2"]
    rest, end = service.list_models(lib, 2, cursor)
    assert [r.name for r in rest] == ["m1", "m0"]
    assert end is None
    obb, _ = service.list_models(lib, None, None, task="obb")
    assert [r.name for r in obb] == ["rotated"]


def test_update_model_changes_only_the_editable_fields(lib, tmp_path):
    row = add(lib, tmp_path)
    updated = service.update_model(lib, row.id, name="renamed", notes="good", supplier="Client X")
    assert (updated.name, updated.notes, updated.supplier) == ("renamed", "good", "Client X")
    with pytest.raises(ValueError):
        service.update_model(lib, row.id, sha256="x")


def test_set_export_records_a_path_relative_to_the_model_folder(lib, tmp_path):
    row = add(lib, tmp_path)
    target = service.model_dir(lib, row) / "exports" / "weights.onnx"
    target.parent.mkdir()
    target.write_bytes(b"x")
    assert service.set_export(lib, row.id, "onnx", target).exports == {"onnx": "exports/weights.onnx"}


def test_slug_makes_a_file_safe_stem():
    assert service.slug("yolo11n coco") == "yolo11n-coco"
    assert service.slug("Ahmadia v1 / n") == "ahmadia-v1-n"
    assert service.slug("   ") == "model"
