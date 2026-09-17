"""S0 stubs for sources, images, boxes and datasets (spec sections 5 and 6). S1 replaces them."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["datasets"])

add_stubs(
    router,
    [
        ("GET", "/sources", "sources list"),
        ("POST", "/sources", "sources create"),
        ("GET", "/sources/{sourceId}", "sources get"),
        ("GET", "/sources/{sourceId}/stats", "sources stats"),
        ("GET", "/images", "images list"),
        ("POST", "/images/bulk-delete", "images bulk-delete"),
        ("GET", "/images/{imageId}", "images get"),
        ("GET", "/images/{imageId}/file", "images file"),
        ("GET", "/images/{imageId}/thumbnail", "images thumbnail"),
        ("GET", "/images/{imageId}/boxes", "boxes list"),
        ("POST", "/images/{imageId}/boxes", "boxes create"),
        ("PATCH", "/boxes/{boxId}", "boxes update"),
        ("DELETE", "/boxes/{boxId}", "boxes delete"),
        ("POST", "/boxes/review", "boxes review"),
        ("GET", "/datasets", "datasets list"),
        ("POST", "/datasets", "datasets create"),
        ("GET", "/datasets/{datasetId}", "datasets get"),
        ("GET", "/datasets/{datasetId}/stats", "datasets stats"),
    ],
)
