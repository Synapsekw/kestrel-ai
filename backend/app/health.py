import os

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
def health(request: Request) -> dict:
    s = request.app.state.settings
    return {
        "status": "ok",
        "version": s.version,
        "pid": os.getpid(),
        "started_at": request.app.state.started_at,
    }
