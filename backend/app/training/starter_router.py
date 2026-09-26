"""The detection starter catalogue. Acquiring a starter is a library job (`app.library.router`)."""

from fastapi import APIRouter, Request

from app.training import starter
from app.training.schemas import StarterModelOut, StarterModelPage

router = APIRouter(tags=["models"])


@router.get("/starter-models", response_model=StarterModelPage)
def list_starter_models(request: Request) -> StarterModelPage:
    folder = starter.weights_dir(request.app.state.settings)
    items = [
        StarterModelOut(**item)
        for item in starter.list_starters(folder, request.app.state.settings.data_dir / "starter_weights")
    ]
    return StarterModelPage(items=items, next_cursor=None)
