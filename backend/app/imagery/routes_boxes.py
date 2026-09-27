"""Annotations and image length measurements (image inspection spec §8, §9.3). Unit I-BA moves the
kept box routes here from `app/datasets/router.py` and replaces the measurement stubs below."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/images/{imageId}/measurements", "listImageMeasurements"),
    ("POST", "/images/{imageId}/measurements", "createImageMeasurement"),
    ("DELETE", "/image-measurements/{imageMeasurementId}", "deleteImageMeasurement"),
]

add_stubs(router, STUBS)
