"""The map-measurement service: validation, results on create and patch, and site-frame reads
(plan maps-b4 Task 4; spec §9.1, §14; Review Focus 1, 3, 5).

Contract rulings applied here (`.superpowers/sdd/2026-09-27-maps-b4/contract-rulings.md`):
- C1: `vertices` is always the stored frame; `get(..., site=True)` fills a separate
  `vertices_site` instead of swapping `vertices`.
- C2: `patch(...)` takes no `site` keyword; its response is always the stored frame.
- C3: `list_page(..., kind=...)` is a single-value equality filter.
"""

import pytest
from mapmeasure_rows import set_site_frame
from pyproj import Transformer
from surfaces import EPSG, X0, Y1, fixture_spec, plane
from volume_rows import add_surface

from app.db.models import MapMeasurement, Surface
from app.errors import AppError
from app.mapmeasure import service
from app.mapmeasure.schemas import MapMeasurementCreate, MapMeasurementPatch

LINE = [[X0 + 5, Y1 - 5], [X0 + 45, Y1 - 5]]
RING = [[X0 + 5, Y1 - 5], [X0 + 25, Y1 - 5], [X0 + 25, Y1 - 25], [X0 + 5, Y1 - 25]]


def _create(handle, **body):
    return service.create(handle, MapMeasurementCreate.model_validate(body))


def _patch(handle, mid, **body):
    return service.patch(handle, mid, MapMeasurementPatch.model_validate(body))


def _code(fn) -> tuple[str, int]:
    with pytest.raises(AppError) as e:
        fn()
    return e.value.code, e.value.status


def _count(handle) -> int:
    with handle.session() as s:
        return s.query(MapMeasurement).count()


@pytest.fixture
def dsm(handle) -> str:
    set_site_frame(handle, EPSG)
    return add_surface(handle, fixture_spec(0.1), plane, name="DSM 14 Sep")


def test_create_distance_computes_geod_and_3d(handle, dsm):
    out = _create(handle, kind="distance", vertices=LINE, surface_ids=[dsm])
    assert out.name == "Distance 1" and out.epsg == EPSG and out.crs_wkt
    r = out.results
    assert r.grid_length_m == pytest.approx(40.0) and r.length_m == pytest.approx(40.0 / r.scale_factor)
    assert r.length_3d_m > r.length_m and r.nodata_fraction == 0.0
    assert r.dsm_surface_id == dsm
    assert _create(handle, kind="distance", vertices=LINE).name == "Distance 2"
    assert _create(handle, kind="distance", vertices=LINE).results.dsm_surface_id is None


def test_create_area_and_profile(handle, dsm):
    area = _create(handle, kind="area", vertices=RING)
    assert area.results.grid_area_m2 == pytest.approx(400.0) and area.results.area_m2 > 0
    assert area.vertices == RING  # stored open
    prof = _create(handle, kind="profile", vertices=LINE, surface_ids=[dsm], name="Pit section")
    assert prof.name == "Pit section" and len(prof.results.series) == 1
    assert prof.results.series[0].label == "DSM 14 Sep" and prof.results.z_max > prof.results.z_min


def test_a_closed_ring_is_stored_open(handle, dsm):
    assert _create(handle, kind="area", vertices=[*RING, RING[0]]).vertices == RING


def test_no_site_frame_is_409(handle):
    assert _code(lambda: _create(handle, kind="distance", vertices=LINE)) == ("no_site_frame", 409)


def test_degenerate_geometry_is_refused_and_nothing_is_stored(handle, dsm):
    cases = [
        ("area", [[0, 0], [10, 10], [10, 0], [0, 10]]),  # crosses itself
        ("area", [[0, 0], [10, 0], [0, 0]]),  # two distinct points
        ("area", [[0, 0], [10, 0]]),  # too few corners
        ("distance", [[5, 5], [5, 5]]),  # no length
    ]
    for kind, vertices in cases:
        assert _code(lambda k=kind, v=vertices: _create(handle, kind=k, vertices=v)) == (
            "invalid_geometry",
            422,
        )
    assert _count(handle) == 0


def test_surface_rules(handle, dsm):
    other = add_surface(handle, fixture_spec(0.1), plane, name="second")
    local = add_surface(handle, fixture_spec(0.1, crs_wkt=None, epsg=None), plane, name="local")
    refused = [
        (dict(kind="profile", vertices=LINE), ("invalid_surfaces", 422)),
        (dict(kind="profile", vertices=LINE, surface_ids=[dsm, dsm]), ("invalid_surfaces", 422)),
        (dict(kind="distance", vertices=LINE, surface_ids=[dsm, other]), ("invalid_surfaces", 422)),
        (dict(kind="area", vertices=RING, surface_ids=[dsm]), ("invalid_surfaces", 422)),
        (dict(kind="profile", vertices=LINE, surface_ids=["nope"]), ("not_found", 404)),
        (dict(kind="profile", vertices=LINE, surface_ids=[local]), ("surface_not_in_frame", 422)),
        (dict(kind="distance", vertices=LINE, map_id="nope"), ("not_found", 404)),
    ]
    for body, want in refused:
        assert _code(lambda b=body: _create(handle, **b)) == want, body
    assert _count(handle) == 0


def test_profile_off_the_surface_is_422(handle, dsm):
    far = [[X0 + 200, Y1 - 5], [X0 + 240, Y1 - 5]]
    got = _code(lambda: _create(handle, kind="profile", vertices=far, surface_ids=[dsm]))
    assert got == ("no_surface_under_line", 422)


def test_patch_recomputes_only_when_vertices_or_surfaces_change(handle, dsm):
    out = _create(handle, kind="distance", vertices=LINE)
    renamed = _patch(handle, out.id, name="Haul road")
    assert renamed.name == "Haul road" and renamed.results == out.results
    assert renamed.updated_at >= out.updated_at  # Windows clock ticks can be coarse
    moved = _patch(handle, out.id, vertices=[[X0 + 5, Y1 - 5], [X0 + 55, Y1 - 5]])
    assert moved.results.grid_length_m == pytest.approx(50.0)
    with_dsm = _patch(handle, out.id, surface_ids=[dsm])
    assert with_dsm.results.length_3d_m is not None and with_dsm.vertices == moved.vertices


def test_patch_against_a_missing_or_building_surface_changes_nothing(handle, dsm):
    out = _create(handle, kind="profile", vertices=LINE, surface_ids=[dsm])
    assert _code(lambda: _patch(handle, out.id, surface_ids=["gone"])) == ("not_found", 404)
    with handle.session() as s:
        s.get(Surface, dsm).status = "building"
    moved = [[X0 + 6, Y1 - 6], [X0 + 40, Y1 - 6]]
    assert _code(lambda: _patch(handle, out.id, vertices=moved)) == ("not_ready", 409)
    again = service.get(handle, out.id, site=False)
    assert (again.vertices, again.results, again.updated_at) == (out.vertices, out.results, out.updated_at)


def test_site_frame_reads_convert_and_filter(handle, dsm):
    out = _create(handle, kind="distance", vertices=LINE)
    assert out.vertices_site is None  # create has no frame view (no ?frame= on POST)
    set_site_frame(handle, 32638)  # the operator switched the site CRS to the neighbouring zone
    got = service.get(handle, out.id, site=True)
    want = Transformer.from_crs(EPSG, 32638, always_xy=True).transform(*LINE[0])
    assert got.vertices == LINE  # C1: vertices is always the stored frame
    assert got.vertices_site[0] == pytest.approx(list(want), abs=1e-6)
    assert got.results == out.results
    plain = service.get(handle, out.id, site=False)
    assert plain.vertices == LINE and plain.vertices_site is None
    # C2: PATCH has no frame param; its response is always the stored frame, no vertices_site.
    patched = service.patch(handle, out.id, MapMeasurementPatch(note="n"))
    assert patched.vertices == LINE and patched.vertices_site is None
    set_site_frame(handle, None)  # local frame: the CRS row is not in it
    assert _code(lambda: service.get(handle, out.id, site=True)) == ("not_in_site_frame", 409)
    assert service.list_page(handle, site=True, limit=None, cursor=None).items == []
    assert [i.id for i in service.list_page(handle, site=False, limit=None, cursor=None).items] == [out.id]


def test_list_filters_by_kind(handle, dsm):
    d = _create(handle, kind="distance", vertices=LINE).id
    a = _create(handle, kind="area", vertices=RING).id
    assert [
        i.id for i in service.list_page(handle, site=False, limit=None, cursor=None, kind="distance").items
    ] == [d]
    assert [
        i.id for i in service.list_page(handle, site=False, limit=None, cursor=None, kind="area").items
    ] == [a]
    got = {i.id for i in service.list_page(handle, site=False, limit=None, cursor=None).items}
    assert got == {d, a}


def test_list_pages_and_strips_profile_arrays(handle, dsm):
    ids = [_create(handle, kind="profile", vertices=LINE, surface_ids=[dsm]).id for _ in range(3)]
    first = service.list_page(handle, site=False, limit=2, cursor=None)
    rest = service.list_page(handle, site=False, limit=2, cursor=first.next_cursor)
    walked = [i.id for i in first.items + rest.items]
    assert sorted(walked) == sorted(ids) and len(first.items) == 2 and rest.next_cursor is None
    item = first.items[0]
    assert item.results.series is None and item.results.stations_m is None and item.results.z_max is not None
    assert service.get(handle, item.id, site=False).results.series is not None


def test_delete(handle, dsm):
    out = _create(handle, kind="distance", vertices=LINE)
    service.delete(handle, out.id)
    assert _code(lambda: service.get(handle, out.id, site=False)) == ("not_found", 404)
    assert _code(lambda: service.delete(handle, out.id)) == ("not_found", 404)


def test_the_project_cap(handle, dsm, monkeypatch):
    monkeypatch.setattr(service, "MAX_PER_PROJECT", 1)
    _create(handle, kind="distance", vertices=LINE)
    assert _code(lambda: _create(handle, kind="distance", vertices=LINE)) == ("measurement_limit", 422)
