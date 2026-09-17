"""S0 stubs for the model registry and training (spec section 7). S3 replaces them."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}/models", tags=["models"])

add_stubs(
    router,
    [
        ("GET", "", "models list"),
        ("POST", "/import", "models import"),
        ("POST", "/train", "models train"),
        ("GET", "/{modelId}", "models get"),
        ("DELETE", "/{modelId}", "models delete"),
        ("POST", "/{modelId}/export", "models export"),
    ],
)
