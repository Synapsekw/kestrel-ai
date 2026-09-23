import pytest

from app.maps.scoring import ScoreBox, Zone, point_in_polygon, score, zone_of

EXC, TRK = "exc", "trk"
Z = [Zone("z1", [(0, 0), (1000, 0), (1000, 1000), (0, 1000)])]


def d(id, cls, x, y, conf=0.9, w=100, h=100):
    return ScoreBox(id, cls, x, y, w, h, conf)


def lab(id, cls, x, y, w=100, h=100):
    return ScoreBox(id, cls, x, y, w, h)


def test_point_in_polygon():
    tri = [(0, 0), (10, 0), (0, 10)]
    assert point_in_polygon(2, 2, tri) and not point_in_polygon(8, 8, tri)


def test_zone_uses_the_box_centre():
    assert zone_of(lab("a", EXC, 950, 100), Z) is None  # centre at x 1000 is on the edge: outside
    assert zone_of(lab("b", EXC, 940, 100), Z) == "z1"


def test_perfect_run():
    s = score([d("d1", EXC, 100, 100)], [lab("l1", EXC, 105, 100)], Z, 0.5)
    o = s["overall"]
    assert (o["tp"], o["fp"], o["fn"], o["precision"], o["recall"], o["f1"]) == (1, 0, 0, 1.0, 1.0, 1.0)
    assert (o["predicted"], o["actual"], o["count_error"], o["count_error_pct"]) == (1, 1, 0, 0.0)
    assert {(m["kind"], m["match"]) for m in s["matches"]} == {("detection", "tp"), ("label", "tp")}


def test_all_false_positives_and_all_missed():
    s = score([d("d1", EXC, 100, 100)], [lab("l1", EXC, 600, 600)], Z, 0.5)
    o = s["overall"]
    assert (o["tp"], o["fp"], o["fn"], o["precision"], o["recall"]) == (0, 1, 1, 0.0, 0.0)
    assert o["f1"] is None or o["f1"] == 0.0


def test_empty_run_has_undefined_precision():
    o = score([], [lab("l1", EXC, 100, 100)], Z, 0.5)["overall"]
    assert o["precision"] is None and o["recall"] == 0.0 and o["count_error"] == -1
    assert o["count_error_pct"] == pytest.approx(-100.0)


def test_class_confusion_is_one_fp_and_one_fn():
    s = score([d("d1", TRK, 100, 100)], [lab("l1", EXC, 100, 100)], Z, 0.5)
    rows = {r["class_id"]: r for r in s["per_class"]}
    assert rows[TRK]["fp"] == 1 and rows[EXC]["fn"] == 1


def test_highest_confidence_claims_the_label_first():
    dets = [d("low", EXC, 110, 100, conf=0.5), d("high", EXC, 100, 100, conf=0.95)]
    s = score(dets, [lab("l1", EXC, 100, 100)], Z, 0.5)
    by_id = {m["id"]: m["match"] for m in s["matches"] if m["kind"] == "detection"}
    assert by_id == {"high": "tp", "low": "fp"}


def test_iou_threshold_edge():
    # 100x100 boxes offset by 50 px on x: IoU = 5000 / 15000 = 0.333
    pair = ([d("d1", EXC, 150, 100)], [lab("l1", EXC, 100, 100)])
    assert score(*pair, Z, 0.33)["overall"]["tp"] == 1
    assert score(*pair, Z, 0.34)["overall"]["tp"] == 0


def test_boxes_outside_every_zone_do_not_count_and_zones_break_down():
    zones = Z + [Zone("z2", [(2000, 0), (3000, 0), (3000, 1000), (2000, 1000)])]
    dets = [d("in1", EXC, 100, 100), d("in2", EXC, 2100, 100), d("out", EXC, 5000, 5000)]
    labels = [lab("l1", EXC, 100, 100), lab("l2", EXC, 2500, 500)]
    s = score(dets, labels, zones, 0.5)
    assert s["overall"]["predicted"] == 2 and s["overall"]["actual"] == 2
    zrows = {r["zone_id"]: r for r in s["per_zone"]}
    assert zrows["z1"]["tp"] == 1 and zrows["z2"]["fp"] == 1 and zrows["z2"]["fn"] == 1
    assert "out" not in {m["id"] for m in s["matches"]}


def test_no_zones_scores_nothing():
    s = score([d("d1", EXC, 1, 1)], [lab("l1", EXC, 1, 1)], [], 0.5)
    assert s["has_zones"] is False and s["overall"]["predicted"] == 0
