"""501 placeholders for the brands API (spec 2026-10-02-asset-findings §5.8, §8; plan
2026-10-03-asset-findings-c0) until D2 lands.

Brands are app-wide, not per project: paths are relative to `/api/v1`. D2 Task 4 replaced the
CRUD tuples with `app/brands/router.py`; Task 5 deletes the logo tuples, this module, its line in
`app/api.py`, and the `EXPECTED_STUBS |=` line with its import in `tests/test_contract.py`.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

Stub = tuple[str, str, str]

B = "/brands"

# D2: the brand logos (the brand CRUD is real, in app/brands/router.py).
D2_STUBS: list[Stub] = [
    ("GET", B + "/{brandId}/logos/{slot}", "getBrandLogo"),
    ("PUT", B + "/{brandId}/logos/{slot}", "setBrandLogo"),
    ("DELETE", B + "/{brandId}/logos/{slot}", "clearBrandLogo"),
]

STUBS: list[Stub] = [*D2_STUBS]

router = APIRouter(tags=["brands"])
add_stubs(router, STUBS, project_scoped=False)


def stub_operation_ids() -> set[str]:
    """Every brands operation still answered by a 501 stub."""
    return {op_id for _, _, op_id in STUBS}
