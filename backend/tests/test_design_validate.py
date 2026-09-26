"""Validation and the preview image (spec §10, §15.3 Validation, §16.2, §16.3)."""

import numpy as np
import pytest
from design_targets import target_spec, write_target
from designs import E0, N0, plane_z
from PIL import Image
from pyproj import CRS
from rasterio.windows import Window

from app.surfaces import grid
from app.surfaces.design import placement as pl
from app.surfaces.design import preview_image, validate

DESIGN_BOUNDS = (E0 + 20, N0 + 20, E0 + 180, N0 + 80)


@pytest.fixture
def target(tmp_path):
    spec = target_spec()
    reader = grid.open_surface(write_target(tmp_path / "t.tif", spec, plane_z))
    yield spec, reader
    reader.close()


def samples_over(bounds, swap=False, scale=1.0):
    e, n = np.meshgrid(np.linspace(bounds[0], bounds[2], 60), np.linspace(bounds[1], bounds[3], 30))
    pts = np.column_stack([e.ravel(), n.ravel(), np.zeros(e.size)])
    if swap:
        pts[:, [0, 1]] = pts[:, [1, 0]]
    return pts * [scale, scale, 1]


def make(target, *, dz=0.0, zscale=1.0, shift=(0.0, 0.0), fmt="landxml", with_target=True, **kw):
    spec, reader = target
    options = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        "swap_xy": False,
        "target_surface_id": "t" if with_target else None,
        "cell_size_m": 0.5,
        **kw.pop("options", {}),
    }
    p = pl.resolve(options, fmt, spec if with_target else None)
    b = (
        DESIGN_BOUNDS[0] + shift[0],
        DESIGN_BOUNDS[1] + shift[1],
        DESIGN_BOUNDS[2] + shift[0],
        DESIGN_BOUNDS[3] + shift[1],
    )
    out, _ = pl.output_grid(b, p)
    pspec, _ = pl.preview_grid(b, out)
    x, y = pspec.cell_centres(Window(0, 0, pspec.width, pspec.height))
    design = (plane_z(x, y) * zscale + dz).astype(np.float32)
    full = Window(0, 0, pspec.width, pspec.height)
    return validate.ValidationInput(
        fmt=fmt,
        options=options,
        detected=kw.pop("detected", {}),
        internal=kw.pop("internal", {}),
        file_bounds=kw.pop("file_bounds", b),
        placement=p,
        design=design,
        pspec=pspec,
        target_spec=spec if with_target else None,
        target_on_preview=grid.resample_onto(reader, pspec, full) if with_target else None,
        overview=validate.read_target_overview(reader) if with_target else None,
        samples=kw.pop("samples", None),
        tin=kw.pop("tin", {}),
    )


def codes_of(result):
    return {w.code: w for w in result.warnings}


def test_the_same_design_on_the_target_overlaps_and_shows_the_offset(target):
    r = validate.validate(make(target, dz=0.3))
    assert r.overlap_fraction >= 0.99
    assert r.z_check["median_dz_m"] == pytest.approx(0.3, abs=1e-3)
    assert r.target_covered_fraction == pytest.approx(160 * 60 / (200 * 100), abs=0.02)
    assert r.design_area_m2 == pytest.approx(160 * 60, rel=0.02)
    assert not {"no_overlap", "low_overlap", "z_offset", "z_units"} & set(codes_of(r))


def test_a_45_m_offset_is_a_z_offset(target):
    w = codes_of(validate.validate(make(target, dz=45.0)))["z_offset"]
    assert w.level == "warn" and "+45.0 m" in w.message


def test_feet_heights_read_as_metres_are_z_units(target):
    assert codes_of(validate.validate(make(target, zscale=3.2808)))["z_units"].level == "warn"


def test_a_swapped_file_gets_no_overlap_and_a_swap_suggestion(target):
    v = make(target, shift=(5_000.0, 0.0), samples=samples_over(DESIGN_BOUNDS, swap=True))
    r = validate.validate(v)
    assert codes_of(r)["no_overlap"].level == "warn"
    (s,) = [s for s in r.suggestions if s["code"] == "swap_xy"]
    assert s["overlap_fraction"] >= 0.9 and s["options_patch"] == {"swap_xy": True}
    assert s["message"].startswith("With easting/northing swapped, ")
    assert "lies on the cloud surface" in s["message"]


def test_metres_read_as_feet_get_a_unit_suggestion(target):
    v = make(
        target,
        shift=(5_000.0, 0.0),
        options={"horizontal_unit": "international_foot"},
        samples=samples_over(DESIGN_BOUNDS),
    )
    r = validate.validate(v)
    (s,) = [s for s in r.suggestions if s["code"] == "horizontal_unit"]
    assert s["options_patch"] == {"horizontal_unit": "metre"} and s["overlap_fraction"] >= 0.9
    assert codes_of(r)["units_mismatch_crs"].level == "info"


def test_a_foot_unit_states_how_far_the_other_foot_moves_it(target):
    v = make(
        target,
        options={
            "source_crs": "EPSG:2229",
            "horizontal_unit": "us_survey_foot",
            "vertical_unit": "us_survey_foot",
        },
        file_bounds=(6_000_000.0, 2_000_000.0, 6_001_000.0, 2_001_000.0),
    )
    w = codes_of(validate.validate(v))["foot_ambiguity"]
    assert w.level == "warn" and "3.66 m" in w.message


def test_insunits_2_is_a_foot_ambiguity_too(target):
    assert "foot_ambiguity" in codes_of(validate.validate(make(target, fmt="dxf", internal={"insunits": 2})))


def test_unitless_dxf_warns_that_metres_were_assumed(target):
    assert (
        codes_of(validate.validate(make(target, fmt="dxf", internal={"insunits": 0})))["units_assumed"].level
        == "warn"
    )


def test_degrees_and_local_grids(target):
    geo = codes_of(validate.validate(make(target, file_bounds=(50.1, 25.1, 50.2, 25.2))))
    assert geo["looks_geographic"].level == "warn"
    local = codes_of(validate.validate(make(target, file_bounds=(1000.0, 2000.0, 1200.0, 2100.0))))
    assert (
        local["looks_local"].message
        == "coordinates look like a local site grid; site calibration isn't supported"
    )


def test_no_target_is_an_info_and_no_overlap_is_measured(target):
    r = validate.validate(make(target, with_target=False))
    assert codes_of(r)["no_target"].level == "info"
    assert r.overlap_fraction is None and r.z_check is None and r.suggestions == []


def test_crs_provenance(target):
    wkt = CRS.from_epsg(32639).to_wkt()
    from_file = codes_of(
        validate.validate(
            make(target, detected={"crs_wkt": wkt, "crs_source": "LandXML <CoordinateSystem epsgCode>"})
        )
    )
    assert from_file["crs_from_file"].message == "CRS from the file (LandXML <CoordinateSystem epsgCode>)"
    assumed = codes_of(validate.validate(make(target, detected={"crs_wkt": None})))
    assert assumed["crs_assumed"].level == "info"


def test_tin_quality_notes(target):
    tin = {
        "overlapping_triangles": 3,
        "long_edges_removed": 12,
        "max_edge_m": 10.0,
        "duplicate_points": 2,
        "degenerate_triangles": 1,
    }
    w = codes_of(validate.validate(make(target, tin=tin)))
    assert w["overlapping_triangles"].level == "warn"
    assert (
        w["long_edges_removed"].message
        == "12 long triangles were trimmed from the edges (maximum edge 10.0 m)"
    )
    assert (
        w["duplicate_points"].message
        == "2 positions had different heights (crossing contours?) and were averaged"
    )
    assert w["degenerate_triangles"].level == "info"


def test_an_empty_design_is_blocked(target):
    v = make(target, samples=samples_over(DESIGN_BOUNDS))
    v.design[:] = np.nan
    r = validate.validate(v)
    assert codes_of(r)["empty_result"].level == "block"
    # Nothing to overlap and nothing to suggest re-placing when the design itself is empty.
    assert not {"no_overlap", "low_overlap"} & set(codes_of(r))
    assert r.suggestions == []


def test_the_preview_image_is_one_panel_or_two(target, tmp_path):
    spec, reader = target
    ov = validate.read_target_overview(reader)
    t_layer = preview_image.Layer(ov.z, ov.x0, ov.y0, ov.cell_x, ov.cell_y)
    v = make(target)
    d_layer = preview_image.Layer(v.design, v.pspec.x0, v.pspec.y0, v.pspec.cell_size, v.pspec.cell_size)
    assert preview_image.render(d_layer, t_layer, tmp_path / "one.png") == 1
    assert max(Image.open(tmp_path / "one.png").size) <= 512
    far = preview_image.Layer(v.design, v.pspec.x0 + 50_000, v.pspec.y0, v.pspec.cell_size, v.pspec.cell_size)
    assert preview_image.render(far, t_layer, tmp_path / "two.png") == 2
    im = Image.open(tmp_path / "two.png")
    assert im.size[0] == 512 and im.size[0] > im.size[1]
    assert preview_image.render(d_layer, None, tmp_path / "solo.png") == 1


def test_outline_marks_the_panel_edge_when_the_footprint_touches_it():
    mask = np.ones((4, 4), dtype=bool)
    edge = preview_image._outline(mask)
    # A footprint filling the whole panel touches the edge on all four sides: the border ring is
    # outline, only the fully-surrounded 2 x 2 centre is not.
    assert edge[0, 0] and edge[0, -1] and edge[-1, 0] and edge[-1, -1]
    assert edge[0, :].all() and edge[-1, :].all() and edge[:, 0].all() and edge[:, -1].all()
    assert not edge[1, 1] and not edge[1, 2] and not edge[2, 1] and not edge[2, 2]
    assert edge.sum() == 12
