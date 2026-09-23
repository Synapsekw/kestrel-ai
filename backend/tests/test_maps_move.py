"""Moving a past map out of a training project into a detection project (spec 2026-09-23 section 6.3)."""

from pathlib import Path

import pytest
from geotiffs import make_geotiff
from sqlalchemy import select

from app.db.models import MapLabel, MapRun, MapZone
from app.maps import service as maps_service
from app.maps.schemas import GeoMapCreate

BASE = "/api/v1/projects"
ZONE = [[0, 0], [300, 0], [300, 300], [0, 300]]


def _new_project(client, folder: Path, kind: str, classes: list[dict]) -> dict:
    r = client.post(
        BASE, json={"name": f"P {folder.name}", "folder": str(folder), "classes": classes, "kind": kind}
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def past_map(app, handle, project, wait_job, tmp_path):
    """A ready map in the training project (imported before the split), with a zone, two labels and
    a run, as a project that predates the train/detect split has them."""
    src = make_geotiff(tmp_path / "site.tif", 1200, 700)
    row = maps_service.create_map(handle, GeoMapCreate(path=str(src), name="Site"))
    job = app.state.jobs.submit(handle, "map_import", {"map_id": row.id, "name": row.name})
    assert wait_job(handle.id, job.id)["state"] == "succeeded"
    excavator, dump_truck = project["classes"][0]["id"], project["classes"][3]["id"]
    with handle.session() as s:
        s.add(MapZone(map_id=row.id, name="North", polygon=ZONE))
        s.add(MapLabel(map_id=row.id, class_id=excavator, x=10, y=10, w=20, h=20))
        s.add(MapLabel(map_id=row.id, class_id=dump_truck, x=50, y=50, w=20, h=20))
        s.add(MapRun(map_id=row.id, kind="local_model", model_id="m1"))
    run_dir = handle.folder / "maps" / row.id / "runs" / "r1"
    run_dir.mkdir(parents=True)
    (run_dir / "windows.json").write_text("[]")
    return row.id


@pytest.fixture
def detect_project(client, tmp_path) -> dict:
    """A detection project that already has an `excavator` class (another id) and nothing else."""
    return _new_project(client, tmp_path / "detect", "detect", [{"name": "excavator", "colour": "#ff0000"}])


def _move(client, project_id, map_id, target_id):
    return client.post(f"{BASE}/{project_id}/maps/{map_id}/move", json={"target_project_id": target_id})


def test_move_copies_the_map_zones_and_labels_but_not_runs(
    app, client, project_id, handle, past_map, detect_project, wait_job
):
    target = detect_project["id"]
    r = _move(client, project_id, past_map, target)
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["type"] == "map_move" and job["project_id"] == target
    done = wait_job(target, job["id"])
    assert done["state"] == "succeeded", done
    assert done["params"] == {"source_project_id": project_id, "map_id": past_map}

    listed = client.get(f"{BASE}/{target}/maps").json()["items"]
    assert [m["id"] for m in listed] == [past_map]
    moved = listed[0]
    original = client.get(f"{BASE}/{project_id}/maps/{past_map}").json()
    for field in ("name", "status", "source_path", "width", "height", "epsg", "bounds_wgs84", "gsd_cm"):
        assert moved[field] == original[field], field
    assert client.get(f"{BASE}/{target}/maps/{past_map}/preview").status_code == 200
    assert client.get(f"{BASE}/{target}/maps/{past_map}/tiles/3/0/0").status_code == 200

    zones = client.get(f"{BASE}/{target}/maps/{past_map}/zones").json()["items"]
    assert [(z["name"], z["polygon"]) for z in zones] == [("North", ZONE)]
    assert client.get(f"{BASE}/{target}/maps/{past_map}/runs").json()["items"] == []
    target_handle = app.state.projects.get(target)
    assert not (target_handle.folder / "maps" / past_map / "runs").exists()

    # Labels keep their class by name: `excavator` joins the target's own class, `dump_truck` is added.
    classes = {c["name"]: c["id"] for c in client.get(f"{BASE}/{target}").json()["classes"]}
    assert set(classes) == {"excavator", "dump_truck"}
    with target_handle.session() as s:
        label_classes = {lab.class_id for lab in s.execute(select(MapLabel)).scalars()}
    assert label_classes == {classes["excavator"], classes["dump_truck"]}

    # the source keeps everything: this is a copy
    assert client.get(f"{BASE}/{project_id}/maps/{past_map}/runs").json()["items"] != []
    assert (handle.folder / "maps" / past_map / "map.tif").is_file()


def test_moving_the_same_map_again_fails_readably(client, project_id, past_map, detect_project, wait_job):
    target = detect_project["id"]
    first = _move(client, project_id, past_map, target).json()["job"]["id"]
    assert wait_job(target, first)["state"] == "succeeded"
    again = _move(client, project_id, past_map, target)
    assert again.status_code == 202
    done = wait_job(target, again.json()["job"]["id"])
    assert done["state"] == "failed"
    assert done["error"] == "This map is already in P detect."
    assert len(client.get(f"{BASE}/{target}/maps").json()["items"]) == 1


def test_a_training_target_is_409(client, project_id, past_map, tmp_path):
    other = _new_project(client, tmp_path / "train2", "train", [])
    r = _move(client, project_id, past_map, other["id"])
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "wrong_project_kind"
    assert err["details"] == {"kind": "train", "allowed": ["detect"]}


def test_moving_from_a_detection_project_is_409(client, detect_project, tmp_path):
    other = _new_project(client, tmp_path / "detect2", "detect", [])
    r = _move(client, detect_project["id"], "any-map", other["id"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"


def test_unknown_map_or_target_is_404(client, project_id, past_map, detect_project):
    assert _move(client, project_id, "no-such-map", detect_project["id"]).status_code == 404
    assert _move(client, project_id, past_map, "no-such-project").status_code == 404
