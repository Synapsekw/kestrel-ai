"""R3: elevation and pair snapshots (spec 2026-09-26-reports §9.3, §16, §17): the hillshade, the
nodata edge, the common bbox in metres, the swipe/side-by-side composite geometry and the
no-common-area fallback."""

import math
from datetime import date

import pytest
from PIL import Image as PILImage
from PIL import ImageChops
from report_snapshot_helpers import (
    MAP_HEIGHT,
    MAP_PIXEL,
    MAP_WIDTH,
    add_map_file,
    elevation_spec,
    map_spec,
    pair_spec,
)
from surfaces import CX, CY, X0, Y1, circle, cone, fixture_spec, plane
from volume_rows import add_surface

from app.maps.georef import M_PER_DEG_LAT, M_PER_DEG_LON_EQUATOR
from app.reports.snapshots.map_view import (
    common_bbox,
    elevation_source_version,
    footprint_wgs84,
    item_over_bbox,
    pair_source_version,
    render_elevation_spec,
    render_pair_spec,
    side_by_side,
    swipe_composite,
)

WHITE = (255, 255, 255)
ELEVATION_PIN = {"type": "Point", "coordinates": [CX, CY]}  # real geometry (amendment A3)


def _cone(handle, name="April"):
    return add_surface(handle, fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y), name=name)


def _map_pin(origin: tuple[float, float] = (500000.0, 4983000.0)) -> dict:
    """A Point at the raster's own centre, in the map's native CRS (amendment A3: pair tests give
    real geometry where the plan passed None only incidentally)."""
    return {
        "type": "Point",
        "coordinates": [origin[0] + MAP_WIDTH * MAP_PIXEL / 2, origin[1] - MAP_HEIGHT * MAP_PIXEL / 2],
    }


def test_an_elevation_snapshot_is_a_hillshade_of_the_window(handle):
    sid = _cone(handle)
    ring = circle(CX, CY, 5.0)
    geometry = {"type": "Polygon", "coordinates": [ring + [ring[0]]]}
    img = render_elevation_spec(handle, elevation_spec(sid, geometry))
    assert img.size == (1200, 900)
    # 22.5 px per metre: the cone's west and east flanks (8 m out) face the light differently
    west, east = img.convert("L").getpixel((420, 450)), img.convert("L").getpixel((780, 450))
    assert abs(west - east) > 20
    assert not elevation_source_version(handle, elevation_spec(sid, None)).startswith("missing:")


def test_an_elevation_window_past_the_grid_paints_the_nodata_grey(handle):
    sid = _cone(handle)
    geometry = {"type": "Point", "coordinates": [X0 + 1, Y1 - 1]}
    img = render_elevation_spec(handle, elevation_spec(sid, geometry))
    assert img.getpixel((2, 2)) == (245, 245, 245)


def test_common_bbox_is_the_intersection_fitted_to_the_aspect_in_metres():
    a, b = [15.0, 45.0, 15.01, 45.01], [15.005, 45.002, 15.02, 45.02]
    bb = common_bbox(a, b, 4 / 3)
    assert bb[0] >= 15.005 and bb[2] <= 15.01 and bb[1] >= 45.002 and bb[3] <= 45.01
    k = math.cos(math.radians((bb[1] + bb[3]) / 2))
    w_m = (bb[2] - bb[0]) * k * M_PER_DEG_LON_EQUATOR
    h_m = (bb[3] - bb[1]) * M_PER_DEG_LAT
    assert w_m / h_m == pytest.approx(4 / 3, rel=1e-9)
    assert common_bbox(a, [16.0, 46.0, 16.1, 46.1], 4 / 3) is None


def test_swipe_and_side_by_side_composite_geometry():
    a = PILImage.new("RGB", (1200, 900), (255, 0, 0))
    b = PILImage.new("RGB", (1200, 900), (0, 0, 255))
    s = swipe_composite(a, b, 0.5)
    assert s.getpixel((597, 10)) == (255, 0, 0) and s.getpixel((601, 10)) == (0, 0, 255)
    assert s.getpixel((599, 10)) == WHITE and s.getpixel((600, 10)) == WHITE
    pa, pb = PILImage.new("RGB", (596, 900), (255, 0, 0)), PILImage.new("RGB", (596, 900), (0, 0, 255))
    sbs = side_by_side(pa, pb, (1200, 900))
    assert sbs.getpixel((595, 10)) == (255, 0, 0) and sbs.getpixel((604, 10)) == (0, 0, 255)
    assert all(sbs.getpixel((x, 10)) == WHITE for x in range(596, 604))


def test_a_swipe_takes_the_left_of_a_and_the_right_of_b_over_one_bbox(handle):
    a = add_map_file(handle, name="April", seed=1, captured_on=date(2026, 9, 14))
    b_origin = (500010.0, 4983000.0)
    b = add_map_file(handle, name="May", seed=2, origin=b_origin, captured_on=date(2026, 9, 21))
    spec = pair_spec(
        map_spec(a, _map_pin(), label=None),
        map_spec(b, _map_pin(b_origin), label=None),
        mode="swipe",
        split=0.5,
    )
    img = render_pair_spec(handle, spec)
    assert img.size == (1200, 900)
    assert img.getpixel((599, 450)) == WHITE and img.getpixel((600, 450)) == WHITE
    bbox = common_bbox(footprint_wgs84(handle, spec.a), footprint_wgs84(handle, spec.b), 4 / 3)
    left = item_over_bbox(handle, spec.a, bbox, (1200, 900))
    right = item_over_bbox(handle, spec.b, bbox, (1200, 900))

    def band(im, x0, x1):
        return im.crop((x0, 100, x1, 800))  # below the chips and arrows, above the scale bars

    assert ImageChops.difference(band(img, 0, 598), band(left, 0, 598)).getbbox() is None
    assert ImageChops.difference(band(img, 601, 1200), band(right, 601, 1200)).getbbox() is None
    assert pair_source_version(handle, spec).startswith("a=")


def test_pairs_without_a_common_area_fall_back_to_side_by_side(handle):
    a = add_map_file(handle, seed=1)
    b_origin = (600000.0, 4983000.0)
    b = add_map_file(handle, seed=2, origin=b_origin)
    spec = pair_spec(map_spec(a, _map_pin(), label=None), map_spec(b, _map_pin(b_origin), label=None))
    img = render_pair_spec(handle, spec)
    assert img.size == (1200, 900)
    assert all(img.getpixel((x, 450)) == WHITE for x in range(596, 604))


def test_an_elevation_pair_swipes_too(handle):
    # amendment A15: assert the content of both halves, not only size and divider.
    sa, sb = _cone(handle, "April"), _cone(handle, "May")
    spec = pair_spec(elevation_spec(sa, ELEVATION_PIN), elevation_spec(sb, ELEVATION_PIN), mode="swipe")
    img = render_pair_spec(handle, spec)
    assert img.size == (1200, 900) and img.getpixel((600, 450)) == WHITE
    bbox = common_bbox(footprint_wgs84(handle, spec.a), footprint_wgs84(handle, spec.b), 4 / 3)
    left = item_over_bbox(handle, spec.a, bbox, (1200, 900))
    right = item_over_bbox(handle, spec.b, bbox, (1200, 900))

    def band(im, x0, x1):
        return im.crop((x0, 100, x1, 800))  # below the chips and arrows, above the scale bars

    assert ImageChops.difference(band(img, 0, 598), band(left, 0, 598)).getbbox() is None
    assert ImageChops.difference(band(img, 601, 1200), band(right, 601, 1200)).getbbox() is None


def test_an_elevation_snapshot_past_max_read_is_capped_then_lanczos_resized_to_out(handle):
    """A10: SurfaceReader.read refuses an output side over MAX_READ (2048); a wider `out` must still
    render a real hillshade, read at a capped size and resized up to exactly `out`."""
    sid = _cone(handle)
    ring = circle(CX, CY, 5.0)
    geometry = {"type": "Polygon", "coordinates": [ring + [ring[0]]]}
    img = render_elevation_spec(handle, elevation_spec(sid, geometry, out=[2400, 1800]))
    assert img.size == (2400, 1800)
    # the same window as the 1200x900 test, at double the pixel resolution: west/east flanks differ
    west = img.convert("L").getpixel((840, 900))
    east = img.convert("L").getpixel((1560, 900))
    assert abs(west - east) > 20


def test_an_elevation_pair_past_max_read_is_capped_too(handle):
    sa, sb = _cone(handle, "April"), _cone(handle, "May")
    spec = pair_spec(
        elevation_spec(sa, ELEVATION_PIN, out=[2400, 1800]),
        elevation_spec(sb, ELEVATION_PIN, out=[2400, 1800]),
        mode="swipe",
    )
    img = render_pair_spec(handle, spec)
    assert img.size == (2400, 1800)
    tones = {img.convert("L").getpixel((x, 900)) for x in (200, 600, 1000, 1400, 1800, 2200)}
    assert len(tones) > 1  # a real hillshade, not a flat placeholder
