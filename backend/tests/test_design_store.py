"""The inspection folder and the geometry cache (spec §3 Storage)."""

import shutil

import numpy as np
import pytest
from PIL import Image

from app.errors import AppError
from app.surfaces.design import store, thumbs
from app.surfaces.design.inspection import candidate_from_meta


def test_candidate_cache_round_trip_faces(tmp_path):
    w = store.CandidateWriter(tmp_path / "c0", "faces")
    base = w.add_points(np.array([[500000.0, 2800000.0, 1.0], [500010.0, 2800000.0, 2.0]]))
    assert base == 0
    assert w.add_points([[500000.0, 2800010.0, 3.0]]) == 2
    w.add_faces([[0, 1, 2]])
    meta = w.close()
    assert meta["point_count"] == 3 and meta["face_count"] == 1
    assert meta["bbox"] == [500000.0, 2800000.0, 500010.0, 2800010.0]
    assert (meta["z_min"], meta["z_max"]) == (1.0, 3.0)
    a = store.read_candidate(tmp_path / "c0")
    assert a.points.shape == (3, 3) and a.points.dtype == np.float64
    assert a.faces.tolist() == [[0, 1, 2]] and a.faces.dtype == np.int32
    assert a.runs is None


def test_candidate_cache_runs(tmp_path):
    w = store.CandidateWriter(tmp_path / "c1", "points")
    w.add_runs(np.zeros((5, 3)), [2, 3])
    w.add_runs(np.ones((1, 3)), [1])  # a POINT is a run of 1
    meta = w.close()
    a = store.read_candidate(tmp_path / "c1")
    assert a.runs.tolist() == [0, 2, 5, 6]
    assert meta["run_count"] == 3 and a.faces is None


def test_empty_candidate(tmp_path):
    meta = store.CandidateWriter(tmp_path / "c2", "points").close()
    a = store.read_candidate(tmp_path / "c2")
    assert a.points.shape == (0, 3) and meta["bbox"] is None and meta["z_min"] is None
    c = candidate_from_meta("c2", "dxf_layer", "EMPTY", meta)
    assert c.bounds_file == [0.0, 0.0, 0.0, 0.0] and c.z_min is None


def test_inspection_ids_must_be_uuids(tmp_path):
    class H:
        folder = tmp_path

    for bad in ("..", "..\\..\\x", "abc", "C:/Windows"):
        with pytest.raises(AppError) as e:
            store.inspection_dir(H, bad)
        assert e.value.status == 404
    iid = store.new_id()
    assert store.inspection_dir(H, iid) == tmp_path / "cache" / "design-inspections" / iid


def test_inspection_ids_reject_a_trailing_newline(tmp_path):
    """Fix round 1, finding 3: `match` lets `$` match just before a trailing newline; a UUID plus
    "\\n" must still be rejected, so the id check uses `fullmatch`."""

    class H:
        folder = tmp_path

    with pytest.raises(AppError) as e:
        store.inspection_dir(H, store.new_id() + "\n")
    assert e.value.status == 404
    with pytest.raises(AppError):
        store.preview_dir(tmp_path, store.new_id() + "\n")


def test_write_json_is_a_no_op_after_delete(tmp_path):
    d = tmp_path / "gone"
    assert store.write_json(d / "inspection.json", {"state": "ready"}) is False
    assert not d.exists()
    assert store.patch_json(d / "inspection.json", state="failed") is None


def test_patch_json_merges(tmp_path):
    p = tmp_path / "x.json"
    store.write_json(p, {"a": 1, "b": 2})
    assert store.patch_json(p, b=3, c=4) == {"a": 1, "b": 3, "c": 4}
    assert store.read_json(p) == {"a": 1, "b": 3, "c": 4}


def test_create_inspection_writes_request_and_body(tmp_path):
    class H:
        folder = tmp_path / "proj"

    src = tmp_path / "site.xml"
    src.write_text("<LandXML/>")
    iid = store.new_id()
    d = store.create_inspection(H, iid, src, "landxml")
    req, body = store.read_json(d / "request.json"), store.read_json(d / "inspection.json")
    assert req["path"] == str(src) and req["preview_job_ids"] == [] and req["build_job_id"] is None
    assert body["state"] == "inspecting" and body["format"] == "landxml" and body["file_size"] == 10
    assert store.job_ids({**req, "inspect_job_id": "a", "preview_job_ids": ["b"], "build_job_id": "c"}) == [
        "a",
        "b",
        "c",
    ]


def test_sha256_is_streamed(tmp_path):
    import hashlib

    p = tmp_path / "f.bin"
    p.write_bytes(b"x" * 1000)
    seen = []
    digest = store.sha256_file(p, progress=seen.append, check_cancelled=lambda: None)
    assert digest == hashlib.sha256(b"x" * 1000).hexdigest() and seen[-1] == 1.0


def test_plan_thumbnail_is_at_most_160_px(tmp_path):
    rng = np.random.default_rng(0)
    pts = np.column_stack([rng.uniform(0, 400, 5000), rng.uniform(0, 100, 5000), rng.uniform(0, 5, 5000)])
    out = tmp_path / "thumbs" / "c0.png"
    thumbs.plan_thumbnail(pts + [500000, 2800000, 0], out)
    im = Image.open(out)
    assert max(im.size) == 160 and im.mode == "RGBA"


def test_shade_thumbnail_keeps_zero_transparent(tmp_path):
    shade = np.zeros((400, 800), np.uint8)
    shade[:, 400:] = 200
    out = tmp_path / "t.png"
    thumbs.shade_thumbnail(shade, out)
    im = np.asarray(Image.open(out))
    assert im.shape[1] == 160 and im[0, 0, 3] == 0 and im[0, -1, 3] == 255


def test_candidate_writer_does_not_recreate_a_deleted_inspection_dir(tmp_path):
    """Review Focus 3 hardening: mkdir(parents=False) below a deleted inspection dir raises,
    rather than silently recreating cand/<cid>/ after the delete."""
    idir = tmp_path / "cache" / "design-inspections" / store.new_id()
    idir.mkdir(parents=True)
    shutil.rmtree(idir)
    with pytest.raises(FileNotFoundError):
        store.CandidateWriter(store.candidate_dir(idir, "c0"), "faces")
    assert not idir.exists()


def test_thumbnail_does_not_recreate_a_deleted_inspection_dir(tmp_path):
    idir = tmp_path / "cache" / "design-inspections" / store.new_id()
    idir.mkdir(parents=True)
    shutil.rmtree(idir)
    pts = np.array([[500000.0, 2800000.0, 1.0], [500010.0, 2800000.0, 2.0], [500000.0, 2800010.0, 3.0]])
    with pytest.raises(FileNotFoundError):
        thumbs.plan_thumbnail(pts, store.thumb_path(idir, "c0"))
    assert not idir.exists()


def test_update_json_appends_without_losing_a_concurrent_write(tmp_path):
    import threading

    p = tmp_path / "request.json"
    store.write_json(p, {"preview_job_ids": []})

    def add(i):
        store.update_json(p, lambda d: {**d, "preview_job_ids": [*d["preview_job_ids"], i]})

    threads = [threading.Thread(target=add, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(store.read_json(p)["preview_job_ids"]) == list(range(20))
    assert store.update_json(tmp_path / "gone.json", lambda d: d) is None


def test_build_live(tmp_path):
    class Runner:
        def is_live(self, job_id):
            return job_id == "live"

    assert store.build_live({"build_job_id": "live"}, Runner())
    assert not store.build_live({"build_job_id": "done"}, Runner())
    assert not store.build_live({"build_job_id": None}, Runner())
    assert not store.build_live({}, Runner())
