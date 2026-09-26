"""Units and their factors (spec §2 Units, §5 steps 2-3, §15.3 Placement)."""

import pytest
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission, codes
from app.surfaces.design.units import (
    INSUNITS,
    LANDXML_UNITS,
    UNIT_LABEL,
    LinearUnit,
    UnsupportedCrsUnit,
    crs_axis_unit,
    unit_to_m,
    xy_scale,
)


def test_the_two_feet_differ_and_are_exact():
    assert unit_to_m("international_foot") == 0.3048
    assert unit_to_m("us_survey_foot") == 1200 / 3937
    z_int, z_us = 100 * unit_to_m("international_foot"), 100 * unit_to_m("us_survey_foot")
    assert z_int == pytest.approx(30.48, rel=1e-12)
    assert z_us == pytest.approx(30.480060960121920, rel=1e-12)
    assert abs(z_us - z_int) > 5e-5


def test_labels_spell_out_both_feet():
    assert UNIT_LABEL[LinearUnit.us_survey_foot] == "US survey foot (1200/3937 m)"
    assert UNIT_LABEL[LinearUnit.international_foot] == "International foot (0.3048 m)"


def test_crs_axis_units():
    assert crs_axis_unit(CRS.from_epsg(32639)) is LinearUnit.metre
    assert crs_axis_unit(CRS.from_epsg(2229)) is LinearUnit.us_survey_foot  # NAD83 / California zone 5 (ftUS)
    assert crs_axis_unit(CRS.from_epsg(2231)) is LinearUnit.us_survey_foot
    with pytest.raises(UnsupportedCrsUnit):
        crs_axis_unit(CRS.from_proj4("+proj=utm +zone=39 +datum=WGS84 +units=km"))


def test_xy_scale_mm_drawing_in_a_metric_crs():
    assert xy_scale("millimetre", CRS.from_epsg(32639)) == 0.001


def test_xy_scale_international_foot_into_a_us_foot_crs():
    assert xy_scale("international_foot", CRS.from_epsg(2229)) == pytest.approx(0.999998, abs=1e-9)


def test_xy_scale_is_exactly_one_for_equal_units():
    assert xy_scale("metre", CRS.from_epsg(32639)) == 1.0
    assert xy_scale("us_survey_foot", CRS.from_epsg(2229)) == 1.0


def test_xy_scale_is_one_for_a_geographic_crs():
    assert xy_scale("international_foot", CRS.from_epsg(4326)) == 1.0


def test_file_unit_maps():
    assert LANDXML_UNITS["meter"] is LinearUnit.metre
    assert LANDXML_UNITS["foot"] is LinearUnit.international_foot
    assert LANDXML_UNITS["USSurveyFoot"] is LinearUnit.us_survey_foot
    assert INSUNITS == {
        6: LinearUnit.metre,
        4: LinearUnit.millimetre,
        5: LinearUnit.centimetre,
        2: LinearUnit.international_foot,
        21: LinearUnit.us_survey_foot,
    }


def test_notes_round_trip():
    n = codes.warn("foot_ambiguity", "moves 1.2 m")
    assert n.to_json() == {"code": "foot_ambiguity", "level": "warn", "message": "moves 1.2 m"}
    assert codes.DesignNote.from_json(n.to_json()) == n


def test_admission_refuses_above_sixty_percent_of_free_ram():
    admission.admit(599, "x", "y", available=lambda: 1000)
    with pytest.raises(JobFailure, match="Choose a coarser cell"):
        admission.admit(601, "Rasterising", "Choose a coarser cell.", available=lambda: 1000)


def test_tin_bytes():
    assert admission.tin_bytes(1_000, 2_000) == 32 * 1_000 + 12 * 2_000
