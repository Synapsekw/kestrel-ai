"""Placement (spec §5, §15.3 Placement, §16.4)."""

import numpy as np
import pytest
from design_targets import target_spec
from designs import E0, N0

from app.surfaces import grid
from app.surfaces.design import placement as pl


def opts(**kw):
    base = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
    }
    return {**base, "swap_xy": False, "target_surface_id": None, "cell_size_m": 0.5, **kw}


def test_a_mm_drawing_in_a_metric_crs_is_scaled_by_a_thousandth():
    p = pl.resolve(opts(horizontal_unit="millimetre", vertical_unit="millimetre"), "dxf", None)
    assert p.xy_factor == 0.001 and p.z_factor == 0.001
    out = pl.place_vertices(np.array([[E0 * 1000, N0 * 1000, 1500.0]]), p)
    np.testing.assert_allclose(out, [[E0, N0, 1.5]])


def test_an_international_foot_file_in_a_us_foot_crs():
    p = pl.resolve(opts(source_crs="EPSG:2229", horizontal_unit="international_foot"), "dxf", target_spec())
    assert p.xy_factor == pytest.approx(0.999998, abs=1e-9)


def test_equal_units_give_exactly_one_and_no_transform():
    p = pl.resolve(opts(), "landxml", None)
    assert p.xy_factor == 1.0 and p.z_factor == 1.0 and p.transformer() is None


def test_swap():
    p = pl.resolve(opts(swap_xy=True), "landxml", None)
    np.testing.assert_allclose(pl.place_vertices(np.array([[N0, E0, 3.0]]), p), [[E0, N0, 3.0]])


def test_us_foot_heights_convert_exactly():
    p = pl.resolve(opts(vertical_unit="us_survey_foot"), "landxml", None)
    assert pl.place_vertices(np.array([[E0, N0, 100.0]]), p)[0, 2] == pytest.approx(
        30.480060960121920, rel=1e-12
    )


def test_the_output_grid_is_aligned_and_shares_the_target_lattice():
    target = target_spec(cell=0.5)
    p = pl.resolve(opts(source_crs="EPSG:32638"), "landxml", target)
    assert (p.cell_size, p.out_epsg) == (0.5, 32639) and p.transformer() is not None
    placed = pl.place_vertices(np.array([[740_000.3, 2_800_000.7, 1.0], [740_150.2, 2_800_080.1, 2.0]]), p)
    out, notes = pl.output_grid(pl.xy_bounds(placed), p)
    assert grid.same_lattice(out, target) and notes == []
    assert (out.x0 / 0.5) == pytest.approx(round(out.x0 / 0.5), abs=1e-9)


def test_without_a_target_the_source_crs_and_the_cell_are_used():
    p = pl.resolve(opts(cell_size_m=0.25), "landxml", None)
    out, _ = pl.output_grid((E0 + 0.3, N0 + 0.7, E0 + 10.2, N0 + 5.1), p)
    assert (out.cell_size, out.epsg, out.x0) == (0.25, 32639, E0 + 0.25)


def test_the_preview_grid_is_an_integer_coarsening_of_the_output():
    p = pl.resolve(opts(cell_size_m=0.1), "landxml", None)
    bounds = (E0, N0, E0 + 400.0, N0 + 300.0)
    out, _ = pl.output_grid(bounds, p)
    prev, k = pl.preview_grid(bounds, out)
    assert k == 8 and prev.cell_size == pytest.approx(0.8)
    assert max(prev.width, prev.height) <= 513
    assert (prev.x0 - out.x0) / out.cell_size == pytest.approx(
        round((prev.x0 - out.x0) / out.cell_size), abs=1e-6
    )


@pytest.mark.parametrize(
    ("source", "code"),
    [("EPSG:4326", "geographic_output"), ("EPSG:2229", "non_metric_output")],
)
def test_a_non_metric_output_without_a_target_is_blocked(source, code):
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.resolve(opts(source_crs=source), "landxml", None)
    assert e.value.note.code == code and e.value.note.level == "block"


def test_a_crs_unit_outside_the_enum_is_blocked():
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.resolve(opts(source_crs="+proj=utm +zone=39 +datum=WGS84 +units=km"), "landxml", target_spec())
    assert e.value.note.code == "unsupported_crs_unit"


def test_grid_size_ceilings():
    p = pl.resolve(opts(cell_size_m=0.001), "landxml", None)
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.output_grid((E0, N0, E0 + 100_000, N0 + 100_000), p)
    assert e.value.note.code == "grid_too_large"
    p1 = pl.resolve(opts(cell_size_m=1.0), "landxml", None)
    _, notes = pl.output_grid((E0, N0, E0 + 20_000, N0 + 20_000), p1)
    assert [n.code for n in notes] == ["large_grid"]


def test_a_grid_over_2_62_cells_is_grid_too_large_not_a_crs_problem():
    """aligned_grid itself raises (width * height > 2**62) before the MAX_CELLS check ever runs;
    that must still land on grid_too_large, not be misread as a CRS problem (a metre CRS declared
    with a millimetre-sized cell over a huge bound, e.g. an mm drawing whose units were entered
    wrong)."""
    p = pl.resolve(opts(cell_size_m=0.01), "landxml", None)
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.output_grid((E0, N0, E0 + 5e10, N0 + 5e10), p)
    assert e.value.note.code == "grid_too_large" and e.value.note.level == "block"


def test_unplaceable_coordinates_are_blocked():
    p = pl.resolve(opts(source_crs="EPSG:4326"), "landxml", target_spec())
    with pytest.raises(pl.PlacementBlocked) as e:
        pl.place_vertices(np.array([[5e6, 5e6, 0.0]]), p)
    assert e.value.note.level == "block"


def test_raster_envelope_of_a_rotated_transform():
    from affine import Affine

    t = Affine.translation(100, 200) @ Affine.rotation(90) @ Affine.scale(1, -1)
    assert pl.raster_envelope(t, 10, 20) == pytest.approx((100.0, 200.0, 120.0, 210.0))
