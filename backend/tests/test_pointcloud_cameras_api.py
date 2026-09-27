"""getCloudCameras and setCloudCameraOffset (spec 2026-09-26-point-cloud-workspace sections 10.1, 12
rows 11-12, 13, 14, 15 "Cameras")."""

import builtins
import io
import math
from datetime import UTC, datetime, timedelta
from itertools import count
from pathlib import Path

import PIL.Image as pil_image
import pytest
import yaml
from pointclouds import insert_cloud
from pyproj import CRS, Transformer
from sqlalchemy import insert, select

from app.db.models import Image, Source
from app.pointclouds import cameras
from app.pointclouds.crs import bounds_wgs84

BASE = "/api/v1/projects"
SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
UTM39 = CRS.from_epsg(32639)
# The fixture cloud (tests/pointclouds.py::insert_cloud): 100 x 100 m in UTM 39N, so the buffer is 100 m.
MINLON, MINLAT, MAXLON, MAXLAT = 48.3744, 28.7038, 48.3755, 28.7048
MID_LON, MID_LAT = (MINLON + MAXLON) / 2, (MINLAT + MAXLAT) / 2
T0 = datetime(2026, 9, 14, 9, 0, tzinfo=UTC)
_names = count()


def add_set(handle, *, label=None, site="North yard", folder="D:/flights/2026-09-14", kind="images") -> str:
    with handle.session() as s:
        src = Source(folder=folder, site=site, label=label, kind=kind)
        s.add(src)
        s.flush()
        return src.id


def add_photo(
    handle, source_id, lon=MID_LON, lat=MID_LAT, alt=50.0, *, minutes=0, width=4000, height=3000, **pose
) -> str:
    """One `image` row with GPS (and I's pose columns from `pose`); no file is written."""
    with handle.session() as s:
        row = Image(
            path=f"images/p{next(_names)}.jpg",
            width=width,
            height=height,
            source_id=source_id,
            lat=lat,
            lon=lon,
            alt=alt,
            capture_time=T0 + timedelta(minutes=minutes),
            **pose,
        )
        s.add(row)
        s.flush()
        return row.id


def url(project_id, cloud_id) -> str:
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/cameras"


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _true_north_bearing(lon: float, lat: float) -> float:
    t = Transformer.from_crs(4326, 32639, always_xy=True)
    x0, y0 = t.transform(lon, lat)
    x1, y1 = t.transform(lon, lat + 1e-3)
    return math.degrees(math.atan2(x1 - x0, y1 - y0))


# ------------------------------------------------------------------------------ Task 2: GET


def test_a_photo_is_reprojected_like_an_independent_pyproj_call(client, project_id, cloud_id, handle):
    src = add_set(handle)
    image_id = add_photo(handle, src, lon=48.37501, lat=28.70431, alt=61.2)
    r = client.get(url(project_id, cloud_id))
    assert r.status_code == 200, r.text
    body = r.json()
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:32639", always_xy=True).transform(48.37501, 28.70431)
    assert body["image_id"] == [image_id] and body["source_idx"] == [0]
    assert body["x"][0] == pytest.approx(x, abs=1e-3) and body["y"][0] == pytest.approx(y, abs=1e-3)
    assert body["z"] == [pytest.approx(61.2)]
    assert body["sigma_m"] == [3.0] and body["width"] == [4000] and body["height"] == [3000]
    assert body["truncated"] is False


def test_grid_yaw_uses_the_meridian_convergence(client, project_id, cloud_id, handle):
    src = add_set(handle)
    add_photo(handle, src, gimbal_yaw=0.0, gimbal_pitch=-45.0, gimbal_roll=1.5)
    add_photo(handle, src, minutes=1, gimbal_yaw=90.0, gimbal_pitch=-45.0)
    body = client.get(url(project_id, cloud_id)).json()
    bearing = _true_north_bearing(MID_LON, MID_LAT)  # about +1.26 deg west of the central meridian
    assert body["yaw"] == [pytest.approx(bearing, abs=1e-3), pytest.approx(90.0 + bearing, abs=1e-3)]
    assert body["pitch"] == [-45.0, -45.0] and body["roll"] == [1.5, 0.0]
    assert body["sources"][0]["posed_count"] == 2


def test_the_yaw_rule_falls_back_to_flight_yaw_near_nadir(client, project_id, cloud_id, handle):
    src = add_set(handle)
    add_photo(handle, src, gimbal_yaw=170.0, gimbal_pitch=-89.0, flight_yaw=10.0)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["yaw"][0] == pytest.approx(10.0 + _true_north_bearing(MID_LON, MID_LAT), abs=1e-3)


def test_fov_from_the_lens_else_assumed(client, project_id, cloud_id, handle):
    src = add_set(handle)
    add_photo(handle, src, width=5472, height=3648, focal_mm=8.8, sensor_w_mm=36 * 8.8 / 24)
    add_photo(handle, src, minutes=1)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["fov_assumed"] == [False, True]
    assert body["hfov"][0] == pytest.approx(2 * math.degrees(math.atan(36 / 48)), abs=1e-3)
    assert body["hfov"][1] == pytest.approx(
        2 * math.degrees(math.atan(math.tan(math.radians(42)) * 0.8)), abs=1e-3
    )


def test_position_only_cameras_have_a_null_pose(client, project_id, cloud_id, handle):
    src = add_set(handle)
    add_photo(handle, src, gimbal_yaw=12.0)  # a yaw without a pitch is not a pose
    body = client.get(url(project_id, cloud_id)).json()
    assert (body["yaw"], body["pitch"], body["roll"]) == ([None], [None], [None])
    assert body["sources"][0]["posed_count"] == 0 and body["sources"][0]["count"] == 1


def test_without_pose_columns_every_camera_is_position_only(
    client, project_id, cloud_id, handle, monkeypatch
):
    src = add_set(handle)
    add_photo(handle, src, gimbal_yaw=0.0, gimbal_pitch=-90.0, focal_mm=8.8, sensor_w_mm=13.2)
    monkeypatch.setattr(cameras, "POSE_COLUMNS", {})  # I's columns absent (spec section 14)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["yaw"] == [None] and body["fov_assumed"] == [True]


def test_the_buffer_filter(client, project_id, cloud_id, handle):
    src = add_set(handle)
    inside = add_photo(handle, src, lat=MAXLAT + 0.0008)  # 89 m north: inside the 100 m buffer
    add_photo(handle, src, lat=MAXLAT + 0.0010, minutes=1)  # 111 m north: outside
    add_photo(handle, src, lon=MAXLON + 0.05, minutes=2)  # 5 km east
    add_photo(handle, src, lat=None, lon=None, minutes=3)  # no GPS: excluded
    tiles = add_set(handle, kind="map")
    add_photo(handle, tiles, minutes=4)  # a map source's rows are not drone photos
    body = client.get(url(project_id, cloud_id)).json()
    assert body["image_id"] == [inside]


def test_a_large_cloud_buffers_by_half_its_diagonal(client, project_id, handle):
    native = [243500.0, 3178000.0, -45.0, 244500.0, 3179000.0, 175.0]
    wgs84 = bounds_wgs84(native, UTM39.to_wkt())
    big = insert_cloud(handle, bounds_native=native, bounds_wgs84=wgs84)
    src = add_set(handle)
    near = add_photo(handle, src, lon=(wgs84[0] + wgs84[2]) / 2, lat=wgs84[3] + 600 / 111_320)  # 600 < 707 m
    add_photo(handle, src, lon=(wgs84[0] + wgs84[2]) / 2, lat=wgs84[3] + 800 / 111_320, minutes=1)
    assert client.get(url(project_id, big)).json()["image_id"] == [near]


def test_the_cap_keeps_the_first_20000_by_capture_time(client, project_id, cloud_id, handle):
    assert cameras.CAP == 20_000
    src = add_set(handle)
    rows = [
        dict(
            path=f"images/c{i}.jpg",
            width=4000,
            height=3000,
            source_id=src,
            lat=MID_LAT,
            lon=MID_LON,
            alt=50.0,
            capture_time=T0 + timedelta(seconds=i),
        )
        for i in range(cameras.CAP + 1)
    ]
    with handle.session() as s:
        s.execute(insert(Image), rows)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["truncated"] is True and len(body["image_id"]) == cameras.CAP
    with handle.session() as s:
        last = s.execute(select(Image.id).where(Image.path == f"images/c{cameras.CAP}.jpg")).scalar_one()
        first = s.execute(select(Image.id).where(Image.path == "images/c0.jpg")).scalar_one()
    assert last not in body["image_id"] and body["image_id"][0] == first
    assert body["sources"][0]["count"] == cameras.CAP
    assert all(len(body[k]) == cameras.CAP for k in ("x", "y", "z", "yaw", "hfov", "fov_assumed", "sigma_m"))


def test_order_is_capture_time_with_undated_photos_last(client, project_id, cloud_id, handle):
    src = add_set(handle)
    late = add_photo(handle, src, minutes=5)
    early = add_photo(handle, src, minutes=1)
    with handle.session() as s:
        undated = Image(
            path="images/undated.jpg", width=4000, height=3000, source_id=src, lat=MID_LAT, lon=MID_LON
        )
        s.add(undated)
        s.flush()
        undated_id = undated.id
    assert client.get(url(project_id, cloud_id)).json()["image_id"] == [early, late, undated_id]


def test_a_null_alt_gives_a_null_z(client, project_id, cloud_id, handle):
    src = add_set(handle)
    add_photo(handle, src, alt=None)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["z"] == [None]
    assert (body["z_p1"], body["z_p99"]) == (-44.0, 170.0)  # the fixture's z_stats, echoed


def test_sources_are_listed_in_first_appearance_with_their_labels(client, project_id, cloud_id, handle):
    named = add_set(handle, label="Flight 14 Sep")
    by_site = add_set(handle, site="South gate")
    by_folder = add_set(handle, site="", folder="D:\\flights\\2026-09-15")
    add_photo(handle, by_site, minutes=0)
    add_photo(handle, named, minutes=1, gimbal_yaw=0.0, gimbal_pitch=-90.0)
    add_photo(handle, by_site, minutes=2)
    add_photo(handle, by_folder, minutes=3)
    body = client.get(url(project_id, cloud_id)).json()
    assert [
        (s["id"], s["label"], s["count"], s["posed_count"], s["height_offset_m"]) for s in body["sources"]
    ] == [
        (by_site, "South gate", 2, 0, 0.0),
        (named, "Flight 14 Sep", 1, 1, 0.0),
        (by_folder, "2026-09-15", 1, 0, 0.0),
    ]
    assert body["source_idx"] == [0, 1, 0, 2]


def test_a_source_with_no_surviving_camera_is_not_listed(client, project_id, cloud_id, handle, monkeypatch):
    """A camera whose reprojection is non-finite is skipped; if that was a set's only camera, the set
    must not appear in `sources` with count 0 (C-B3 Ruling 9 / final-review fix 2)."""
    dropped = add_set(handle, site="Dropped")
    kept = add_set(handle, site="Kept")
    add_photo(handle, dropped, minutes=0)
    add_photo(handle, kept, minutes=1)

    real_from_crs = cameras.Transformer.from_crs

    class FakeTransformer:
        def __init__(self, real):
            self._real = real

        def transform(self, lons, lats):
            xs, ys = self._real.transform(lons, lats)
            xs = list(xs)
            xs[0] = float("nan")  # the first camera (dropped's only photo) is outside the CRS's domain
            return xs, ys

    def fake_from_crs(*args, **kwargs):
        return FakeTransformer(real_from_crs(*args, **kwargs))

    monkeypatch.setattr(cameras, "Transformer", type("T", (), {"from_crs": staticmethod(fake_from_crs)}))
    body = client.get(url(project_id, cloud_id)).json()
    assert [s["id"] for s in body["sources"]] == [kept]
    assert body["source_idx"] == [0]
    assert len(body["image_id"]) == 1  # only the kept set's camera survives


def test_non_positive_width_or_height_is_skipped(client, project_id, cloud_id, handle):
    """fov_deg divides by the frame's dimensions; a junk width or height of 0 must not 500 (C-B3
    final-review fix 3)."""
    src = add_set(handle)
    bad = add_photo(handle, src, width=0, height=0, minutes=0)
    good = add_photo(handle, src, minutes=1)
    r = client.get(url(project_id, cloud_id))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["image_id"] == [good]
    assert bad not in body["image_id"]


def test_no_photos_near_the_cloud_is_an_empty_set(client, project_id, cloud_id):
    body = client.get(url(project_id, cloud_id)).json()
    assert body["image_id"] == [] and body["sources"] == [] and body["truncated"] is False


@pytest.mark.parametrize(
    ("fields", "status", "code"),
    [
        ({"crs_wkt": None, "epsg": None, "proj4": None}, 409, "needs_coordinates"),
        ({"bounds_wgs84": None}, 409, "needs_coordinates"),
        ({"crs_wkt": CRS.from_epsg(4326).to_wkt(), "epsg": 4326}, 409, "needs_coordinates"),
        ({"status": "importing"}, 409, "not_ready"),
    ],
)
def test_clouds_that_cannot_place_photos_are_refused(client, project_id, handle, fields, status, code):
    cid = insert_cloud(handle, **fields)
    r = client.get(url(project_id, cid))
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_an_unknown_cloud_is_404(client, project_id):
    r = client.get(url(project_id, "nope"))
    assert (r.status_code, r.json()["error"]["code"]) == (404, "not_found")


def test_the_query_opens_no_image_file(client, project_id, cloud_id, handle, monkeypatch):
    src = add_set(handle)
    for i in range(3):
        add_photo(handle, src, minutes=i)
    opened: list[str] = []
    real_open = builtins.open

    def spy(file, *args, **kwargs):
        opened.append(str(file))
        return real_open(file, *args, **kwargs)

    def no_pil(*args, **kwargs):
        raise AssertionError("an image file was opened")

    monkeypatch.setattr(builtins, "open", spy)
    monkeypatch.setattr(io, "open", spy)
    monkeypatch.setattr(pil_image, "open", no_pil)
    r = client.get(url(project_id, cloud_id))
    assert r.status_code == 200 and len(r.json()["image_id"]) == 3
    assert not [p for p in opened if p.lower().endswith((".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng"))]


def test_the_payload_validates_against_the_contract(client, project_id, cloud_id, handle):
    import jsonschema_rs  # schemathesis's validator; the pure-Python jsonschema is not installed

    src = add_set(handle, label="Flight 14 Sep")
    add_photo(handle, src, gimbal_yaw=10.0, gimbal_pitch=-60.0, focal_px=3713.3, orig_w=5280, orig_h=3956)
    add_photo(handle, src, alt=None, minutes=1)
    body = client.get(url(project_id, cloud_id)).json()
    components = yaml.safe_load(SPEC.read_text("utf-8"))["components"]
    schema = {"$ref": "#/components/schemas/CloudCameraSet", "components": components}
    jsonschema_rs.Draft202012Validator(schema, validate_formats=True).validate(body)


def test_without_gps_counts_images_with_no_position(client, project_id, cloud_id, handle):
    src = add_set(handle)
    inside = add_photo(handle, src)
    no_gps = add_photo(handle, src, lat=None, lon=None, minutes=1)
    tiles = add_set(handle, kind="map")
    add_photo(handle, tiles, lat=None, lon=None, minutes=2)  # a map tile without GPS is not a photo
    body = client.get(url(project_id, cloud_id)).json()
    assert body["without_gps"] == 1
    assert body["image_id"] == [inside] and no_gps not in body["image_id"]


# ------------------------------------------------------------------------------ Task 3: PUT


def off_url(project_id, cloud_id, source_id) -> str:
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/cameras/offsets/{source_id}"


def test_an_offset_moves_the_set_and_answers_it(client, project_id, cloud_id, handle, app):
    src = add_set(handle, label="Flight 14 Sep")
    add_photo(handle, src, alt=50.0, gimbal_yaw=0.0, gimbal_pitch=-90.0)
    add_photo(handle, src, alt=None, minutes=1)
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    r = client.put(off_url(project_id, cloud_id, src), json={"height_offset_m": -31.5})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "id": src,
        "label": "Flight 14 Sep",
        "count": 2,
        "height_offset_m": -31.5,
        "posed_count": 1,
    }
    assert any(e["type"] == "pointclouds.changed" and e["payload"] == {"cloud_ids": [cloud_id]} for e in seen)
    body = client.get(url(project_id, cloud_id)).json()
    assert body["z"] == [pytest.approx(18.5), None]
    assert body["sources"][0]["height_offset_m"] == -31.5
    assert client.put(off_url(project_id, cloud_id, src), json={"height_offset_m": 0}).status_code == 200
    assert client.get(url(project_id, cloud_id)).json()["z"] == [pytest.approx(50.0), None]
    with handle.session() as s:
        from app.db.models import CloudCameraOffset

        assert s.query(CloudCameraOffset).count() == 1  # the second PUT replaced the first


def test_an_offset_is_per_cloud(client, project_id, cloud_id, handle):
    other = insert_cloud(handle, name="Other")
    src = add_set(handle)
    add_photo(handle, src, alt=50.0)
    client.put(off_url(project_id, cloud_id, src), json={"height_offset_m": 10})
    assert client.get(url(project_id, other)).json()["z"] == [pytest.approx(50.0)]
    assert client.get(url(project_id, cloud_id)).json()["z"] == [pytest.approx(60.0)]


@pytest.mark.parametrize("value", [-500, 500])
def test_the_range_ends_are_accepted(client, project_id, cloud_id, handle, value):
    src = add_set(handle)
    r = client.put(off_url(project_id, cloud_id, src), json={"height_offset_m": value})
    assert r.status_code == 200 and r.json()["height_offset_m"] == value


@pytest.mark.parametrize(
    "body", [{"height_offset_m": -500.01}, {"height_offset_m": 500.01}, {}, {"height_offset_m": 1, "x": 2}]
)
def test_out_of_range_or_malformed_is_422(client, project_id, cloud_id, handle, body):
    src = add_set(handle)
    r = client.put(off_url(project_id, cloud_id, src), json=body)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")


def test_an_unknown_set_or_cloud_is_404(client, project_id, cloud_id, handle):
    src = add_set(handle)
    for path in (off_url(project_id, cloud_id, "nope"), off_url(project_id, "nope", src)):
        r = client.put(path, json={"height_offset_m": 1})
        assert (r.status_code, r.json()["error"]["code"]) == (404, "not_found")


def test_a_set_with_no_photos_here_is_stored_with_zero_counts(client, project_id, cloud_id, handle):
    src = add_set(handle, site="Elsewhere")
    add_photo(handle, src, lon=MAXLON + 0.05)  # 5 km away
    r = client.put(off_url(project_id, cloud_id, src), json={"height_offset_m": 2.5})
    assert r.json() == {"id": src, "label": "Elsewhere", "count": 0, "height_offset_m": 2.5, "posed_count": 0}


def test_an_offset_on_a_cloud_without_coordinates_is_stored(client, project_id, handle):
    cid = insert_cloud(handle, crs_wkt=None, epsg=None, proj4=None)
    src = add_set(handle)
    add_photo(handle, src)
    r = client.put(off_url(project_id, cid, src), json={"height_offset_m": -3})
    assert r.status_code == 200 and (r.json()["count"], r.json()["height_offset_m"]) == (0, -3)
