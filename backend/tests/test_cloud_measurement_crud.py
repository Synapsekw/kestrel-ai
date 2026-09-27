"""C-B1: creating areas and rings vertical checks (workspace spec 2026-09-26 sections 8.1-8.3, 12
rows 3, 4, 7, 8): params round-trip, the 200-point cap, and each new 422 with its message."""

import math

import pytest
from pointclouds import insert_cloud
from pyproj import CRS

BASE = "/api/v1/projects"
P = lambda x, y, z, u=0.01, **kw: {"x": x, "y": y, "z": z, "uncertainty_m": u, **kw}  # noqa: E731
X0, Y0 = 243500.0, 3178000.0  # inside the fixture cloud's bounds (UTM 39N)


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def murl(project_id, cloud_id, mid=""):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/measurements" + (f"/{mid}" if mid else "")


def square(n=1.0, z=0.0):
    return [P(X0, Y0, z), P(X0 + n, Y0, z), P(X0 + n, Y0 + n, z), P(X0, Y0 + n, z)]


def ring(cx, cy, z, radius, k, group, u=0.01):
    return [
        P(
            cx + radius * math.cos(2 * math.pi * i / k),
            cy + radius * math.sin(2 * math.pi * i / k),
            z,
            u,
            group=group,
        )
        for i in range(k)
    ]


def test_an_area_is_saved_with_its_results_and_params(client, project_id, cloud_id):
    body = {"kind": "area", "points": square(2.0), "params": {"mode": "plan", "view_dir": [0, 0, -1]}}
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 201, r.text
    m = r.json()
    assert (m["kind"], m["name"], m["status"]) == ("area", "Area 1", "ready")
    assert (m["error"], m["job_id"], m["finding_id"]) == (None, None, None)
    assert m["params"] == {
        "mode": "plan",
        "method": None,
        "thickness_m": None,
        "max_points": None,
        "view_dir": [0, 0, -1],
    }
    res = m["results"]
    assert res["area_m2"] == pytest.approx(4.0) and res["area_surface_m2"] == pytest.approx(4.0)
    assert res["perimeter_m"] == pytest.approx(8.0) and res["uncertainty_m2"] == pytest.approx(0.08)
    assert res["plane_azimuth_deg"] is None and res["distance_3d"] is None
    assert [p.get("group") for p in m["points"]] == [None] * 4
    listed = client.get(murl(project_id, cloud_id)).json()["items"]
    assert [i["id"] for i in listed] == [m["id"]] and listed[0]["params"] == m["params"]
    assert client.post(murl(project_id, cloud_id), json=body).json()["name"] == "Area 2"


def test_the_closing_vertex_is_not_stored_twice(client, project_id, cloud_id):
    """Review Focus 1."""
    pts = square() + [P(X0, Y0, 0.0)]
    m = client.post(murl(project_id, cloud_id), json={"kind": "area", "points": pts}).json()
    assert len(m["points"]) == 4 and m["results"]["area_m2"] == pytest.approx(1.0)
    assert m["params"] is None


def test_a_rings_vertical_check_keeps_its_groups(client, project_id, cloud_id):
    top = X0 + 30 * math.tan(math.radians(0.5))
    pts = ring(X0, Y0, 0.0, 3.0, 8, 0) + ring(top, Y0, 30.0, 2.5, 8, 1)
    r = client.post(
        murl(project_id, cloud_id), json={"kind": "vertical", "points": pts, "params": {"method": "rings"}}
    )
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["name"] == "Vertical check 1" and m["params"]["method"] == "rings"
    assert [p["group"] for p in m["points"]] == [0] * 8 + [1] * 8
    res = m["results"]
    assert res["lean_angle_deg"] == pytest.approx(0.5, abs=1e-6)  # picks at UTM magnitudes
    assert res["ring_radius_lower_m"] == pytest.approx(3.0) and res["ring_radius_upper_m"] == pytest.approx(
        2.5
    )


def test_group_is_dropped_for_every_other_kind(client, project_id, cloud_id):
    pts = [P(X0, Y0, 0.0, group=0), P(X0 + 3, Y0 + 4, 0.0, group=1)]
    m = client.post(murl(project_id, cloud_id), json={"kind": "distance", "points": pts}).json()
    assert m["results"]["distance_3d"] == pytest.approx(5.0)
    assert all(p["group"] is None for p in m["points"])


def test_a_vertical_without_rings_is_the_s1_two_point_check(client, project_id, cloud_id):
    body = {"kind": "vertical", "points": [P(X0, Y0, 60), P(X0, Y0 + 0.1, 0)], "params": {"method": "points"}}
    m = client.post(murl(project_id, cloud_id), json=body).json()
    assert [p["z"] for p in m["points"]] == [0, 60] and m["results"]["ring_radius_lower_m"] is None


REFUSALS = [
    (
        {"kind": "area", "points": [P(X0, Y0, 0), P(X0 + 1, Y0, 0)]},
        "wrong_point_count",
        "an area needs 3 to 200 vertices",
    ),
    (
        {"kind": "area", "points": [P(X0, Y0, 0), P(X0 + 3, Y0 + 2, 0), P(X0 + 3, Y0, 0), P(X0, Y0 + 1, 0)]},
        "self_intersecting",
        "the outline crosses itself; pick the vertices in order around the area",
    ),
    (
        {"kind": "area", "points": [P(X0, Y0, 0), P(X0 + 1, Y0, 0), P(X0 + 2, Y0, 0)]},
        "degenerate_polygon",
        "the outline has no area (less than 1 cm²); pick vertices around a surface",
    ),
    (
        {
            "kind": "vertical",
            "params": {"method": "rings"},
            "points": ring(X0, Y0, 0, 3, 2, 0) + ring(X0, Y0, 10, 3, 4, 1),
        },
        "ring_needs_three_points",
        "each ring needs at least three picks (press N to start the upper ring)",
    ),
    (
        {
            "kind": "vertical",
            "params": {"method": "rings"},
            "points": [P(X0, Y0, 0, group=0), P(X0 + 1, Y0 + 1, 0, group=0), P(X0 + 2, Y0 + 2, 0, group=0)]
            + ring(X0, Y0, 10, 3, 3, 1),
        },
        "collinear_ring",
        "the picks on a ring lie in a line; pick points spread around the ring",
    ),
    (
        {
            "kind": "vertical",
            "params": {"method": "rings"},
            "points": ring(X0, Y0, 0, 3, 3, 0) + ring(X0, Y0, 0.3, 3, 3, 1),
        },
        "vertical_span_too_small",
        "pick points further apart vertically (at least 0.5 m)",
    ),
    (
        {
            "kind": "vertical",
            "params": {"method": "rings"},
            "points": ring(X0, Y0, 0, 3, 33, 0) + ring(X0, Y0, 9, 3, 32, 1),
        },
        "wrong_point_count",
        "a rings vertical check takes 6 to 64 picks",
    ),
]


@pytest.mark.parametrize(
    ("body", "code", "message"), REFUSALS, ids=[f"{c}-{i}" for i, (_, c, _) in enumerate(REFUSALS)]
)
def test_each_new_refusal_names_its_fix(client, project_id, cloud_id, body, code, message):
    r = client.post(murl(project_id, cloud_id), json=body)
    assert r.status_code == 422, r.text
    assert (r.json()["error"]["code"], r.json()["error"]["message"]) == (code, message)
    assert client.get(murl(project_id, cloud_id)).json()["items"] == []


def test_two_hundred_vertices_is_the_cap(client, project_id, cloud_id):
    circle = [
        P(X0 + 10 * math.cos(2 * math.pi * k / 200), Y0 + 10 * math.sin(2 * math.pi * k / 200), 5.0)
        for k in range(200)
    ]
    r = client.post(murl(project_id, cloud_id), json={"kind": "area", "points": circle})
    assert r.status_code == 201, r.text
    assert len(r.json()["points"]) == 200
    r = client.post(murl(project_id, cloud_id), json={"kind": "area", "points": circle + [P(X0, Y0, 5.0)]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"  # the contract's maxItems


def test_an_area_on_a_cloud_in_degrees_is_refused(client, project_id, handle):
    wgs = CRS.from_epsg(4326)
    geo = insert_cloud(handle, crs_wkt=wgs.to_wkt(), epsg=4326, proj4=wgs.to_proj4())
    pts = [P(48.1, 28.1, 0), P(48.2, 28.1, 0), P(48.2, 28.2, 0)]
    r = client.post(murl(project_id, geo), json={"kind": "area", "points": pts})
    assert r.status_code == 422 and r.json()["error"]["code"] == "needs_projected_crs"


def test_huge_coordinates_answer_422_not_500(client, project_id, cloud_id):
    """Review Focus 2."""
    big = 1e200
    pts = [P(big, big, 0), P(-big, big, 0), P(-big, -big, 0), P(big, -big, 1)]
    r = client.post(murl(project_id, cloud_id), json={"kind": "area", "points": pts})
    assert r.status_code == 422 and r.json()["error"]["code"] == "degenerate_polygon"


def test_a_profile_is_not_creatable_until_c_b2(client, project_id, cloud_id):
    """Ruling 11: until the profile seam lands (Task 6), `profile` is not a creatable kind."""
    from app.pointclouds.schemas import CreatableCloudMeasurementKind

    if "profile" in CreatableCloudMeasurementKind.__args__:
        pytest.skip("C-B2 is merged: the profile seam is tested in test_cloud_measurement_profile_seam.py")
    r = client.post(
        murl(project_id, cloud_id), json={"kind": "profile", "points": [P(X0, Y0, 0), P(X0 + 5, Y0, 0)]}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
