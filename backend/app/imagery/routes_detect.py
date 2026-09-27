"""Interactive and batch detection (image inspection spec §11.2, §11.3). Unit I-BP replaces the
stubs below (and may delete the deprecated preannotate route in `app/inference/router.py`)."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["image-detect"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/images/{imageId}/detect", "detectImage"),
    ("POST", "/images/detect-batch", "detectImageBatch"),
]

add_stubs(router, STUBS)
