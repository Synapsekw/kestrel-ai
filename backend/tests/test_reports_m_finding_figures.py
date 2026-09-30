"""Map figures on a finding's page (reports spec §7.3, §9.3; Rulings 1-4)."""

from datetime import date

from reports_m_rows import UTM33, add_geomap, cloud_finding_row, make_ctx, map_finding, row_of

from app.reports.figures import map as map_fig
from app.reports.figures import map_geo
from app.workspace.frame import WGS84

PT = [500050.0, 4982950.0]


def _type(project):
    return project["classes"][0]


def test_a_map_point_finding_gets_one_main_pin_with_the_inset(handle, project):
    t = _type(project)
    mid = add_geomap(handle, name="Sep flight", captured_on=date(2026, 9, 14))
    fid = map_finding(handle, map_id=mid, geometry=map_geo.point(*PT), number=42, type_id=t["id"])
    [fig] = map_fig.finding_figures(make_ctx(handle), row_of(handle, fid))
    spec = fig.snapshot.spec
    assert spec.kind == "map" and spec.item_id == mid and spec.inset is True
    assert spec.geometry.model_dump() == {"type": "Point", "coordinates": PT}
    assert spec.colour == t["colour"] and spec.label == f"F-0042 · {t['name']}"
    assert fig.caption == "Sep flight · 14 Sep 2026"
    assert (fig.width_mm, fig.height_mm) == (140.0, 105.0)


def test_a_map_polygon_finding_keeps_its_polygon(handle, project):
    mid = add_geomap(handle, name="Sep")
    ring = map_geo.polygon([[500010, 4982990], [500020, 4982990], [500020, 4982980]])
    fid = map_finding(handle, map_id=mid, geometry=ring, number=1, type_id=_type(project)["id"])
    [fig] = map_fig.finding_figures(make_ctx(handle), row_of(handle, fid))
    assert fig.snapshot.spec.geometry.type == "Polygon"


def test_a_finding_whose_map_was_deleted_gets_nothing(handle, project):
    from app.db.models import GeoMap

    mid = add_geomap(handle, name="Sep")
    fid = map_finding(handle, map_id=mid, geometry=map_geo.point(*PT), number=1, type_id=_type(project)["id"])
    row = row_of(handle, fid)
    with handle.session() as s:
        s.delete(s.get(GeoMap, mid))
    assert map_fig.finding_figures(make_ctx(handle), row) == []


def test_a_cloud_finding_inside_a_map_gets_a_locator_on_the_newest_map(handle, project):
    add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    new = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    lon, lat = map_geo.to_crs([PT], UTM33, WGS84)[0]
    fid = cloud_finding_row(handle, number=7, type_id=_type(project)["id"], lon=lon, lat=lat)
    [fig] = map_fig.finding_figures(make_ctx(handle), row_of(handle, fid))
    assert fig.snapshot.spec.item_id == new and fig.snapshot.spec.inset is False
    assert fig.snapshot.spec.geometry.coordinates == [pytest_approx(PT[0]), pytest_approx(PT[1])]
    assert fig.caption == "Location on Sep · 01 Sep 2026"
    assert (fig.width_mm, fig.height_mm) == (83.0, 52.0)


def test_a_finding_outside_every_map_or_without_coordinates_gets_nothing(handle, project):
    add_geomap(handle, name="Sep")
    far = cloud_finding_row(handle, number=1, type_id=_type(project)["id"], lon=100.0, lat=0.0)
    none = cloud_finding_row(handle, number=2, type_id=_type(project)["id"], lon=None, lat=None)
    ctx = make_ctx(handle)
    assert map_fig.finding_figures(ctx, row_of(handle, far)) == []
    assert map_fig.finding_figures(ctx, row_of(handle, none)) == []


def pytest_approx(v):
    import pytest

    return pytest.approx(v, abs=1e-6)
