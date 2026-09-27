"""Vector drawing tiles (spec §8.4, §13, §15 "vtile vertex cap and truncated; simplify tolerance";
plan Task 13). Site CRS 32633; z 12 = 0.25 m/px, tile (7813, -77860) spans E 500032..500096,
N 4982976..4983040."""

import numpy as np
import pytest
from design_dxf import new_doc, save
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png

from app.drawings import runs, vtiles

TX, TY = 7813, -77860


def _drawing(client, project_id, wait_job, handle, tmp_path, fill, placement=None):
    seed_frame(handle, 32633)
    doc = new_doc()
    fill(doc.modelspace())
    insp = inspect_ready(client, project_id, wait_job, save(doc, tmp_path / "v.dxf"))
    return build_drawing(
        client,
        project_id,
        wait_job,
        insp["id"],
        placement=placement or {"method": "crs", "crs": "EPSG:32633"},
    )


def _tile(client, project_id, did, z, x, y, **q):
    return client.get(f"{BASE}/{project_id}/drawings/{did}/vtiles/{z}/{x}/{y}", params=q)


def test_a_line_comes_back_in_site_coordinates(client, project_id, wait_job, handle, tmp_path):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000), dxfattribs={"layer": "ROADS"}),
    )
    r = _tile(client, project_id, d["id"], 12, TX, TY, v=str(d["georef_version"]))
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    body = r.json()
    assert body["truncated"] is False
    assert body["layers"] == [
        {
            "name": "ROADS",
            "colour": d["layers"][0]["colour"],
            "lines": [[500040.0, 4983000.0, 500080.0, 4983000.0]],
        }
    ]
    assert "no-cache" in _tile(client, project_id, d["id"], 12, TX, TY, v="0").headers["cache-control"]


def test_long_lines_are_clipped_to_the_tile_plus_a_buffer(client, project_id, wait_job, handle, tmp_path):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((499000, 4983000), (501000, 4983000)),
    )
    line = _tile(client, project_id, d["id"], 12, TX, TY).json()["layers"][0]["lines"][0]
    xs = line[0::2]
    assert min(xs) >= 500032 - 0.02 * 64 - 1e-6 and max(xs) <= 500096 + 0.02 * 64 + 1e-6


def test_simplify_follows_the_zoom(client, project_id, wait_job, handle, tmp_path):
    zig = [(500040 + i * 0.05, 4983000 + (0.01 if i % 2 else 0)) for i in range(400)]
    d = _drawing(client, project_id, wait_job, handle, tmp_path, lambda m: m.add_lwpolyline(zig))
    coarse = _tile(client, project_id, d["id"], 12, TX, TY).json()["layers"][0]["lines"][0]
    assert len(coarse) == 4  # a 1 cm zigzag vanishes at 0.25 m/px
    x20, y20 = (
        int(np.floor(500045 / (256 * 1024 / 2**20))),
        int(np.floor(-4983000.005 / (256 * 1024 / 2**20))),
    )
    fine = _tile(client, project_id, d["id"], 20, x20, y20).json()["layers"][0]["lines"][0]
    assert len(fine) >= 12  # at ~1 mm/px the zigzag's 6+ vertices in this 25 cm tile are kept


def test_the_vertex_cap_drops_the_shortest_first(client, project_id, wait_job, handle, tmp_path):
    def fill(m):
        m.add_circle((500064, 4983008), 30, dxfattribs={"layer": "BIG"})
        for i in range(80):
            for j in range(60):  # 4 800 circles of >= 5 vertices each after simplify: > 20 000
                m.add_circle((500034 + i * 0.75, 4982978 + j * 0.75), 1.0, dxfattribs={"layer": "SMALL"})

    d = _drawing(client, project_id, wait_job, handle, tmp_path, fill)
    body = _tile(client, project_id, d["id"], 12, TX, TY).json()
    total = sum(len(ln) // 2 for layer in body["layers"] for ln in layer["lines"])
    assert body["truncated"] is True and total <= vtiles.MAX_OUT
    assert "BIG" in [layer["name"] for layer in body["layers"]]


def test_the_read_budget_keeps_the_longest_runs(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    def fill(m):
        m.add_line((500033, 4983000), (500095, 4983000), dxfattribs={"layer": "LONG"})
        for i in range(50):
            m.add_line(
                (500040 + i * 0.5, 4982990), (500040 + i * 0.5, 4982991), dxfattribs={"layer": "SHORT"}
            )

    d = _drawing(client, project_id, wait_job, handle, tmp_path, fill)
    monkeypatch.setattr(vtiles, "MAX_READ", 10)
    body = _tile(client, project_id, d["id"], 12, TX, TY).json()
    assert body["truncated"] is True and [layer["name"] for layer in body["layers"]][0] == "LONG"


def test_sub_pixel_runs_are_dropped(client, project_id, wait_job, handle, tmp_path):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500040.05, 4983000)),
    )
    assert _tile(client, project_id, d["id"], 12, TX, TY).status_code == 204  # nothing visible at 0.25 m/px
    span20 = 256 * 1024 / 2**20  # 0.25 m
    x20, y20 = int(np.floor(500040.02 / span20)), int(np.floor(-4983000.0 / span20))
    assert _tile(client, project_id, d["id"], 20, x20, y20).json()["layers"]  # 5 cm is 51 px at z 20


def test_labels_appear_when_they_are_six_pixels_tall(client, project_id, wait_job, handle, tmp_path):
    def fill(m):
        m.add_line((500040, 4983000), (500080, 4983000))
        m.add_text("GATE", height=2.0, rotation=15, dxfattribs={"layer": "TXT"}).set_placement(
            (500050, 4983010)
        )

    d = _drawing(client, project_id, wait_job, handle, tmp_path, fill)
    labels = _tile(client, project_id, d["id"], 12, TX, TY).json()["labels"]
    assert labels == [
        {"text": "GATE", "x": 500050.0, "y": 4983010.0, "height_m": 2.0, "rotation": 15.0, "layer": "TXT"}
    ]
    low = _tile(client, project_id, d["id"], 10, 500032 // 256, -4983040 // 256).json()["labels"]
    assert low == []  # 2 m at 1 m/px is 2 px


def test_one_bucket_lookup_per_tile(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000)),
    )
    calls = []
    real = runs.BucketIndex.query
    monkeypatch.setattr(runs.BucketIndex, "query", lambda self, box: calls.append(box) or real(self, box))
    _tile(client, project_id, d["id"], 12, TX, TY)
    assert len(calls) == 1


def test_preview_unplaced_and_refusals(client, project_id, wait_job, handle, tmp_path):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((40, 0), (80, 0)),
        placement={"method": "none"},
    )
    r = _tile(client, project_id, d["id"], 12, TX, TY)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_placed"
    r = _tile(client, project_id, d["id"], 12, TX, TY, t="1,0,500000,0,1,4983000")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json()["layers"][0]["lines"] == [[500040.0, 4983000.0, 500080.0, 4983000.0]]
    bad = _tile(client, project_id, d["id"], 12, TX, TY, t="1,2,3")
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_preview"


def test_raster_drawings_other_frames_and_unknown_ids(client, project_id, wait_job, handle, tmp_path):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000)),
    )
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 10, 10))
    png = build_drawing(client, project_id, wait_job, insp["id"])
    r = _tile(client, project_id, png["id"], 12, TX, TY)
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_vector"
    uid = "00000000-0000-4000-8000-000000000000"
    assert _tile(client, project_id, uid, 12, TX, TY).status_code == 404
    seed_frame(handle, None)
    r = _tile(client, project_id, d["id"], 12, TX, TY)
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_coordinates"


@pytest.mark.parametrize("z", [21, -1])
def test_zoom_out_of_range_is_rejected(client, project_id, wait_job, handle, tmp_path, z):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000)),
    )
    assert _tile(client, project_id, d["id"], z, 0, 0).status_code == 422


def _zigzag(n=100):
    return [(500035 + i * 0.5, 4983000 + (1.0 if i % 2 else 0.0)) for i in range(n)]


def test_a_run_over_the_read_budget_is_decimated_not_dropped(
    client, project_id, wait_job, handle, tmp_path, monkeypatch
):
    def fill(m):
        m.add_lwpolyline(_zigzag(), dxfattribs={"layer": "LONG"})
        m.add_line((500040, 4982990), (500041, 4982990), dxfattribs={"layer": "SHORT"})

    d = _drawing(client, project_id, wait_job, handle, tmp_path, fill)
    monkeypatch.setattr(vtiles, "MAX_READ", 10)
    r = _tile(client, project_id, d["id"], 12, TX, TY)
    assert r.status_code == 200
    body = r.json()
    by_name = {layer["name"]: layer["lines"] for layer in body["layers"]}
    assert body["truncated"] is True and set(by_name) == {"LONG", "SHORT"}
    long_line = by_name["LONG"][0]
    assert 4 <= len(long_line) <= 2 * 10  # decimated to fit the budget
    assert long_line[:2] == [500035.0, 4983000.0]  # first vertex kept
    assert long_line[-2:] == [500035 + 99 * 0.5, 4983001.0]  # last vertex kept


def test_a_part_over_the_output_cap_is_decimated_not_dropped(
    client, project_id, wait_job, handle, tmp_path, monkeypatch
):
    def fill(m):
        m.add_lwpolyline(_zigzag(), dxfattribs={"layer": "LONG"})
        m.add_line((500040, 4982990), (500041, 4982990), dxfattribs={"layer": "SHORT"})

    d = _drawing(client, project_id, wait_job, handle, tmp_path, fill)
    monkeypatch.setattr(vtiles, "MAX_OUT", 20)
    body = _tile(client, project_id, d["id"], 12, TX, TY).json()
    by_name = {layer["name"]: layer["lines"] for layer in body["layers"]}
    assert body["truncated"] is True and set(by_name) == {"LONG", "SHORT"}
    total = sum(len(ln) // 2 for lines in by_name.values() for ln in lines)
    assert total <= 20 and len(by_name["LONG"][0]) >= 4


def test_a_truncated_empty_tile_is_200_not_204(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000)),
    )
    monkeypatch.setattr(vtiles, "MAX_READ", 1)
    r = _tile(client, project_id, d["id"], 12, TX, TY)
    assert r.status_code == 200 and r.json() == {"layers": [], "labels": [], "truncated": True}


def test_a_vanished_folder_is_404(client, project_id, wait_job, handle, tmp_path):
    import shutil

    from app.drawings import store

    d = _drawing(
        client,
        project_id,
        wait_job,
        handle,
        tmp_path,
        lambda m: m.add_line((500040, 4983000), (500080, 4983000)),
    )
    shutil.rmtree(store.drawing_dir(handle, d["id"]))
    assert _tile(client, project_id, d["id"], 12, TX, TY).status_code == 404
