"""Rows and folders for asset models (spec §5). `<project>/asset_models/<model_id>/v<n>.glb`,
`<project>/asset_models/<model_id>/runs/<run_id>/`."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, AssetModelVersion
from app.errors import not_found
from app.surfaces.design.store import ID_RE


def model_dir(handle, model_id: str) -> Path:
    if not ID_RE.fullmatch(model_id or ""):
        raise not_found("asset model", model_id)
    return Path(handle.asset_models_dir) / model_id


def version_glb_path(handle, model_id: str, version: int) -> Path:
    return model_dir(handle, model_id) / f"v{int(version)}.glb"


def run_dir(handle, model_id: str, run_id: str) -> Path:
    if not ID_RE.fullmatch(run_id or ""):
        raise not_found("asset model run", run_id)
    return model_dir(handle, model_id) / "runs" / run_id


def get_model(s: Session, model_id: str) -> AssetModel:
    row = s.get(AssetModel, model_id)
    if row is None:
        raise not_found("asset model", model_id)
    return row


def get_version(s: Session, model_id: str, version: int) -> AssetModelVersion:
    row = s.scalar(
        select(AssetModelVersion).where(
            AssetModelVersion.model_id == model_id, AssetModelVersion.version == version
        )
    )
    if row is None:
        raise not_found("asset model version", f"{model_id}/v{version}")
    return row


def next_version_number(s: Session, model_id: str) -> int:
    top = s.scalar(select(func.max(AssetModelVersion.version)).where(AssetModelVersion.model_id == model_id))
    return (top or 0) + 1
