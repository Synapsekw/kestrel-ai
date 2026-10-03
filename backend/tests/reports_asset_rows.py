"""Asset findings straight into the project DB for the report tests (spec 2026-10-02-asset-findings
§5). Synthetic numbers only: no customer data (index Global Constraints)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.asset_review.frame import Frame
from app.asset_review.profiles import resolve
from app.db.base import new_id
from app.db.models import (
    AssetModel,
    AssetModelVersion,
    Box,
    Finding,
    FindingSighting,
    Image,
    ImagePose,
    ImageReview,
    Source,
)

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
HEIGHT = 60.0


def frame_of(height: float = HEIGHT) -> Frame:
    return Frame.model_validate(
        {
            "origin": None,
            "north_offset_deg": 0.0,
            "height_m": height,
            "datum_label": "street level",
            "datum_note": "",
            "line_azimuth_deg": None,
            "silhouette": [[0.0, 6.0], [height / 2, 5.0], [height, 4.0]],
            "levels": [height / 3, 2 * height / 3],
            "presets": [],
        }
    )


def add_asset_model(
    handle, *, name: str = "Tower A", profile: str = "building_facade", height: float = HEIGHT
):
    """(model_id, review, frame) with version 1 recorded as imported."""
    frame = frame_of(height)
    review = resolve(profile, height)
    with handle.session() as s:
        m = AssetModel(
            name=name,
            status="ready",
            current_version=1,
            frame=frame.model_dump(mode="json"),
            review=review.model_dump(mode="json"),
        )
        s.add(m)
        s.flush()
        s.add(
            AssetModelVersion(model_id=m.id, version=1, spec={}, kind="imported", glb_status="ready", meta={})
        )
        return m.id, review, frame


def add_asset_image(
    handle,
    *,
    name: str,
    lat: float | None = 25.08,
    lon: float | None = 55.14,
    alt: float | None = 120.5,
    capture: datetime | None = T0,
) -> str:
    with handle.session() as s:
        src = s.execute(select(Source).where(Source.label == "Facade")).scalar_one_or_none()
        if src is None:
            src = Source(folder="D:/flights/facade", site="Tower", label="Facade")
            s.add(src)
            s.flush()
        img = Image(
            path=f"images/{uuid.uuid4().hex}.jpg",
            width=4000,
            height=3000,
            source_id=src.id,
            capture_time=capture,
            lat=lat,
            lon=lon,
            alt=alt,
            original_name=name,
        )
        s.add(img)
        s.flush()
        return img.id


def add_pose(
    handle, image_id: str, model_id: str, *, target=(0.0, 38.0, 0.0), sequence: str | None = "1"
) -> None:
    with handle.session() as s:
        s.add(
            ImagePose(
                image_id=image_id,
                asset_model_id=model_id,
                position=[30.0, 38.0, 0.0],
                target=list(target),
                up=[0.0, 1.0, 0.0],
                hfov_deg=70.0,
                vfov_deg=52.0,
                source="kit",
                accuracy_m=None,
                sequence=sequence,
                updated_at=T0,
            )
        )


def add_review(handle, image_id: str, status: str, *, note: str = "", coverage: float | None = None) -> None:
    with handle.session() as s:
        s.add(
            ImageReview(
                image_id=image_id,
                status=status,
                note=note,
                coverage=coverage,
                uncertain_coverage=None,
                updated_at=T0,
            )
        )


def add_asset_finding(
    handle,
    model_id: str,
    type_id: str,
    *,
    sightings: list[dict],
    severity: int | None = 2,
    status: str = "open",
    note: str = "",
    zone: str | None = None,
    side: str | None = None,
    height: float | None = None,
    bearing: float | None = None,
    placement: str = "patch",
    center: tuple[float, float, float] | None = None,
    normal: tuple[float, float, float] | None = None,
    component: str | None = None,
    number: int | None = None,
) -> str:
    """One asset finding and its sightings. A sighting dict: image_id, and optional severity,
    placement, center, normal, coverage, part, created_at, points (a polygon in image px)."""
    with handle.session() as s:
        top = s.execute(select(func.coalesce(func.max(Finding.number), 0))).scalar_one()
        f = Finding(
            number=number or top + 1,
            type_id=type_id,
            severity=severity,
            status=status,
            note=note,
            anchor_kind="asset",
            asset_model_id=model_id,
            asset_version=1,
            ax=center[0] if center else None,
            ay=center[1] if center else None,
            az=center[2] if center else None,
            an_x=normal[0] if normal else None,
            an_y=normal[1] if normal else None,
            an_z=normal[2] if normal else None,
            placement=placement,
            height_m=height,
            bearing_deg=bearing,
            side=side,
            zone=zone,
            component=component,
            sighting_count=len(sightings),
            data_type="asset_model",
            data_id=model_id,
            created_at=T0,
            updated_at=T0,
        )
        s.add(f)
        s.flush()
        for i, sg in enumerate(sightings):
            pts = sg.get("points") or [[100.0, 80.0], [140.0, 80.0], [140.0, 110.0], [100.0, 110.0]]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            box = Box(
                image_id=sg["image_id"],
                class_id=type_id,
                x=min(xs),
                y=min(ys),
                w=max(xs) - min(xs),
                h=max(ys) - min(ys),
                shape="polygon",
                points=pts,
                provenance_kind="person",
                review_state="accepted",
            )
            s.add(box)
            s.flush()
            c, n = sg.get("center"), sg.get("normal")
            s.add(
                FindingSighting(
                    id=sg.get("id") or new_id(),
                    finding_id=f.id,
                    asset_model_id=model_id,
                    image_id=sg["image_id"],
                    annotation_id=box.id,
                    severity=sg.get("severity", severity),
                    group_tag=None,
                    placement=sg.get("placement", placement),
                    cx=c[0] if c else None,
                    cy=c[1] if c else None,
                    cz=c[2] if c else None,
                    nx=n[0] if n else None,
                    ny=n[1] if n else None,
                    nz=n[2] if n else None,
                    part=sg.get("part"),
                    coverage=sg.get("coverage"),
                    patch_path=None,
                    placed_version=1 if c else None,
                    created_at=sg.get("created_at", T0.replace(minute=i)),
                )
            )
        return f.id
