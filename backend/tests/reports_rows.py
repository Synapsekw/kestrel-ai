"""Rows and configs for the report compose tests (plan R2). Findings go straight into the project DB,
so 201 of them take well under a second. Configs are built through R0's ReportConfig."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime

from sqlalchemy import func, select

from app.db.models import Box, Finding, GeoMap, Image, PointCloud, ProjectType, Source
from app.reports.models import Report, ReportAsset, ReportVersion, ReportVersionFinding
from app.reports.schemas import SECTION_KEYS, ReportConfig

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
GEN = datetime(2026, 9, 30, 9, 0, tzinfo=UTC)  # "today" is 30 Sep 2026


def config(*, sections=("summary",), filters=None, cover=None, options=None) -> ReportConfig:
    """`sections` names which of the 8 fixed section keys are enabled (R0's ReportConfig always
    carries all 8, spec 7.2); the rest are present but disabled. `options` maps a key to its options."""
    options = options or {}
    return ReportConfig.model_validate(
        {
            "cover": {"title": "Site inspection", "author": "D. J.", **(cover or {})},
            "paper": {"size": "A4", "orientation": "portrait"},
            "filters": {
                "severity_min": None,
                "include_ungraded": True,
                "statuses": ["open", "reviewed", "closed"],
                "type_ids": None,
                "data_item_ids": None,
                "date": {"rule": "all"},
                **(filters or {}),
            },
            "sections": [
                {"key": k, "enabled": k in sections, "options": options.get(k, {})} for k in SECTION_KEYS
            ],
        }
    )


def fake_key(spec) -> str:
    return hashlib.sha256(json.dumps(spec.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()[:32]


def ctx_for(handle, cfg, *, baseline=None, report_id="r-test", **kw):
    from app.reports.compose import ComposeContext

    kw.setdefault("key_for", fake_key)
    return ComposeContext(
        handle=handle, config=cfg, report_id=report_id, baseline=baseline, generated_at=GEN, **kw
    )


def add_type(handle, name: str, *, colour: str = "#ff5a4f", kind: str = "defect") -> str:
    with handle.session() as s:
        pos = s.execute(select(func.coalesce(func.max(ProjectType.position), -1))).scalar_one() + 1
        s.add(ProjectType(type_id=f"type-{name}", position=pos, name=name, colour=colour, kind=kind))
    return f"type-{name}"


def add_image(
    handle, *, captured_on: date | None = None, capture_time: datetime | None = None, label: str = "Flight"
) -> tuple[str, str]:
    with handle.session() as s:
        src = Source(folder="D:/flights/a", site="A", label=label, captured_on=captured_on)
        s.add(src)
        s.flush()
        img = Image(
            path=f"images/{uuid.uuid4().hex}.jpg",
            width=4000,
            height=3000,
            source_id=src.id,
            capture_time=capture_time,
        )
        s.add(img)
        s.flush()
        return img.id, src.id


def add_map(
    handle,
    *,
    name: str = "Ortho",
    captured_on: date | None = None,
    bounds=None,
    status: str = "ready",
    created_at: datetime = T0,
    crs_wkt: str | None = None,
) -> str:
    with handle.session() as s:
        row = GeoMap(
            name=name,
            status=status,
            source_path="D:/orthos/site.tif",
            source_size=1,
            width=100,
            height=80,
            gsd_cm=2.5,
            epsg=32633,
            captured_on=captured_on,
            bounds_native=bounds,
            created_at=created_at,
            crs_wkt=crs_wkt,
        )
        s.add(row)
        s.flush()
        return row.id


def add_cloud(handle, *, name: str = "Scan", captured_on: date | None = None) -> str:
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status="ready",
            source_path="D:/clouds/x.laz",
            source_size=1,
            point_count=1000,
            epsg=32633,
            captured_on=captured_on,
        )
        s.add(row)
        s.flush()
        return row.id


def _anchor(s, anchor: str, target: str, type_id: str, geometry: dict | None) -> dict:
    if anchor == "image":
        image = s.get(Image, target)
        box = Box(
            image_id=image.id,
            class_id=type_id,
            x=0.5,
            y=0.5,
            w=0.1,
            h=0.1,
            provenance_kind="person",
            review_state="accepted",
        )
        s.add(box)
        s.flush()
        return {
            "anchor_kind": "image",
            "image_id": image.id,
            "annotation_id": box.id,
            "data_type": "image_set",
            "data_id": image.source_id,
        }
    if anchor == "map":
        return {
            "anchor_kind": "map",
            "map_id": target,
            "geometry": geometry or {"type": "Point", "coordinates": [500010.0, 5000010.0]},
            "data_type": "map",
            "data_id": target,
        }
    return {
        "anchor_kind": "cloud",
        "cloud_id": target,
        "x": 1.0,
        "y": 2.0,
        "z": 3.0,
        "data_type": "point_cloud",
        "data_id": target,
    }


def add_findings(handle, specs: Iterable[dict]) -> list[str]:
    """specs: dicts of type_id, anchor ("image"|"map"|"cloud"), target, and optional severity,
    status, note, created_by, confidence, created_at, updated_at, lon, lat, geometry, number."""
    ids = []
    with handle.session() as s:
        top = s.execute(select(func.coalesce(func.max(Finding.number), 0))).scalar_one()
        for i, spec in enumerate(specs, start=1):
            created = spec.get("created_at", T0)
            row = Finding(
                number=spec.get("number") or top + i,
                type_id=spec["type_id"],
                severity=spec.get("severity"),
                status=spec.get("status", "open"),
                note=spec.get("note", ""),
                created_by=spec.get("created_by", "human"),
                confidence=spec.get("confidence"),
                lon=spec.get("lon"),
                lat=spec.get("lat"),
                created_at=created,
                updated_at=spec.get("updated_at", created),
                **_anchor(
                    s, spec.get("anchor", "cloud"), spec["target"], spec["type_id"], spec.get("geometry")
                ),
            )
            s.add(row)
            s.flush()
            ids.append(row.id)
    return ids


def add_finding(handle, type_id: str, **spec) -> str:
    return add_findings(handle, [{"type_id": type_id, **spec}])[0]


def add_report(handle, cfg: ReportConfig, *, title: str = "Site report") -> str:
    with handle.session() as s:
        row = Report(title=title, config=cfg.model_dump(mode="json", by_alias=True))
        s.add(row)
        s.flush()
        return row.id


def add_version(
    handle,
    report_id: str,
    *,
    number: int,
    issued_at: datetime | None = None,
    state: str = "ready",
    created_at: datetime = T0,
    rows=(),
) -> str:
    """rows: (finding_id, type_id, severity, status). Fill any further NOT NULL column R0 declares."""
    with handle.session() as s:
        v = ReportVersion(
            report_id=report_id,
            number=number,
            state=state,
            issued_at=issued_at,
            folder=f"reports/{report_id}/v{number:03d}",
            files=[],
            config={},
            stats={},
            created_at=created_at,
        )
        s.add(v)
        s.flush()
        for fid, tid, sev, st in rows:
            s.add(ReportVersionFinding(version_id=v.id, finding_id=fid, type_id=tid, severity=sev, status=st))
        return v.id


def add_asset(handle, *, path: str = "reports/assets/logo-abcd1234.png", width=600, height=200) -> str:
    with handle.session() as s:
        row = ReportAsset(kind="logo", path=path, sha256="ab" * 32, width=width, height=height)
        s.add(row)
        s.flush()
        return row.id
