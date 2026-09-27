"""Smart polygon (SAM 2.1 tiny): the segment prompts and the assist model catalogue (image
inspection spec §10, §14; I-BS rulings BS1-BS3, BS8). `app/api.py` includes this router under a
guard. Nothing here imports torch: the SAM backend loads on the first prepare/segment call
(`service.default_backend_factory`), so a broken stack costs only these endpoints' answers."""

import threading
from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.assist import catalogue, geometry
from app.assist.errors import AssistUnavailable
from app.assist.jobs_acquire import (  # noqa: F401 - registers `assist_acquire`
    live_acquire_id,
    run_assist_acquire,
)
from app.assist.schemas import (
    AssistModel,
    AssistModelImport,
    AssistModelPage,
    SegmentCrop,
    SegmentPrepared,
    SegmentPrepareRequest,
    SegmentRequest,
    SegmentResult,
)
from app.assist.service import SegmentService
from app.datasets.images import get_image, image_file
from app.errors import AppError
from app.jobs.schemas import JobOut
from app.library.handle import LibraryHandle, get_library
from app.library.paths import library_root
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

_project = APIRouter(prefix="/projects/{projectId}", tags=["assist"])
_library = APIRouter(prefix="/library", tags=["assist"])

# I-C0's stub lists; every operation is built now (tests/test_images_stubs.py reads them).
STUBS: list[tuple[str, str, str]] = []
LIBRARY_STUBS: list[tuple[str, str, str]] = []

_service_lock = threading.Lock()


def get_segment_service(request: Request) -> SegmentService:
    state = request.app.state
    with _service_lock:
        if getattr(state, "segment_service", None) is None:
            state.segment_service = SegmentService()
        return state.segment_service


def _library_folder(request: Request) -> Path:
    # Must equal the library handle's `lib.folder` used by the catalogue and acquire job
    # (app/library/handle.py sets `lib.folder` from this same `library_root`) — segment routes take
    # only the settings, not a `LibraryHandle`, so this recomputes the same path rather than sharing it.
    return library_root(request.app.state.settings.data_dir)


# ---------------------------------------------------------------- the catalogue (library)


@_library.get("/assist-models", response_model=AssistModelPage)
def list_assist_models(request: Request, lib: LibraryHandle = Depends(get_library)) -> AssistModelPage:
    reason = get_segment_service(request).unavailable_reason  # set once the lazy SAM import failed
    items = [
        AssistModel(**catalogue.status(spec, lib.folder, live_acquire_id(lib, spec.key), reason))
        for spec in catalogue.ASSIST_MODELS.values()
    ]
    return AssistModelPage(items=items, next_cursor=None)


@_library.post("/assist-models/{key}/acquire", response_model=JobRef, status_code=202)
def acquire_assist_model(key: str, request: Request, lib: LibraryHandle = Depends(get_library)) -> JobRef:
    spec = catalogue.get_spec(key)
    live = live_acquire_id(lib, spec.key)
    if live is not None:
        raise AppError("job_running", f"{spec.name} is already being fetched.", 409, {"job_id": live})
    job = request.app.state.jobs.submit(lib, "assist_acquire", {"key": spec.key})
    return JobRef(job=JobOut.from_row(job, lib.id))


@_library.post("/assist-models/{key}/import", response_model=JobRef, status_code=202)
def import_assist_model(
    key: str, body: AssistModelImport, request: Request, lib: LibraryHandle = Depends(get_library)
) -> JobRef:
    spec = catalogue.get_spec(key)
    source = Path(body.path)
    # Same rule as importLibraryModel: schema-valid but unusable is a 404, never a 422 (conformance gate).
    if not source.is_absolute() or source.suffix.lower() != ".pt" or not source.is_file():
        raise AppError(
            "not_found",
            f"no usable weights at {body.path}: an absolute path to an existing .pt file is required",
            404,
        )
    job = request.app.state.jobs.submit(lib, "assist_acquire", {"key": spec.key, "path": str(source)})
    return JobRef(job=JobOut.from_row(job, lib.id))


# ---------------------------------------------------------------- per image


def _frame(handle: ProjectHandle, image_id: str):
    image = get_image(handle, image_id)[0]
    return image, image_file(handle, image_id, None)


def _unavailable(e: AssistUnavailable) -> AppError:
    # Ruling F9: the catalogue owns the "unavailable" sentence; never a second copy of it here.
    return catalogue.missing_error("unavailable", catalogue.unavailable_message(str(e)))


def _prologue(handle: ProjectHandle, image_id: str, request: Request, crop_in: SegmentCrop):
    """Project/image lookup, file, quantised crop and the weights gate: the prologue shared by
    prepare and segment (ruling F9). The gate checks only the weights FILE state (missing/invalid,
    ruling F2) — it never pre-checks `svc.unavailable_reason`; an unavailable SAM is instead
    reported by the service call itself (see the routes below), so a later successful load clears
    the state (BS7)."""
    image, path = _frame(handle, image_id)
    svc = get_segment_service(request)
    weights = catalogue.require_ready(_library_folder(request), None)
    crop = geometry.quantise_crop(crop_in.x, crop_in.y, crop_in.w, crop_in.h, image.width, image.height)
    return image, path, svc, weights, crop


@_project.post("/images/{imageId}/segment/prepare", response_model=SegmentPrepared)
def prepare_image_segment(
    imageId: str,  # noqa: N803 - path param from the contract
    body: SegmentPrepareRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> SegmentPrepared:
    image, path, svc, weights, crop = _prologue(handle, imageId, request, body.crop)
    try:
        r = svc.prepare((handle.id, image.id), path, crop, weights)
    except AssistUnavailable as e:
        raise _unavailable(e) from e
    return SegmentPrepared(
        crop=SegmentCrop(**crop.as_dict()), device=r.device, encode_ms=r.encode_ms, cached=r.cached
    )


@_project.post("/images/{imageId}/segment", response_model=SegmentResult)
def segment_image(
    imageId: str,  # noqa: N803 - path param from the contract
    body: SegmentRequest,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> SegmentResult:
    image, path, svc, weights, crop = _prologue(handle, imageId, request, body.crop)
    outside = [p for p in body.points if not crop.contains(p.x, p.y)]
    if outside:
        raise AppError(
            "points_outside_crop",
            f"{len(outside)} point(s) lie outside the prepared view; prepare the new view first",
            422,
            {"crop": crop.as_dict()},
        )
    points = [(p.x, p.y) for p in body.points]
    labels = [1 if p.positive else 0 for p in body.points]
    try:
        r = svc.segment((handle.id, image.id), path, crop, weights, points, labels)
    except AssistUnavailable as e:
        raise _unavailable(e) from e
    return SegmentResult(
        polygon=r.polygon,
        score=r.score,
        device=r.device,
        encode_ms=r.encode_ms,
        decode_ms=r.decode_ms,
        crop=SegmentCrop(**crop.as_dict()),
    )


router = APIRouter()
router.include_router(_project)
router.include_router(_library)
