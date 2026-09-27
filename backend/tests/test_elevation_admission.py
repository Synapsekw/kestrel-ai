"""Elevation import admission (map workspace spec §7 steps 1-2, §14): header only, no pixel read."""

from datetime import date
from pathlib import Path

import numpy as np
import pytest
import rasterio
from design_targets import add_target, target_spec, write_dem
from designs import E0, N0, plane_z

from app.db.models import Surface
from app.errors import AppError
from app.surfaces import elevation, grid, service
from app.surfaces.elevation import ElevationRefused
from app.surfaces.schemas import ElevationImportRequest

X0, Y0 = E0 + 0.13, N0 + 60.07  # off every lattice on purpose


def plain_dem(tmp_path: Path, *, cell: float = 0.3, name: str = "site dsm.tif", **kw) -> Path:
    """A plain (untiled) plane DEM, 400 x 200 cells, never a conforming surface."""
    cols, rows = np.meshgrid(np.arange(400) + 0.5, np.arange(200) + 0.5)
    z = plane_z(X0 + cols * cell, Y0 - rows * cell).astype(np.float32)
    return write_dem(tmp_path / name, z, x0=X0, y0=Y0, cell=cell, **kw)


def tag_date(path: Path, value: str) -> None:
    with rasterio.open(path, "r+") as ds:
        ds.update_tags(TIFFTAG_DATETIME=value)


def refused(fn, *args) -> ElevationRefused:
    with pytest.raises(ElevationRefused) as e:
        fn(*args)
    return e.value


@pytest.mark.parametrize(
    ("source", "cell"),
    [(0.031, 0.05), (0.05, 0.05), (0.3, 0.5), (0.5 * (1 + 1e-10), 0.5), (2.0, 2.0), (5.0, 5.0)],
)
def test_default_cell_snaps_up_the_ladder(source, cell):
    assert elevation.default_cell(source) == cell


def test_the_header_of_a_plain_dem(tmp_path):
    h = elevation.read_header(plain_dem(tmp_path))
    assert (h.width, h.height) == (400, 200) and h.cell == pytest.approx(0.3)
    assert h.envelope == pytest.approx((X0, Y0 - 60.0, X0 + 120.0, Y0))
    assert "32639" in h.crs_wkt or "UTM zone 39N" in h.crs_wkt
    assert h.captured_on is None


def test_the_date_comes_from_the_tiff_tag(tmp_path):
    path = plain_dem(tmp_path)
    tag_date(path, "2026:08:14 10:30:00")
    assert elevation.read_header(path).captured_on == date(2026, 8, 14)
    tag_date(path, "last tuesday")
    assert elevation.read_header(path).captured_on is None


def test_file_refusals(tmp_path):
    assert refused(elevation.read_header, tmp_path / "gone.tif").code == "source_missing"
    text = tmp_path / "notes.tif"
    text.write_text("not a raster")
    assert refused(elevation.read_header, text).code == "not_elevation"
    rgb = write_dem(
        tmp_path / "ortho.tif", np.zeros((3, 8, 8)), x0=E0, y0=N0, cell=1.0, dtype="uint8", count=3
    )
    e = refused(elevation.read_header, rgb)
    assert (e.code, e.message) == ("not_elevation", elevation.IMAGE)
    two = write_dem(tmp_path / "two.tif", np.zeros((2, 8, 8)), x0=E0, y0=N0, cell=1.0, count=2)
    assert "exactly one" in refused(elevation.read_header, two).message
    for kw in ({"crs": None}, {"crs": None, "identity": True}):
        e = refused(elevation.read_header, plain_dem(tmp_path, name=f"nocrs{len(kw)}.tif", **kw))
        assert (e.code, e.message) == ("no_coordinates", "this elevation file has no coordinates")


def test_a_relative_path_is_refused_as_missing(tmp_path, monkeypatch):
    """R8: a relative path would resolve against the sidecar's working folder; it is treated as
    missing even when a file of that name happens to exist there (S3's `design/detect.classify`)."""
    path = plain_dem(tmp_path)
    monkeypatch.chdir(tmp_path)
    e = refused(elevation.read_header, Path(path.name))
    assert e.code == "source_missing"


def test_a_wrong_extension_is_refused_before_the_file_is_opened(tmp_path):
    """R8: only after the file/path check passes does the extension get checked, so schemathesis's
    random (nonexistent) paths never reach this branch (test_contract.py's positive-data check)."""
    bad = tmp_path / "ortho.png"
    bad.write_text("not a raster")
    e = refused(elevation.read_header, bad)
    assert (e.code, e.message) == ("validation_error", elevation.EXTENSION.format(name="ortho.png"))
    assert e.details == {"reason": "extension"}


def test_create_refuses_a_wrong_extension(handle, tmp_path):
    """R8: the same refusal surfaces from `create_elevation` as an `AppError` with the contract's
    `details.reason` (openapi.yaml importElevation 422: ".tif or .tiff")."""
    bad = tmp_path / "ortho.png"
    bad.write_text("not a raster")
    with pytest.raises(AppError) as e:
        elevation.create_elevation(handle, ElevationImportRequest(path=str(bad), role="dsm", name="x"))
    assert (e.value.status, e.value.code) == (422, "validation_error")
    assert e.value.details == {"reason": "extension"}


def test_degrees_or_feet_need_a_surface_to_align_to(tmp_path):
    deg = write_dem(
        tmp_path / "deg.tif", np.ones((20, 20), np.float32), x0=51.0, y0=35.0, cell=1e-5, crs="EPSG:4326"
    )
    e = refused(elevation.plan, deg, None, None)
    assert (e.code, e.message) == ("geographic_output", elevation.DEGREES)
    feet = write_dem(
        tmp_path / "ft.tif",
        np.ones((20, 20), np.float32),
        x0=6_000_000.0,
        y0=2_000_000.0,
        cell=1.0,
        crs="EPSG:2229",
    )
    e = refused(elevation.plan, feet, None, None)
    assert (e.code, e.message) == ("non_metric_output", elevation.NOT_METRES)


def test_the_default_grid_is_the_ladder_cell_on_the_lattice(tmp_path):
    out = elevation.plan(plain_dem(tmp_path), None, None).out
    assert out.cell_size == 0.5 and out.epsg == 32639
    assert abs(out.x0 / 0.5 - round(out.x0 / 0.5)) < 1e-9 and abs(out.y0 / 0.5 - round(out.y0 / 0.5)) < 1e-9
    assert out.bounds[0] <= X0 and out.bounds[2] >= X0 + 120.0


def test_an_explicit_cell_wins_without_a_target(tmp_path):
    assert elevation.plan(plain_dem(tmp_path), 0.25, None).out.cell_size == 0.25


def test_a_target_sets_crs_and_lattice_and_the_cell_is_ignored(tmp_path):
    target = target_spec(cell=0.5)  # E0..E0+200, N0..N0+100, EPSG:32639
    out = elevation.plan(plain_dem(tmp_path), 0.25, target).out
    assert out.cell_size == 0.5 and grid.same_lattice(out, target)


def test_a_target_elsewhere_is_no_overlap(tmp_path):
    far = target_spec((E0 + 10_000.0, N0, E0 + 10_200.0, N0 + 100.0))
    e = refused(elevation.plan, plain_dem(tmp_path), None, far)
    assert (e.code, e.message) == ("no_overlap", elevation.NO_OVERLAP)


def test_an_untransformable_source_crs_is_no_overlap_not_a_500(tmp_path):
    """R9: a local/engineering source CRS has no coordinate operation to the target's CRS; GDAL and
    pyproj raise for that instead of returning a bool, and it must stay a readable 422."""
    target = target_spec(cell=0.5)  # a real, projected EPSG:32639 target
    local = plain_dem(tmp_path, crs='LOCAL_CS["site",UNIT["metre",1]]', name="local.tif")
    e = refused(elevation.plan, local, None, target)
    assert (e.code, e.message) == ("no_overlap", elevation.NO_TRANSFORM)


def test_a_grid_over_the_cell_ceiling_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(grid, "MAX_CELLS", 100)
    assert refused(elevation.plan, plain_dem(tmp_path), None, None).code == "grid_too_large"


def test_create_inserts_a_building_dem(handle, tmp_path):
    path = plain_dem(tmp_path)
    tag_date(path, "2026:08:14 10:30:00")
    row, params = elevation.create_elevation(
        handle, ElevationImportRequest(path=str(path), role="dsm", name="site dsm")
    )
    assert (row.kind, row.status, row.elevation_role, row.name) == ("dem", "building", "dsm", "site dsm")
    assert row.captured_on == date(2026, 8, 14) and row.point_cloud_id is None
    assert params == {
        "surface_id": row.id,
        "path": str(path),
        "cell_size_m": 0.5,
        "align_to_surface_id": None,
    }
    body = ElevationImportRequest(path=str(path), role="dtm", name="DTM", captured_on=date(2026, 9, 1))
    row, _ = elevation.create_elevation(handle, body)
    assert (row.name, row.elevation_role, row.captured_on) == ("DTM", "dtm", date(2026, 9, 1))


def test_create_looks_up_the_target_before_reading_the_file(handle, tmp_path):
    gone = str(tmp_path / "gone.tif")
    with pytest.raises(AppError) as e:
        elevation.create_elevation(
            handle, ElevationImportRequest(path=gone, role="dsm", name="x", align_to_surface_id="nope")
        )
    assert (e.value.status, e.value.code) == (404, "not_found")
    with handle.session() as s:
        building = Surface(name="b", kind="cloud_dsm", status="building")
        s.add(building)
        s.flush()
        bid = building.id
    with pytest.raises(AppError) as e:
        elevation.create_elevation(
            handle, ElevationImportRequest(path=gone, role="dsm", name="x", align_to_surface_id=bid)
        )
    assert (e.value.status, e.value.code) == (409, "not_ready")
    with pytest.raises(AppError) as e:
        elevation.create_elevation(handle, ElevationImportRequest(path=gone, role="dsm", name="x"))
    assert (e.value.status, e.value.code) == (422, "source_missing")


def test_create_with_a_target_passes_no_cell(handle, tmp_path):
    target = add_target(handle, target_spec(cell=0.5), plane_z)
    body = ElevationImportRequest(
        path=str(plain_dem(tmp_path)), role="dsm", name="x", align_to_surface_id=target, cell_size_m=0.1
    )
    _, params = elevation.create_elevation(handle, body)
    assert params["cell_size_m"] is None and params["align_to_surface_id"] == target


def test_create_refuses_a_full_disk(handle, tmp_path, monkeypatch):
    monkeypatch.setattr(service, "_disk_free", lambda path: 1000)
    with pytest.raises(AppError) as e:
        elevation.create_elevation(
            handle, ElevationImportRequest(path=str(plain_dem(tmp_path)), role="dsm", name="x")
        )
    assert (e.value.status, e.value.code) == (422, "insufficient_disk")
    with handle.session() as s:
        assert s.query(Surface).count() == 0
