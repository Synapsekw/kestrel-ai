"""C-B1: the export's measurements.csv (workspace spec 2026-09-26 section 5 "LAZ export"): the S1
columns unchanged, then vertex_count, geometry_wkt and the area, ring and profile results."""

import csv
from types import SimpleNamespace

from app.pointclouds import export, measure

S1_COLUMNS = ["id", "name", "kind", "note", "x1", "y1", "z1", "u1", "x2", "y2", "z2", "u2", *measure.FIELDS]


def row(kind, points, results=None, params=None, **kw):
    return SimpleNamespace(
        id=kw.get("id", f"m-{kind}"),
        name=kw.get("name", kind),
        kind=kind,
        note=None,
        points=points,
        results=results or {},
        params=params,
    )


def P(x, y, z, u=0.01, **kw):
    return {"x": x, "y": y, "z": z, "uncertainty_m": u, **kw}


def compass(cx, cy, z, radius, group):
    return [
        P(cx, cy + radius, z, group=group),
        P(cx + radius, cy, z, group=group),
        P(cx, cy - radius, z, group=group),
        P(cx - radius, cy, z, group=group),
    ]


def read(tmp_path, rows):
    path = tmp_path / "m.csv"
    export.write_measurements_csv(path, rows)
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.reader(f))


def test_the_s1_columns_keep_their_order(tmp_path):
    """Review Focus 5."""
    header = read(tmp_path, [])[0]
    assert header[:27] == S1_COLUMNS
    assert header[27:] == [
        "vertex_count",
        "geometry_wkt",
        *measure.AREA_FIELDS,
        *measure.RING_FIELDS,
        *measure.PROFILE_FIELDS,
    ]
    assert header == export.CSV_COLUMNS and len(header) == 46


def test_each_kind_has_its_geometry(tmp_path):
    rings = compass(10.0, 20.0, 0.0, 3.0, 0) + compass(10.5, 20.0, 50.0, 2.0, 1)
    square = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)]
    rows = [
        row("point", [P(243522.123, 3178252.456, -44.321)], {"uncertainty_m": 0.01}),
        row("distance", [P(1, 2, 3), P(4, 6, 3, 0.02)], {"distance_3d": 5.0}),
        row("area", square, measure.area_results(square, None), {"mode": "surface"}),
        row("vertical", rings, measure.rings_results(rings), {"method": "rings"}),
        row("profile", [P(0, 0, 5), P(12.5, 0, 5)], {"profile_length_m": 12.5, "profile_point_count": 4000}),
    ]
    header, *body = read(tmp_path, rows)
    got = [dict(zip(header, r, strict=True)) for r in body]
    point, distance, area, vertical, profile = got
    assert (point["vertex_count"], point["geometry_wkt"]) == ("1", "POINT Z (243522.123 3178252.456 -44.321)")
    assert distance["geometry_wkt"] == "LINESTRING Z (1.0 2.0 3.0, 4.0 6.0 3.0)"
    assert (distance["x2"], distance["u2"], distance["distance_3d"]) == ("4", "0.02", "5.0")
    assert (
        area["geometry_wkt"]
        == "POLYGON Z ((0.0 0.0 0.0, 1.0 0.0 0.0, 1.0 1.0 0.0, 0.0 1.0 0.0, 0.0 0.0 0.0))"
    )
    assert (area["vertex_count"], area["x1"], area["u2"], area["area_m2"]) == ("4", "", "", "1.0")
    assert vertical["geometry_wkt"] == "LINESTRING Z (10.0 20.0 0.0, 10.5 20.0 50.0)"  # the fitted axis
    assert (vertical["vertex_count"], vertical["ring_radius_lower_m"], vertical["x1"]) == ("8", "3.0", "")
    assert profile["geometry_wkt"] == "LINESTRING Z (0.0 0.0 5.0, 12.5 0.0 5.0)"
    assert (profile["profile_point_count"], profile["x2"]) == ("4000", "12.5")


def test_a_legacy_row_without_params_still_writes(tmp_path):
    legacy = SimpleNamespace(
        id="m1",
        name="Height difference 1",
        kind="height",
        note="gate",
        points=[P(10, 10, 50), P(10, 12, 47.5)],
        results={"height_difference": -2.5},
        params=None,
    )
    header, line = read(tmp_path, [legacy])
    values = dict(zip(header, line, strict=True))
    assert values["height_difference"] == "-2.5" and values["area_m2"] == "" and values["note"] == "gate"
    assert values["geometry_wkt"] == "LINESTRING Z (10.0 10.0 50.0, 10.0 12.0 47.5)"
