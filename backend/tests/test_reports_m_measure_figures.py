"""Figures for map measurements (Ruling 5), the profile chart (Ruling 7), cloud rows via R9-C."""

from datetime import date

from reports_m_rows import add_dem, add_geomap, make_ctx, map_measurement

from app.measurements.union import list_page
from app.reports.sections import measure_figures

LINE = [[500010.0, 4982990.0], [500040.0, 4982960.0]]


def _item(handle, mid):
    return next(i for i in list_page(handle, limit=1000).items if i.id == mid)


def test_a_distance_on_its_map_is_a_line_on_that_map(handle):
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    mid = map_measurement(handle, kind="distance", vertices=LINE, map_id=gm, name="Fence")
    [fig] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    spec = fig.snapshot.spec
    assert spec.kind == "map" and spec.item_id == gm and spec.colour == "#8F7BFF"
    assert spec.geometry.type == "LineString"
    assert fig.caption == "Fence · Sep · 1 Sep 2026"


def test_an_area_is_a_polygon(handle):
    gm = add_geomap(handle, name="Sep")
    mid = map_measurement(handle, kind="area", vertices=LINE + [[500010.0, 4982960.0]], map_id=gm)
    [fig] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert fig.snapshot.spec.geometry.type == "Polygon"


def test_a_500_vertex_area_fits_the_spec_url_limit(handle):
    import math

    from app.reports.snapshots.keys import MAX_SPEC_CHARS, encode_spec

    gm = add_geomap(handle, name="Sep")
    ring = [
        [
            500050.0 + 40 * math.cos(2 * math.pi * i / 500) + 0.0123456,
            4982950.0 + 40 * math.sin(2 * math.pi * i / 500),
        ]
        for i in range(500)
    ]
    mid = map_measurement(handle, kind="area", vertices=ring, map_id=gm)
    [fig] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert len(encode_spec(fig.snapshot.spec)) <= MAX_SPEC_CHARS


def test_two_rows_without_a_target_warn_once_with_the_total(handle):
    ctx = make_ctx(handle)
    for name in ("Fence", "Wall"):
        mid = map_measurement(handle, kind="distance", vertices=LINE, name=name)
        measure_figures.figures_for(ctx, _item(handle, mid))
    [w] = [w for w in ctx.warnings if w.code == "measurement_no_map"]
    assert w.count == 2 and w.message == "2 map measurements have no map to draw on"


def test_without_a_map_the_first_ready_surface_gives_an_elevation_figure(handle):
    sid = add_dem(handle)
    mid = map_measurement(handle, kind="distance", vertices=LINE, surface_ids=(sid,))
    [fig] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert fig.snapshot.spec.kind == "elevation" and fig.snapshot.spec.item_id == sid


def test_with_neither_the_newest_covering_map_is_used(handle):
    gm = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    mid = map_measurement(handle, kind="distance", vertices=LINE)
    [fig] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert fig.snapshot.spec.item_id == gm


def test_nothing_to_draw_on_gives_a_note(handle):
    mid = map_measurement(handle, kind="distance", vertices=LINE, name="Fence")
    [para] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert para.text == f"Fence: {measure_figures.NO_TARGET_TEXT}"


def test_a_local_measurement_on_a_crs_map_gets_a_note(handle):
    gm = add_geomap(handle, name="Sep")
    mid = map_measurement(handle, kind="distance", vertices=[[1, 2], [3, 4]], map_id=gm, crs_wkt=None)
    [para] = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert para.text.endswith(measure_figures.OTHER_FRAME_TEXT)


def test_a_profile_adds_a_decimated_line_chart(handle):
    gm = add_geomap(handle, name="Sep")
    n = 500
    results = {
        "length_m": 49.9,
        "stations_m": [i * 0.1 for i in range(n)],
        "series": [
            {
                "surface_id": "s1",
                "label": "DSM",
                "date": "2026-09-01",
                "z": [100.0 + i / 1000 for i in range(n)],
            },
            {"surface_id": "s2", "label": "Design", "date": None, "z": [None] * n},
        ],
    }
    mid = map_measurement(handle, kind="profile", vertices=LINE, map_id=gm, results=results)
    fig, chart = measure_figures.figures_for(make_ctx(handle), _item(handle, mid))
    assert fig.snapshot.spec.kind == "map"
    assert chart.chart == "line" and chart.unit == "m"
    assert len(chart.x_labels) <= measure_figures.MAX_PROFILE_POINTS
    assert chart.x_labels[0] == "0 m"
    assert [s.name for s in chart.series] == ["DSM (1 Sep 2026)", "Design"]
    assert chart.series[1].values[0] is None


def test_a_cloud_row_takes_r9cs_measurement_figure(handle, monkeypatch):
    from data_rows import add_cloud, at
    from mapmeasure_rows import add_cloud_measurement

    cid = add_cloud_measurement(handle, add_cloud(handle), created_at=at(1))
    seen = {}

    def fake(ctx, row):
        seen["id"] = row.id
        return "cloud figure"

    monkeypatch.setattr("app.reports.figures.cloud.measurement_figure", fake)
    assert measure_figures.figures_for(make_ctx(handle), _item(handle, cid)) == ["cloud figure"]
    assert seen["id"] == cid
