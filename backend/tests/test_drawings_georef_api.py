"""Georeferencing a drawing by control points (spec §8.3; plan Task 7)."""

import pytest
import rasterio
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png
from pyproj import CRS

from app.db.models import Drawing
from app.drawings import georef, store

# Four corners of a 1100 x 700 px scan (src = col, -row) -> a 0.1 m/px north-up placement; p4 is 5 cm off.
PAIRS = [
    {"id": "p1", "src": [0, 0], "dst": [500000.0, 4983000.0]},
    {"id": "p2", "src": [1100, 0], "dst": [500110.0, 4983000.0]},
    {"id": "p3", "src": [1100, -700], "dst": [500110.0, 4982930.0]},
    {"src": [0, -700], "dst": [500000.05, 4982930.0]},
]


@pytest.fixture
def scan(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "scan.png", 1100, 700))
    return build_drawing(client, project_id, wait_job, insp["id"])


def put(client, project_id, did, model, points):
    return client.put(
        f"{BASE}/{project_id}/drawings/{did}/georef",
        json={"model": model, "points": points, "dst_frame": "site"},
    )


def _fit(model, points, **kw):
    return georef.fit(model, [p["src"] for p in points], [p["dst"] for p in points], **kw)


def test_save_fits_stores_and_rewrites_plan_tif_in_place(client, project_id, handle, scan):
    seed_frame(handle, 32633)
    plan = store.plan_path(handle, scan["id"])
    with rasterio.open(plan) as p:
        overviews_before = p.overviews(1)
    r = put(client, project_id, scan["id"], "similarity", PAIRS)
    assert r.status_code == 200, r.text
    d = r.json()
    g, want = d["georef"], _fit("similarity", PAIRS)
    assert (
        g["method"] == "control_points"
        and g["model"] == "similarity"
        and g["crs_wkt"] is None
        and g["epsg"] is None
    )
    assert CRS.from_wkt(g["dst_crs_wkt"]).to_epsg() == 32633
    assert g["transform"] == pytest.approx(list(want.transform)) and g["rmse_m"] == pytest.approx(want.rmse_m)
    assert [p["id"] for p in g["points"]] == ["p1", "p2", "p3", "p4"] and len(g["residuals_m"]) == 4
    assert d["georef_version"] == 1 and d["bounds_site"][0] == pytest.approx(500000.0, abs=0.1)
    with rasterio.open(plan) as p:
        a, b, c, dd, e, f = want.transform
        assert tuple(p.transform)[:6] == pytest.approx((a, -b, c, dd, -e, f))
        assert p.crs.to_epsg() == 32633 and p.overviews(1) == overviews_before
    with rasterio.open(plan, overview_level=0) as o:
        assert o.read(1).shape == (350, 550)  # the first overview still reads
    again = put(client, project_id, scan["id"], "affine", PAIRS[:3]).json()
    assert again["georef_version"] == 2 and again["georef"]["rmse_m"] == 0.0


@pytest.mark.parametrize(
    ("model", "points", "code"),
    [
        (
            "similarity",
            [
                {"src": [0, 0], "dst": [0, 0]},
                {"src": [10, 0], "dst": [10, 0]},
                {"src": [0, 10], "dst": [0, -10]},
            ],
            "reflection",
        ),
        ("affine", [{"src": [i, i], "dst": [i, i]} for i in range(3)], "collinear"),
        ("affine", PAIRS[:2], "too_few_points"),
        ("similarity", [{"src": [5, 5], "dst": [0, 0]}, {"src": [5, 5], "dst": [1, 1]}], "degenerate"),
    ],
)
def test_refusals(client, project_id, handle, scan, model, points, code):
    seed_frame(handle, 32633)
    r = put(client, project_id, scan["id"], model, points)
    assert r.status_code == 422 and r.json()["error"]["code"] == code


def test_no_site_frame_and_not_ready_are_409(client, project_id, handle, scan):
    r = put(client, project_id, scan["id"], "similarity", PAIRS)
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_site_frame"  # until M-B1 (Task 16)
    seed_frame(handle, 32633)
    with handle.session() as s:
        s.get(Drawing, scan["id"]).status = "importing"
    r = put(client, project_id, scan["id"], "similarity", PAIRS)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    uid = "00000000-0000-4000-8000-000000000000"
    assert put(client, project_id, uid, "similarity", PAIRS).status_code == 404


def test_clear_returns_to_not_placed(client, project_id, handle, scan):
    seed_frame(handle, 32633)
    put(client, project_id, scan["id"], "similarity", PAIRS)
    r = client.delete(f"{BASE}/{project_id}/drawings/{scan['id']}/georef")
    assert r.status_code == 200
    d = r.json()
    assert d["georef"] is None and d["bounds_site"] is None and d["georef_version"] == 2
    with rasterio.open(store.plan_path(handle, scan["id"])) as p:
        assert p.transform.is_identity


def test_a_local_frame_stores_no_dst_crs(client, project_id, handle, scan):
    seed_frame(handle, None)
    d = put(client, project_id, scan["id"], "similarity", PAIRS).json()
    assert d["georef"]["dst_crs_wkt"] is None and d["bounds_site"] is not None


def test_residuals_are_metres_in_a_feet_frame(client, project_id, handle, scan):
    seed_frame(handle, 2263)  # US survey feet
    d = put(client, project_id, scan["id"], "similarity", PAIRS).json()
    assert d["georef"]["rmse_m"] == pytest.approx(_fit("similarity", PAIRS).rmse_m * 1200 / 3937)


def test_the_dry_run_fit_uses_the_same_maths(client, project_id):
    r = client.post(f"{BASE}/{project_id}/drawings/georef-fit", json={"model": "affine", "points": PAIRS})
    assert r.status_code == 200
    body, want = r.json(), _fit("affine", PAIRS)
    assert body["transform"] == pytest.approx(list(want.transform))
    assert body["rmse_m"] == pytest.approx(want.rmse_m)
    assert body["scale"] == pytest.approx(want.scale)
    assert body["rotation_deg"] == pytest.approx(want.rotation_deg)
    assert [w["code"] for w in body["warnings"]] == [w.code for w in want.warnings]
    mm = [{"src": [0, 0], "dst": [0, 0]}, {"src": [40000, 0], "dst": [40000, 0]}]
    r = client.post(
        f"{BASE}/{project_id}/drawings/georef-fit",
        json={"model": "similarity", "points": mm, "units": "millimetre"},
    )
    assert [w["code"] for w in r.json()["warnings"]] == ["scale_mismatch"]
    r = client.post(f"{BASE}/{project_id}/drawings/georef-fit", json={"model": "affine", "points": PAIRS[:2]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_few_points"


@pytest.mark.parametrize(
    "body",
    [
        {"model": "affine", "points": [{"src": [0, 0, 0], "dst": [0, 0]}, *PAIRS[1:]]},
        {"model": "affine", "points": [{"src": [0, 0], "dst": [1]}, *PAIRS[1:]]},
        {"model": "projective", "points": PAIRS},
    ],
)
def test_malformed_points_and_models_are_validation_errors(client, project_id, handle, scan, body):
    """georef.fit raises a bare ValueError on these; the schema must refuse them first (never a 500)."""
    seed_frame(handle, 32633)
    r = client.post(f"{BASE}/{project_id}/drawings/georef-fit", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.put(f"{BASE}/{project_id}/drawings/{scan['id']}/georef", json={**body, "dst_frame": "site"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
