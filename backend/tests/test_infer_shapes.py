"""The `infer` job writes shapes (image inspection spec §11.3, §15, §16; plan I-BP task 3)."""

import pytest
from library_helpers import add_library_model
from sqlalchemy import select

from app.db.models import Box, Image, Source
from app.providers.base import Detection, TileResult

BASE = "/api/v1/projects"
W, H = 2000, 1280


class ShapeProvider:
    """Full-image detections for a whole-frame tile: every shape, plus edge cases (Review Focus 4)."""

    name = "fake"

    def __init__(self):
        self.tiles = []

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        self.tiles.append(tile)
        return TileResult(
            tile=tile,
            detections=[
                Detection("excavator", 100, 100, 80, 30, 0.9, raw_ref, angle=30.0),
                Detection.from_polygon(
                    "dump_truck", [(300, 300), (350, 300), (350, 350), (300, 350)], 0.8, raw_ref
                ),
                # collinear: nothing drawable
                Detection.from_polygon("dump_truck", [(500, 500), (520, 500), (540, 500)], 0.7, raw_ref),
                # overhangs the right edge by 0.4 px of floating-point noise
                Detection("excavator", W - 50, 10, 50.4, 40, 0.6, raw_ref),
                # crosses the right edge: clipped by I-BA's repair
                Detection.from_polygon(
                    "dump_truck", [(1980, 600), (2040, 600), (2040, 660), (1980, 660)], 0.5, raw_ref
                ),
                # an rbox whose centre is outside the frame
                Detection("excavator", W + 10, 900, 60, 20, 0.4, raw_ref, angle=45.0),
            ],
        )


@pytest.fixture
def provider(monkeypatch):
    fake = ShapeProvider()
    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: fake)
    return fake


@pytest.fixture
def frame_id(handle, project_dir, make_jpeg) -> str:
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="test")
        s.add(source)
        s.flush()
        make_jpeg(project_dir / "images" / "f0.jpg", W, H, seed=1)
        row = Image(path="images/f0.jpg", width=W, height=H, source_id=source.id)
        s.add(row)
        s.flush()
        return row.id


def _run(client, wait_job, app, tmp_path, project_id, image_ids, *, task="detect", tiling=None) -> dict:
    model = add_library_model(app, tmp_path, name="m", task=task, class_names=["excavator", "dump_truck"])
    body = {
        "kind": "local_model",
        "model_id": model.id,
        "image_ids": image_ids,
        "tiling": tiling or {"enabled": False},
    }
    r = client.post(f"{BASE}/{project_id}/query-runs", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    return {"run": r.json()["query_run"], "job": job}


def _rows(handle) -> list[Box]:
    with handle.session() as s:
        rows = list(s.execute(select(Box)).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def test_the_job_writes_rboxes_and_polygons_as_shapes(
    client, wait_job, app, tmp_path, project_id, handle, frame_id, provider
):
    out = _run(client, wait_job, app, tmp_path, project_id, [frame_id])
    assert out["job"]["state"] == "succeeded", out["job"]
    rows = _rows(handle)
    rbox = next(r for r in rows if r.shape == "rbox")
    poly = next(r for r in rows if r.shape == "polygon" and r.x < 1000)
    assert (rbox.x, rbox.y, rbox.w, rbox.h, rbox.angle) == (100, 100, 80, 30, 30.0)
    assert len(poly.points) == 4
    assert (poly.x, poly.y, poly.w, poly.h, poly.angle) == (300, 300, 50, 50, 0.0)
    assert poly.area_px == pytest.approx(2500)
    assert {r.review_state for r in rows} == {"unreviewed"}
    assert {r.query_run_id for r in rows} == {out["run"]["id"]}


def test_edge_shapes_are_clipped_clamped_or_dropped(
    client, wait_job, app, tmp_path, project_id, handle, frame_id, provider
):
    out = _run(client, wait_job, app, tmp_path, project_id, [frame_id])
    assert out["job"]["state"] == "succeeded", out["job"]
    rows = _rows(handle)
    assert out["job"]["result"]["boxes"] == len(rows) == 4  # collinear ring and outside rbox dropped
    edge_box = next(r for r in rows if r.shape == "box")
    assert edge_box.x + edge_box.w == pytest.approx(W)
    clipped = next(r for r in rows if r.shape == "polygon" and r.x >= 1900)
    assert max(p[0] for p in clipped.points) == pytest.approx(W)
    assert clipped.x + clipped.w == pytest.approx(W)


def test_the_job_touches_the_summary_of_every_image_it_writes(
    client, wait_job, app, tmp_path, project_id, frame_id, provider, monkeypatch
):
    touched: list[str] = []
    monkeypatch.setattr("app.imagery.summary.touch", lambda conn, image_id: touched.append(image_id))
    _run(client, wait_job, app, tmp_path, project_id, [frame_id])
    assert touched == [frame_id]


def test_a_resume_does_not_repropose_a_reviewed_rbox(
    client, wait_job, app, tmp_path, project_id, handle, frame_id, provider
):
    out = _run(client, wait_job, app, tmp_path, project_id, [frame_id])
    with handle.session() as s:
        rbox = s.execute(select(Box).where(Box.shape == "rbox")).scalars().one()
        rbox.review_state = "accepted"
        kept = rbox.id
    r = client.post(f"{BASE}/{project_id}/query-runs/{out['run']['id']}/resume")
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    rboxes = [row for row in _rows(handle) if row.shape == "rbox"]
    assert [b.id for b in rboxes] == [kept]


def test_the_cap_keeps_the_most_confident_and_the_job_succeeds(
    client, wait_job, app, tmp_path, project_id, handle, frame_id, provider, monkeypatch
):
    monkeypatch.setattr("app.imagery.annotations.PER_IMAGE_CAP", 2)
    out = _run(client, wait_job, app, tmp_path, project_id, [frame_id])
    assert out["job"]["state"] == "succeeded", out["job"]
    assert sorted(r.confidence for r in _rows(handle)) == pytest.approx([0.8, 0.9])


def test_a_segmentation_model_sees_a_frame_up_to_twice_the_tile_whole(
    client, wait_job, app, tmp_path, project_id, frame_id, provider
):
    tiling = {"enabled": True, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5}
    _run(client, wait_job, app, tmp_path, project_id, [frame_id], task="segment", tiling=tiling)
    assert [(t.w, t.h) for t in provider.tiles] == [(W, H)]


def test_a_detect_model_is_still_tiled(client, wait_job, app, tmp_path, project_id, frame_id, provider):
    tiling = {"enabled": True, "tile_size": 1280, "overlap": 0.2, "nms_iou": 0.5}
    _run(client, wait_job, app, tmp_path, project_id, [frame_id], tiling=tiling)
    assert len(provider.tiles) == 2
