"""Site-area geometry (plan 2 unit S, deviation 2): WGS84 polygons projected into map pixels, and a
box-centre point-in-polygon test. No clipping: "partly covered" means a vertex lies off the map."""

import pytest
from pyproj import CRS
from rasterio.transform import Affine

from app.db.models import GeoMap, SiteArea
from app.db.session import make_session_factory, open_project_db
from app.detect.areas import ProjectedArea, area_ids_for_point, areas_for_map, project_area
from app.maps.georef import Georef

UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)
ROTATED_GT = (Affine.translation(500000, 4983000) * Affine.rotation(30) * Affine.scale(0.03, -0.03)).to_gdal()
W = H = 1000


def _map(gt=GT, map_id="m1") -> GeoMap:
    return GeoMap(
        id=map_id,
        name="m",
        source_path="x",
        source_size=1,
        width=W,
        height=H,
        geotransform=list(gt),
        crs_wkt=UTM33,
    )


def _area(pixels, gt=GT, area_id="a1") -> SiteArea:
    g = Georef(gt, UTM33)
    return SiteArea(id=area_id, name=area_id, polygon_wgs84=[list(g.pixel_to_wgs84(x, y)) for x, y in pixels])


def _square(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


@pytest.mark.parametrize("gt", [GT, ROTATED_GT], ids=["utm", "rotated"])
def test_an_area_inside_the_map_is_fully_covered(gt):
    p = project_area(_map(gt), _area(_square(100, 100, 200, 300), gt))
    assert p is not None and p.area_id == "a1" and p.partial is False
    assert p.polygon_px == [pytest.approx(v, abs=1e-6) for v in _square(100, 100, 200, 300)]


def test_an_area_crossing_the_edge_is_partly_covered():
    p = project_area(_map(), _area(_square(900, 100, 1100, 200)))
    assert p is not None and p.partial is True


def test_a_band_across_the_map_with_no_vertex_on_it_is_partly_covered():
    p = project_area(_map(), _area(_square(-100, 400, 1100, 600)))
    assert p is not None and p.partial is True


def test_an_area_around_the_whole_map_is_partly_covered():
    p = project_area(_map(), _area(_square(-100, -100, 1100, 1100)))
    assert p is not None and p.partial is True


def test_an_area_elsewhere_on_earth_is_none():
    far = SiteArea(id="far", name="far", polygon_wgs84=[[100.0, 10.0], [100.1, 10.0], [100.1, 10.1]])
    assert project_area(_map(), far) is None


def test_an_area_just_beside_the_map_is_none():
    assert project_area(_map(), _area(_square(1100, 100, 1200, 200))) is None


def test_a_map_without_georeferencing_projects_nothing():
    gmap = GeoMap(id="m", name="m", source_path="x", source_size=1, width=W, height=H)
    assert project_area(gmap, _area(_square(100, 100, 200, 200))) is None


def test_area_ids_for_point_uses_the_polygon_not_its_bounding_box():
    triangle = ProjectedArea("tri", [(0.0, 0.0), (100.0, 0.0), (0.0, 100.0)], False)
    square = ProjectedArea("sq", [(50.0, 50.0), (150.0, 50.0), (150.0, 150.0), (50.0, 150.0)], False)
    areas = [triangle, square]
    assert area_ids_for_point(areas, 10, 10) == ["tri"]
    assert area_ids_for_point(areas, 80, 80) == ["sq"]  # inside the triangle's box, not the triangle
    assert area_ids_for_point(areas, 45, 45) == ["tri"]
    assert area_ids_for_point(areas, 200, 200) == []
    overlap = ProjectedArea("big", [(0.0, 0.0), (300.0, 0.0), (300.0, 300.0), (0.0, 300.0)], True)
    assert sorted(area_ids_for_point([*areas, overlap], 60, 60)) == ["big", "sq"]


def test_areas_for_map_projects_every_overlapping_area(tmp_path):
    engine = open_project_db(tmp_path)
    try:
        factory = make_session_factory(engine)
        with factory() as s, s.begin():
            s.add(_area(_square(100, 100, 200, 200), area_id="in"))
            s.add(_area(_square(900, 100, 1100, 200), area_id="edge"))
            s.add(_area(_square(2000, 2000, 2100, 2100), area_id="off"))
        with factory() as s:
            got = {a.area_id: a.partial for a in areas_for_map(s, _map())}
    finally:
        engine.dispose()
    assert got == {"in": False, "edge": True}
