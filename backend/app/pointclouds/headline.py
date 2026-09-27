"""How C's new cloud measurement kinds headline in M's project-wide `GET /measurements` list
(workspace spec 2026-09-26 section 12 row 19). M-B4's `CLOUD_HEADLINES` entries for `area` and
`profile` call this; the S1 kinds keep M's own entries (`headline_for` answers None). Units are
M-C0's `MeasurementUnit` values; the status is M's (`CLOUD_STATUS`), not mapped here."""

from __future__ import annotations

AREA_UNIT = "m2"
LENGTH_UNIT = "m"


def headline_for(
    kind: str, params: dict | None, results: dict | None, points: list[dict] | None
) -> tuple[float | None, str] | None:
    """(value, unit) for `area` and `profile`, the value None until it is computed; None for any
    other kind ("keep M's own entry")."""
    r = results or {}
    if kind == "area":
        return r.get("area_m2"), AREA_UNIT
    if kind == "profile":
        return r.get("profile_length_m"), LENGTH_UNIT
    return None
