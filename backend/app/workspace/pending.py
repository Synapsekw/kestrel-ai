"""Request options the map-workspace contract declares before their unit builds them (M-C0).

Each guard answers 501 `not_implemented` with details `{option, unit}` when a request uses an
option its unit has not built yet, before any lookup; `tests/test_contract.py::OPTION_STUBS` lets
the contract test accept exactly those answers. The one guard left, `guard_surface_patch`, belongs
to M-B2 (M-B5 has built and removed its own); M-B2 deletes it with its call site and its
OPTION_STUBS entry, and this module with it.
"""

from app.errors import AppError


def option_pending(option: str, unit: str) -> AppError:
    return AppError(
        "not_implemented",
        f"{option} is not implemented yet; it lands with {unit}",
        501,
        {"option": option, "unit": unit},
    )


def guard_surface_patch(body) -> None:
    """`captured_on` and `elevation_role` on a surface patch (spec §5.2 row menu, §7): M-B2."""
    for option in ("captured_on", "elevation_role"):
        if option in body.model_fields_set:
            raise option_pending(option, "M-B2")
