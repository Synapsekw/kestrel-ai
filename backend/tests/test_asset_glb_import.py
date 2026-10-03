# backend/tests/test_asset_glb_import.py
"""asset_glb_import (spec §6.1): copy and hash, JSON parse, trimesh check, silhouette and height,
an `imported` version, the frame, restore, and the failure paths."""

import json
import re
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models import store
from app.asset_review import frame_io, glb, meshes
from app.asset_review.glb_import import GLB_IMPORT_JOB, start_import
from app.db.models import AssetModel, AssetModelVersion
from app.jobs.registry import cancelled_before_start_hook

BASE = "/api/v1/projects/{pid}/asset-models"
ORIGIN = {"lat": 24.4539, "lon": 54.3773, "ground_alt_m": 5.0}


@pytest.fixture(autouse=True)
def _fresh_cache():
    meshes.clear_cache()
    yield
    meshes.clear_cache()


@pytest.fixture
def base(project_id):
    return BASE.format(pid=project_id)


@pytest.fixture
def model(client, base):
    r = client.post(base, json={"name": "Tower"})
    assert r.status_code == 201, r.text
    return r.json()


def _import(client, base, model, **body):
    r = client.post(f"{base}/{model['id']}/versions/import-glb", json=body)
    assert r.status_code == 202, r.text
    return r.json()


def _broken_glb(path):
    """Valid header and JSON, but the accessor needs 3,600 bytes and the BIN chunk has 12."""
    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "broken", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 300,
                "type": "VEC3",
                "min": [0, 0, 0],
                "max": [1, 1, 1],
            }
        ],
        "bufferViews": [{"buffer": 0, "byteLength": 3600}],
        "buffers": [{"byteLength": 3600}],
    }
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    tail = struct.pack("<I4s", 12, b"BIN\x00") + bytes(12)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body) + len(tail))
        + struct.pack("<I4s", len(body), b"JSON")
        + body
        + tail
    )
    return path


def test_import_tower_creates_an_imported_version(client, base, model, project_id, wait_job, tmp_path):
    tower = make_tower(tmp_path, photos=False)
    body = _import(client, base, model, path=str(tower.glb_path))
    assert body["version"]["kind"] == "imported" and body["version"]["glb_status"] == "pending"
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"]["version"] == 1 and job["result"]["parts"] > 50
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    meta = v["meta"]
    assert v["kind"] == "imported" and v["glb_status"] == "ready" and v["spec"]["parts"] == []
    assert meta["source_name"] == tower.glb_path.name and meta["frame_conversion"] == "none"
    assert re.fullmatch(r"[0-9a-f]{64}", meta["sha256"]) and re.fullmatch(
        r"[0-9a-f]{64}", meta["source_sha256"]
    )
    assert v["part_count"] == len(meta["parts"]) and meta["node_count"] >= len(meta["parts"])
    assert {"Leg", "Antenna", "Platform"} <= {p["group"] for p in meta["parts"]}
    top = float(trimesh.load(str(tower.glb_path), force="scene").bounds[1][1])
    assert meta["height_m"] == pytest.approx(top, abs=1e-3) and meta["triangles"] > 1000
    glb_resp = client.get(f"{base}/{model['id']}/versions/1/glb")
    assert glb_resp.status_code == 200 and glb_resp.content[:4] == b"glTF"
    assert meta["bytes"] == len(glb_resp.content)
    m = client.get(f"{base}/{model['id']}").json()
    assert m["status"] == "ready" and m["current_version"] == 1
    assert m["frame"]["height_m"] == pytest.approx(top, abs=1e-3) and m["frame"]["origin"] is None
    assert 1 < len(m["frame"]["silhouette"]) <= 160 and m["frame"]["silhouette"] == meta["silhouette"]


def test_import_with_conversion_lands_in_the_canonical_frame(
    client, base, model, project_id, wait_job, handle, tmp_path
):
    tower = make_tower(tmp_path, photos=False)
    kipic = trimesh.load(str(tower.glb_path), force="scene")
    canonical_bounds = kipic.bounds.copy()
    kipic.apply_transform(np.linalg.inv(frame_io.CONVERSIONS["x_east_minus_z_north"]))
    src = tmp_path / "kipic.glb"
    src.write_bytes(kipic.export(file_type="glb"))
    body = _import(client, base, model, path=str(src), frame_conversion="x_east_minus_z_north", origin=ORIGIN)
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    mesh, _ = meshes.load_version_mesh(handle, model["id"], 1)
    assert np.allclose(mesh.bounds, canonical_bounds, atol=1e-4)
    m = client.get(f"{base}/{model['id']}").json()
    assert {k: m["frame"]["origin"][k] for k in ORIGIN} == ORIGIN
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    assert v["meta"]["frame_conversion"] == "x_east_minus_z_north"
    info = glb.parse(src)
    stored = store.version_glb_path(handle, model["id"], 1).read_bytes()
    raw = src.read_bytes()
    assert stored[-(len(raw) - 20 - info.json_length) :] == raw[20 + info.json_length :]  # BIN not rewritten


def test_import_refuses_what_is_not_a_glb(client, base, model, tmp_path):
    text = tmp_path / "notes.glb"
    text.write_text("hello")
    for path in (str(text), str(tmp_path / "missing.glb"), "bad\x00name.glb"):
        r = client.post(f"{base}/{model['id']}/versions/import-glb", json={"path": path})
        assert r.status_code == 422 and r.json()["error"]["code"] == "glb_invalid", r.text
    r = client.post(
        f"{base}/{model['id']}/versions/import-glb", json={"path": str(text), "frame_conversion": "z_up"}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get(f"{base}/{model['id']}/versions").json()["items"] == []
    assert client.post(f"{base}/missing/versions/import-glb", json={"path": str(text)}).status_code == 404


def test_import_is_refused_while_an_agent_run_is_live(client, base, model, handle, tmp_path):
    with handle.session() as s:
        s.get(AssetModel, model["id"]).live_run_id = "run-1"
    r = client.post(
        f"{base}/{model['id']}/versions/import-glb",
        json={"path": str(make_tower(tmp_path, photos=False).glb_path)},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"


def test_a_glb_trimesh_cannot_load_fails_the_version(
    client, base, model, project_id, wait_job, handle, tmp_path
):
    body = _import(client, base, model, path=str(_broken_glb(tmp_path / "broken.glb")))
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed" and job["error"].startswith("The GLB could not be loaded")
    v = client.get(f"{base}/{model['id']}/versions/1").json()
    assert v["glb_status"] == "failed" and v["meta"]["error"] == job["error"]
    assert not store.version_glb_path(handle, model["id"], 1).exists()
    assert not list(store.model_dir(handle, model["id"]).glob("*.tmp"))


def test_reimport_follows_an_untouched_frame_and_keeps_an_edited_one(
    client, base, model, project_id, wait_job, tmp_path
):
    tower = make_tower(tmp_path, photos=False)
    wait_job(project_id, _import(client, base, model, path=str(tower.glb_path))["job"]["id"])
    h1 = client.get(f"{base}/{model['id']}").json()["frame"]["height_m"]
    big = trimesh.load(str(tower.glb_path), force="scene")
    big.apply_scale(2.0)
    src = tmp_path / "big.glb"
    src.write_bytes(big.export(file_type="glb"))
    wait_job(project_id, _import(client, base, model, path=str(src))["job"]["id"])
    frame = client.get(f"{base}/{model['id']}").json()["frame"]
    assert frame["height_m"] == pytest.approx(2 * h1, abs=1e-2)
    r = client.patch(f"{base}/{model['id']}", json={"frame": {**frame, "height_m": 50.0}})  # Task 4's PATCH
    assert r.status_code == 200, r.text
    wait_job(project_id, _import(client, base, model, path=str(tower.glb_path))["job"]["id"])
    assert client.get(f"{base}/{model['id']}").json()["frame"]["height_m"] == 50.0


def test_restore_of_an_imported_version_reimports_its_glb(
    client, base, model, project_id, wait_job, tmp_path
):
    wait_job(
        project_id,
        _import(client, base, model, path=str(make_tower(tmp_path, photos=False).glb_path))["job"]["id"],
    )
    r = client.post(f"{base}/{model['id']}/versions/1/restore")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"]["version"] == 2 and body["version"]["kind"] == "imported"
    assert body["version"]["note"] == "Restored from version 1"
    assert wait_job(project_id, body["job"]["id"])["state"] == "succeeded"
    v1 = client.get(f"{base}/{model['id']}/versions/1").json()["meta"]
    v2 = client.get(f"{base}/{model['id']}/versions/2").json()["meta"]
    assert v2["sha256"] == v1["sha256"] and v2["source_name"] == v1["source_name"]


def test_cancelled_before_start_marks_the_version_failed(handle, tmp_path):
    from app.asset_models.service import refresh_status

    class Runner:
        def submit(self, handle, type, params):
            from app.db.models import Job

            with handle.session() as s:
                job = Job(type=type, params=params)
                s.add(job)
                s.flush()
                s.expunge(job)
            return job

    with handle.session() as s:
        m = AssetModel(name="m", status="empty")
        s.add(m)
        s.flush()
        mid = m.id
    row, job = start_import(
        handle,
        Runner(),
        mid,
        path=make_tower(tmp_path, photos=False).glb_path,
        conversion="none",
        origin=None,
    )

    class Ctx:
        project, params, job_id = handle, job.params, job.id

        def publish(self, *_a):
            pass

    cancelled_before_start_hook(GLB_IMPORT_JOB)(Ctx())
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "failed" and v.kind == "imported" and v.meta["error"]
        model = s.get(AssetModel, mid)
        refresh_status(model)
        assert model.current_version == 1


def test_imported_versions_survive_the_restart_sweep_rules(handle, tmp_path):
    """A pending imported version whose job is gone is failed by the existing asset model sweep."""
    from app.asset_models import startup

    class Runner:
        def is_live(self, _job_id):
            return False

    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        s.add(
            AssetModelVersion(
                model_id=m.id,
                version=1,
                spec={},
                kind="imported",
                glb_status="pending",
                source_ids=[],
                part_count=0,
                glb_job_id="gone",
            )
        )
        mid = m.id
    startup.sweep_interrupted(handle, Runner())
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"


def test_the_request_literal_lists_every_conversion():
    from typing import get_args

    from app.asset_review.glb_schemas import FrameConversion

    assert set(get_args(FrameConversion)) == set(frame_io.CONVERSIONS)


def test_a_bad_origin_fails_the_job_with_a_clear_error(handle, tmp_path):
    from app.asset_review.glb_import import run_glb_import
    from app.jobs.cancellation import JobFailure

    with handle.session() as s:
        m = AssetModel(name="m", status="empty")
        s.add(m)
        s.flush()
        mid = m.id
    src = make_tower(tmp_path, photos=False).glb_path
    _row, job = start_import(
        handle,
        _SubmitRunner(),
        mid,
        path=src,
        conversion="none",
        origin={"lat": 99, "lon": 0, "ground_alt_m": 0},
    )

    class Ctx:
        project, params, job_id = handle, job.params, job.id

        def publish(self, *_a):
            pass

        def progress(self, *_a):
            pass

        def check_cancelled(self):
            pass

    with pytest.raises(JobFailure, match="origin"):
        run_glb_import(Ctx())
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "failed" and "origin" in v.meta["error"]


class _SubmitRunner:
    def submit(self, handle, type, params):
        from app.db.models import Job

        with handle.session() as s:
            job = Job(type=type, params=params)
            s.add(job)
            s.flush()
            s.expunge(job)
        return job
