"""Detection runs and class mapping (spec 2026-09-23 sections 7.2-7.4; plan 2 unit R).

`api.py` includes this router with `require_kind(("detect",))`: runs belong to detection projects.
"""

from fastapi import APIRouter, Depends, Request

from app.detect import class_maps
from app.detect.schemas import ModelClassMapOut, ModelClassMapPut
from app.library import service as library
from app.library.db import LibraryModel
from app.library.handle import library_unavailable
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["detect"])


def _model(request: Request, model_id: str) -> LibraryModel:
    lib = getattr(request.app.state, "library", None)
    if lib is None:
        raise library_unavailable()
    return library.get_model(lib, model_id)


def _class_map_out(handle: ProjectHandle, model: LibraryModel) -> ModelClassMapOut:
    mapping, unmapped = class_maps.resolve(handle, model)
    return ModelClassMapOut(
        model_id=model.id, model_classes=list(model.class_names or []), mapping=mapping, unmapped=unmapped
    )


@router.get("/model-class-maps/{modelId}", response_model=ModelClassMapOut)
def get_model_class_map(
    modelId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ModelClassMapOut:
    return _class_map_out(handle, _model(request, modelId))


@router.put("/model-class-maps/{modelId}", response_model=ModelClassMapOut)
def put_model_class_map(
    modelId: str,  # noqa: N803
    body: ModelClassMapPut,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ModelClassMapOut:
    model = _model(request, modelId)
    class_maps.put(handle, model, body.mapping, body.new_classes)
    return _class_map_out(handle, model)
