"""Interactive detection on one image (image inspection spec §11.2, §16, §17 `detect_one`;
decision I-D13): a held GPU gives the CPU, "already covered" is counted, the replace is idempotent."""

import math
import threading

import pytest
from catalogue_fake import create_type
from library_helpers import add_library_model
from sqlalchemy import select

from app.db.models import Box, Image, Source
from app.imagery.detect import MAX_TILES, tiling_for
from app.jobs.gpu import gpu_lock
from app.library import service as library
from app.providers.tiling import make_tiles

BASE = "/api/v1/projects"
W, H = 2000, 1280


class Row:
    def __init__(self, xyxy, cls, conf):
        self.xyxy, self.cls, self.conf = [xyxy], [cls], [conf]


class Obb:
    def __init__(self, rows):
        self.xywhr = [list(r[:5]) for r in rows]
        self.cls = [r[5] for r in rows]
        self.conf = [r[6] for r in rows]


class SegBoxes:
    def __init__(self, cls, conf):
        self.cls, self.conf = cls, conf


class Masks:
    def __init__(self, rings):
        self.xy = rings


class Result:
    def __init__(self, *, boxes=None, obb=None, masks=None):
        self.boxes, self.obb, self.masks = boxes, obb, masks


class FakeYolo:
    def __init__(self, names, result):
        self.names, self.result = names, result
        self.calls: list[dict] = []

    def predict(self, source, **kwargs):
        self.calls.append(kwargs)
        return [self.result]


BOXES = Result(boxes=[Row([10, 20, 110, 140], 0, 0.9), Row([200, 200, 260, 280], 1, 0.7)])


@pytest.fixture
def use_yolo(monkeypatch):
    """Install a fake YOLO for both devices; CUDA "exists"; the GPU wait is shortened for speed."""

    def _use(names=None, result=BOXES) -> FakeYolo:
        fake = FakeYolo(names or {0: "truck", 1: "excavator"}, result)
        monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: fake)
        return fake

    monkeypatch.setattr("app.providers.local_yolo.cuda_available", lambda: True)
    monkeypatch.setattr("app.imagery.detect.GPU_WAIT_S", 0.05)
    return _use


@pytest.fixture
def image_id(handle, project_dir, make_jpeg) -> str:
    with handle.session() as s:
        source = Source(folder=str(project_dir), site="test")
        s.add(source)
        s.flush()
        make_jpeg(project_dir / "images" / "f0.jpg", W, H, seed=1)
        row = Image(path="images/f0.jpg", width=W, height=H, source_id=source.id)
        s.add(row)
        s.flush()
        return row.id


@pytest.fixture
def model(app, tmp_path):
    return add_library_model(
        app, tmp_path, name="coco", class_names=["truck", "excavator"], class_aliases={"truck": "dump_truck"}
    )


def detect(client, project_id, image_id, **body):
    return client.post(f"{BASE}/{project_id}/images/{image_id}/detect", json=body)


def classes(client, project_id) -> dict[str, str]:
    return {c["name"]: c["id"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]}


def boxes(handle, **where) -> list[Box]:
    with handle.session() as s:
        q = select(Box)
        for k, v in where.items():
            q = q.where(getattr(Box, k) == v)
        rows = list(s.execute(q).scalars())
        for r in rows:
            s.expunge(r)
    return rows


def put_box(handle, image_id, class_id, xywh, review_state, **kw) -> str:
    with handle.session() as s:
        row = Box(
            image_id=image_id,
            class_id=class_id,
            x=xywh[0],
            y=xywh[1],
            w=xywh[2],
            h=xywh[3],
            provenance_kind=kw.pop("provenance_kind", "person"),
            review_state=review_state,
            **kw,
        )
        s.add(row)
        s.flush()
        return row.id


# ---------------------------------------------------------------------------------- the answer


def test_detect_writes_suggestions_and_says_what_it_did(
    client, project_id, image_id, model, use_yolo, handle
):
    fake = use_yolo()
    r = detect(client, project_id, image_id, model_id=model.id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["new"], body["already_covered"], body["device"]) == (2, 0, "cuda")
    assert body["model_id"] == model.id and body["elapsed_ms"] >= 0
    assert set(body) == {"model_id", "suggestions", "new", "already_covered", "device", "elapsed_ms"}
    ids = classes(client, project_id)
    assert {s["class_id"] for s in body["suggestions"]} == {ids["dump_truck"], ids["excavator"]}
    assert [s["confidence"] for s in body["suggestions"]] == pytest.approx([0.9, 0.7])
    for s in body["suggestions"]:
        assert s["shape"] == "box" and s["review_state"] == "unreviewed"
        assert s["provenance"]["kind"] == "local_model" and s["provenance"]["query_run_id"] is None
    # untiled: one prediction at the frame's own long side rounded up to 32
    assert [(c["device"], c["imgsz"], c["conf"]) for c in fake.calls] == [("0", 2016, 0.25)]


def test_detect_touches_the_image_summary(client, project_id, image_id, model, use_yolo, monkeypatch):
    use_yolo()
    touched: list[str] = []
    monkeypatch.setattr("app.imagery.summary.touch", lambda conn, iid: touched.append(iid))
    assert detect(client, project_id, image_id, model_id=model.id).status_code == 200
    assert touched == [image_id]


def test_detect_publishes_boxes_changed(client, app, project_id, image_id, model, use_yolo):
    use_yolo()
    seen = []
    app.state.events.publish = lambda event: seen.append(event)
    assert detect(client, project_id, image_id, model_id=model.id).status_code == 200
    boxes_changed = [e for e in seen if e["type"] == "boxes.changed"]
    assert boxes_changed and boxes_changed[0]["payload"]["image_ids"] == [image_id]


def test_a_held_gpu_runs_the_frame_on_the_cpu(client, project_id, image_id, model, use_yolo):
    fake = use_yolo()
    gpu_lock.acquire()
    try:
        r = detect(client, project_id, image_id, model_id=model.id)
    finally:
        gpu_lock.release()
    assert r.status_code == 200, r.text
    assert r.json()["device"] == "cpu" and r.json()["new"] == 2
    assert [c["device"] for c in fake.calls] == ["cpu"]


def test_without_cuda_it_goes_straight_to_the_cpu(client, project_id, image_id, model, use_yolo, monkeypatch):
    fake = use_yolo()
    monkeypatch.setattr("app.providers.local_yolo.cuda_available", lambda: False)
    assert detect(client, project_id, image_id, model_id=model.id).json()["device"] == "cpu"
    assert [c["device"] for c in fake.calls] == ["cpu"]


def test_imgsz_and_conf_reach_the_model(client, project_id, image_id, model, use_yolo):
    fake = use_yolo()
    detect(client, project_id, image_id, model_id=model.id, conf=0.4, imgsz=640)
    # 2000 > 2 x 640, so the frame is tiled at 640: every tile predicts at its own size
    assert {c["imgsz"] for c in fake.calls} == {640} and {c["conf"] for c in fake.calls} == {0.4}
    assert len(fake.calls) == len(make_tiles(W, H, tiling_for(W, H, 640)))


# ---------------------------------------------------------------------- covered and idempotent


def test_an_accepted_or_rejected_box_of_the_same_type_covers_a_suggestion(
    client, project_id, image_id, model, use_yolo, handle
):
    use_yolo()
    ids = classes(client, project_id)
    put_box(handle, image_id, ids["excavator"], (200, 200, 60, 80), "accepted")
    put_box(
        handle, image_id, ids["dump_truck"], (12, 22, 100, 120), "rejected", provenance_kind="local_model"
    )
    body = detect(client, project_id, image_id, model_id=model.id).json()
    assert (body["new"], body["already_covered"]) == (0, 2)


def test_a_box_of_another_type_does_not_cover(client, project_id, image_id, model, use_yolo, handle):
    use_yolo()
    ids = classes(client, project_id)
    put_box(handle, image_id, ids["dump_truck"], (200, 200, 60, 80), "accepted")
    body = detect(client, project_id, image_id, model_id=model.id).json()
    assert (body["new"], body["already_covered"]) == (2, 0)


def test_a_second_call_replaces_the_first_calls_suggestions(
    client, project_id, image_id, model, use_yolo, handle
):
    use_yolo()
    first = {s["id"] for s in detect(client, project_id, image_id, model_id=model.id).json()["suggestions"]}
    second = detect(client, project_id, image_id, model_id=model.id).json()
    assert second["new"] == 2 and first.isdisjoint({s["id"] for s in second["suggestions"]})
    assert len(boxes(handle, model_id=model.id)) == 2


def test_a_rerun_keeps_decided_boxes_and_counts_them_covered(
    client, project_id, image_id, model, use_yolo, handle
):
    use_yolo()
    first = detect(client, project_id, image_id, model_id=model.id).json()["suggestions"]
    with handle.session() as s:
        s.get(Box, first[0]["id"]).review_state = "accepted"
    again = detect(client, project_id, image_id, model_id=model.id).json()
    assert (again["new"], again["already_covered"]) == (1, 1)
    kept = boxes(handle, id=first[0]["id"])
    assert len(kept) == 1 and kept[0].review_state == "accepted"


def test_two_racing_requests_leave_exactly_one_set_of_suggestions(
    client, project_id, image_id, model, use_yolo, handle
):
    use_yolo()
    results = []
    barrier = threading.Barrier(2)

    def call():
        barrier.wait(5)
        results.append(detect(client, project_id, image_id, model_id=model.id))

    threads = [threading.Thread(target=call) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert len(boxes(handle, model_id=model.id)) == 2


def test_suggestions_of_other_models_and_of_runs_are_left_alone(
    client, project_id, image_id, model, use_yolo, handle
):
    use_yolo()
    ids = classes(client, project_id)
    other = put_box(
        handle,
        image_id,
        ids["crane"],
        (900, 900, 50, 50),
        "unreviewed",
        provenance_kind="local_model",
        model_id="other",
    )
    run_box = put_box(
        handle,
        image_id,
        ids["crane"],
        (1200, 900, 50, 50),
        "unreviewed",
        provenance_kind="local_model",
        model_id=model.id,
        query_run_id="run-1",
    )
    detect(client, project_id, image_id, model_id=model.id)
    detect(client, project_id, image_id, model_id=model.id)
    assert boxes(handle, id=other) and boxes(handle, id=run_box)


def test_the_per_image_cap_keeps_the_most_confident(
    client, project_id, image_id, model, use_yolo, monkeypatch
):
    use_yolo()
    monkeypatch.setattr("app.imagery.annotations.PER_IMAGE_CAP", 1)
    body = detect(client, project_id, image_id, model_id=model.id).json()
    assert body["new"] == 1 and body["suggestions"][0]["confidence"] == pytest.approx(0.9)


# ------------------------------------------------------------------------------ shapes


def test_an_obb_model_gives_rotated_suggestions(client, app, tmp_path, project_id, image_id, use_yolo):
    m = add_library_model(app, tmp_path, name="obb", task="obb", class_names=["excavator"])
    use_yolo({0: "excavator"}, Result(obb=Obb([(500, 400, 120, 40, math.pi / 4, 0, 0.8)])))
    [s] = detect(client, project_id, image_id, model_id=m.id).json()["suggestions"]
    assert s["shape"] == "rbox" and s["angle"] == pytest.approx(45.0)
    assert (s["x"], s["y"], s["w"], s["h"]) == pytest.approx((440.0, 380.0, 120.0, 40.0))


def test_a_segmentation_model_gives_polygon_suggestions(
    client, app, tmp_path, project_id, image_id, use_yolo
):
    m = add_library_model(app, tmp_path, name="seg", task="segment", class_names=["excavator"])
    ring = [[100, 100], [300, 100], [300, 250], [100, 250]]
    use_yolo({0: "excavator"}, Result(boxes=SegBoxes([0], [0.85]), masks=Masks([ring])))
    [s] = detect(client, project_id, image_id, model_id=m.id).json()["suggestions"]
    assert s["shape"] == "polygon" and len(s["points"]) == 4
    assert (s["x"], s["y"], s["w"], s["h"]) == (100, 100, 200, 150)


# --------------------------------------------------------------------- refusals before work


def test_nothing_mapped_is_422_unmapped_classes_before_any_work(
    client, app, tmp_path, project_id, image_id, use_yolo
):
    fake = use_yolo()
    m = add_library_model(app, tmp_path, name="odd", class_names=["zzz_not_a_type"])
    r = detect(client, project_id, image_id, model_id=m.id)
    assert r.status_code == 422 and r.json()["error"]["code"] == "unmapped_classes"
    assert r.json()["error"]["details"]["unmapped"] == ["zzz_not_a_type"]
    assert fake.calls == []


def test_some_unmapped_classes_are_skipped_not_refused(client, app, tmp_path, project_id, image_id, use_yolo):
    m = add_library_model(app, tmp_path, name="half", class_names=["zzz_not_a_type", "excavator"])
    use_yolo({0: "zzz_not_a_type", 1: "excavator"})
    body = detect(client, project_id, image_id, model_id=m.id).json()
    assert body["new"] == 1


def test_mapped_types_join_the_project_list(client, app, tmp_path, project_id, image_id, use_yolo):
    car = create_type(client, "Car")
    m = add_library_model(app, tmp_path, name="cars", class_names=["car"])
    use_yolo({0: "car"}, Result(boxes=[Row([10, 20, 110, 140], 0, 0.9)]))
    body = detect(client, project_id, image_id, model_id=m.id).json()
    assert body["new"] == 1
    assert classes(client, project_id)["Car"] == car["id"]


def test_missing_weights_is_409_model_unavailable_before_any_work(
    client, app, project_id, image_id, model, use_yolo
):
    fake = use_yolo()
    library.weights_file(app.state.library, model).unlink()
    r = detect(client, project_id, image_id, model_id=model.id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "model_unavailable"
    assert fake.calls == []


def test_an_unknown_image_or_model_is_a_404(client, project_id, image_id, model, use_yolo):
    use_yolo()
    assert detect(client, project_id, "nope", model_id=model.id).status_code == 404
    assert detect(client, project_id, image_id, model_id="nope").status_code == 404


# -------------------------------------------------------------------------------- tiling


def test_tiling_for_runs_a_frame_up_to_twice_imgsz_whole():
    assert tiling_for(2560, 1440, 1280).enabled is False
    spec = tiling_for(4000, 3000, 1280)
    assert spec.enabled and spec.tile_size == 1280 and len(make_tiles(4000, 3000, spec)) == 12


def test_tiling_for_caps_a_huge_frame_at_64_tiles():
    spec = tiling_for(40000, 30000, 640)
    assert spec.tile_size > 640
    assert len(make_tiles(40000, 30000, spec)) <= MAX_TILES
