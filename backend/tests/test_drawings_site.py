"""The drawings' view of the site frame and tile grid (spec §6; plan Task 2)."""

import json
from pathlib import Path

import numpy as np
import pytest
from drawings_helpers import seed_frame
from pyproj import CRS

from app.drawings import site
from app.errors import AppError

GRID_PATH = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "site-grid-vectors.json"
GRID = json.loads(GRID_PATH.read_text("utf-8"))


def test_res_and_bounds_match_the_shared_site_grid_vectors():
    for row in GRID["res"]:
        assert site.res(row["z"]) == row["res"]
    for row in GRID["bounds"]:
        got = site.tile_bounds(row["z"], row["x"], row["y"])
        assert got == (row["minx"], row["miny"], row["maxx"], row["maxy"])
    for row in GRID["tiles"]:
        minx, miny, maxx, maxy = site.tile_bounds(row["z"], row["x"], row["y"])
        assert minx <= row["e"] < maxx and miny < row["n"] <= maxy
    with pytest.raises(ValueError):
        site.res(21)


def test_ring_is_densified():
    xs, ys = site.ring((0.0, 0.0, 10.0, 5.0), n=4)
    assert len(xs) == 16 and xs.min() == 0 and xs.max() == 10 and ys.max() == 5


def test_frame_key_and_unit():
    assert site.Frame("local", None, None).key == "local"
    assert site.frame_unit_m(site.Frame("local", None, None)) == 1.0
    utm = site.Frame("crs", CRS.from_epsg(32638).to_wkt(), 32638)
    assert utm.key == "epsg:32638" and site.frame_unit_m(utm) == 1.0
    ft = site.Frame("crs", CRS.from_epsg(2263).to_wkt(), 2263)  # NY Long Island, US survey feet
    assert abs(site.frame_unit_m(ft) - 1200 / 3937) < 1e-12


def test_crs_unit_m():
    """F15: a public crs_unit_m(crs_wkt) that frame_unit_m delegates to (Task 8 imports it directly)."""
    assert site.crs_unit_m(None) == 1.0
    assert site.crs_unit_m(CRS.from_epsg(32638).to_wkt()) == 1.0
    assert abs(site.crs_unit_m(CRS.from_epsg(2263).to_wkt()) - 1200 / 3937) < 1e-12


def test_conversion_identity_and_across_zones():
    f38 = site.Frame("crs", CRS.from_epsg(32638).to_wkt(), 32638)
    same = site.Conversion(CRS.from_epsg(32638).to_wkt(), f38)
    assert same.identity
    other = site.Conversion(CRS.from_epsg(32639).to_wkt(), f38)
    assert not other.identity
    e, n = other.to_site(np.array([300000.0]), np.array([4000000.0]))
    back = other.from_site(e, n)
    assert abs(back[0][0] - 300000.0) < 1e-6 and abs(back[1][0] - 4000000.0) < 1e-6


def test_not_in_frame():
    local = site.Frame("local", None, None)
    with pytest.raises(site.NotInFrame):
        site.Conversion(CRS.from_epsg(32638).to_wkt(), local)
    with pytest.raises(site.NotInFrame):
        site.Conversion(None, site.Frame("crs", CRS.from_epsg(32638).to_wkt(), 32638))
    assert site.Conversion(None, local).identity


def test_current_frame_reads_the_row_or_answers_409(handle):
    with pytest.raises(AppError) as e:
        site.current_frame(handle)
    assert e.value.status == 409 and e.value.code == "no_site_frame"
    seed_frame(handle, 32638)
    f = site.current_frame(handle)
    assert (f.kind, f.epsg) == ("crs", 32638)
    seed_frame(handle, None)
    assert site.current_frame(handle).kind == "local"
