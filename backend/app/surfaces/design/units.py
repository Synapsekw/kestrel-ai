"""Linear units and their factors (spec §2 "Units" and "XY scaling", §5 steps 2-3).

The two feet are kept apart on purpose: they differ by 2 ppm, about a metre at State Plane
coordinates, so a plain "feet" choice would hide exactly the mistake the preview has to catch.
"""

from __future__ import annotations

from enum import StrEnum

from pyproj import CRS


class LinearUnit(StrEnum):
    millimetre = "millimetre"
    centimetre = "centimetre"
    metre = "metre"
    international_foot = "international_foot"
    us_survey_foot = "us_survey_foot"


_TO_M: dict[LinearUnit, float] = {
    LinearUnit.millimetre: 0.001,
    LinearUnit.centimetre: 0.01,
    LinearUnit.metre: 1.0,
    LinearUnit.international_foot: 0.3048,
    LinearUnit.us_survey_foot: 1200 / 3937,
}

UNIT_LABEL: dict[LinearUnit, str] = {
    LinearUnit.millimetre: "Millimetre",
    LinearUnit.centimetre: "Centimetre",
    LinearUnit.metre: "Metre",
    LinearUnit.international_foot: "International foot (0.3048 m)",
    LinearUnit.us_survey_foot: "US survey foot (1200/3937 m)",
}

FEET = frozenset({LinearUnit.international_foot, LinearUnit.us_survey_foot})

# LandXML <Metric linearUnit=...> / <Imperial linearUnit=...> (spec §5 defaults table).
LANDXML_UNITS: dict[str, LinearUnit] = {
    "meter": LinearUnit.metre,
    "metre": LinearUnit.metre,
    "millimeter": LinearUnit.millimetre,
    "millimetre": LinearUnit.millimetre,
    "centimeter": LinearUnit.centimetre,
    "centimetre": LinearUnit.centimetre,
    "foot": LinearUnit.international_foot,
    "USSurveyFoot": LinearUnit.us_survey_foot,
}

# DXF $INSUNITS codes the importer understands; 0 (unitless) is handled by the reader.
INSUNITS: dict[int, LinearUnit] = {
    6: LinearUnit.metre,
    4: LinearUnit.millimetre,
    5: LinearUnit.centimetre,
    2: LinearUnit.international_foot,
    21: LinearUnit.us_survey_foot,
}


class UnsupportedCrsUnit(ValueError):
    """The CRS axis unit is none of the five LinearUnits (the `unsupported_crs_unit` block)."""


def unit_to_m(unit: LinearUnit | str) -> float:
    return _TO_M[LinearUnit(unit)]


def unit_from_factor(factor: float) -> LinearUnit | None:
    """The unit whose metre factor equals `factor` to 1e-12 relative, else None."""
    for unit, to_m in _TO_M.items():
        if abs(factor - to_m) <= 1e-12 * to_m:
            return unit
    return None


def horizontal_crs(crs: CRS) -> CRS:
    """The horizontal part of a compound CRS; the CRS itself otherwise."""
    return crs.sub_crs_list[0] if crs.is_compound else crs


def crs_axis_unit(crs: CRS) -> LinearUnit:
    axis = horizontal_crs(crs).axis_info[0]
    unit = unit_from_factor(axis.unit_conversion_factor)
    if unit is None:
        raise UnsupportedCrsUnit(
            f"the CRS axis unit '{axis.unit_name}' is not metre, centimetre, millimetre, "
            "international foot or US survey foot"
        )
    return unit


def xy_scale(horizontal_unit: LinearUnit | str, crs: CRS) -> float:
    """XY_crs_units = XY_file * factor (spec §2). Exactly 1.0 when the units are the same member."""
    h = horizontal_crs(crs)
    if not h.is_projected:
        return 1.0
    crs_unit = crs_axis_unit(h)
    file_unit = LinearUnit(horizontal_unit)
    if file_unit is crs_unit:
        return 1.0
    return _TO_M[file_unit] / _TO_M[crs_unit]
