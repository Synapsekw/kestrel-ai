"""Request options the map-workspace contract declares before their unit builds them (M-C0).

Each guard answers 501 `not_implemented` with details `{option, unit}` when a request uses an
option its unit has not built yet, before any lookup; `tests/test_contract.py::OPTION_STUBS` lets
the contract test accept exactly those answers. These guards belong to M-B5 (M-B2 landed its own
survey-date/role guard for `PATCH /surfaces/{id}`, and retired it once that option was built).
Each unit deletes its own guards with their call sites and their OPTION_STUBS entries as it builds
the option; this module is deleted once every guard is gone.
"""

from app.errors import AppError


def option_pending(option: str, unit: str) -> AppError:
    return AppError(
        "not_implemented",
        f"{option} is not implemented yet; it lands with {unit}",
        501,
        {"option": option, "unit": unit},
    )


def guard_volume_options(body) -> None:
    """`polygon_site`, `material` and the `toe_lowest` base (spec §10), on create and on patch."""
    if getattr(body, "polygon_site", None) is not None:
        raise option_pending("polygon_site", "M-B5")
    if "material" in body.model_fields_set:
        raise option_pending("material", "M-B5")
    base = getattr(body, "base", None)
    if base is not None and base.kind == "toe_lowest":
        raise option_pending("toe_lowest", "M-B5")


def guard_run_region(body) -> None:
    """`RunCreate.region`: a region run (spec §9.3)."""
    if body.region is not None:
        raise option_pending("region", "M-B5")


def guard_site_area_category(body) -> None:
    """`category` on a site-area create or patch (spec §9.4)."""
    if body.category is not None:
        raise option_pending("category", "M-B5")
