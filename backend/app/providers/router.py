"""S0 stubs for cloud providers (spec section 8). S4 replaces them."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/providers", tags=["providers"])

add_stubs(
    router,
    [
        ("GET", "", "providers list"),
        ("PATCH", "/{provider}", "providers update"),
        ("PUT", "/{provider}/key", "providers set key"),
        ("DELETE", "/{provider}/key", "providers delete key"),
        ("POST", "/{provider}/test", "providers test"),
    ],
    project_scoped=False,
)
