"""An asset finding's page (spec 2026-10-02-asset-findings §10): the kicker; the representative
sighting's photo with its polygon and a close-up (image_crop snapshots); the 3D locator (an
asset_locator snapshot, decision A9); the height locator on the silhouette; the facts in the profile's
`facts` order; the note. Reads one sighting, its box, image and pose; the session closes before any
snapshot is keyed (figures/image.py's pattern)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath

from sqlalchemy import func, select

from app.db.models import AssetModel, Box, Finding, FindingSighting, Image, ImagePose
from app.reports import blocks
from app.reports.asset_drawing import height_locator
from app.reports.asset_info import NOT_PLACED, PLACED, AssetInfo, representative
from app.reports.context import ComposeContext, FindingRow
from app.reports.figures import image as image_figures
from app.reports.schemas import AssetLocatorSpec, Block, ImageCropSpec

WIDE_CONTEXT = 10.0  # the widest the image_crop spec allows (spec §9.2 bounds)
CLOSE_CONTEXT = 2.0
WIDE_OUT, WIDE_MM = (1200, 900), (120.0, 90.0)
CLOSE_OUT, CLOSE_MM = (800, 600), (83.0, 62.0)
LOCATOR_OUT, LOCATOR_MM = (900, 900), (62.0, 62.0)
LOCATOR_CAPTION = "3D model, focused on this finding. Placement is approximate."
CLOSE_CAPTION = "Close-up"
NOT_PLACED_TEXT = NOT_PLACED
DEFAULT_FACTS = ("severity", "class", "defect", "height", "zone", "component", "side", "photo", "captured")
MIN_HALF_M = 2.0
FALLBACK_HALF_M = 10.0


@dataclass(frozen=True)
class Rep:
    """The representative sighting and what its page needs, read in one short session."""

    sighting_id: str
    placed_version: int | None
    coverage: float | None
    image_id: str
    image_name: str
    capture_time: datetime | None
    lat: float | None
    lon: float | None
    alt: float | None
    annotation_id: str
    ring: list
    sequence: str | None
    hfov: float | None
    vfov: float | None


def read_rep(ctx: ComposeContext, row: FindingRow) -> Rep | None:
    with ctx.session() as s:
        sg = representative(s, row.id)
        if sg is None:
            return None
        box = s.get(Box, sg.annotation_id)
        img = s.get(Image, sg.image_id)
        if box is None or img is None:
            return None
        pose = None
        if row.asset_model_id:
            pose = s.execute(
                select(ImagePose).where(
                    ImagePose.image_id == img.id, ImagePose.asset_model_id == row.asset_model_id
                )
            ).scalar_one_or_none()
        return Rep(
            sighting_id=sg.id,
            placed_version=sg.placed_version,
            coverage=sg.coverage,
            image_id=img.id,
            image_name=img.original_name or PurePosixPath(img.path).name,
            capture_time=img.capture_time,
            lat=img.lat,
            lon=img.lon,
            alt=img.alt,
            annotation_id=box.id,
            ring=image_figures._ring(box),
            sequence=pose.sequence if pose is not None else None,
            hfov=pose.hfov_deg if pose is not None else None,
            vfov=pose.vfov_deg if pose is not None else None,
        )


def _placed(row: FindingRow) -> bool:
    return row.placement in PLACED and row.height_m is not None


def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}" + ("" if n == 1 else "s")


def sightings_phrase(unit: str | None, regions: int, photos: int) -> str:
    """Photo-unit findings are one photo with a region per mask ("3 regions on 1 photo"); region-unit
    findings keep "seen in N photos" (each sighting is a photo)."""
    regions = max(regions, 1)
    if unit == "photo":
        return f"{_plural(regions, 'region')} on {_plural(max(photos, 1), 'photo')}"
    return f"seen in {_plural(regions, 'photo')}"


def photo_count(ctx: ComposeContext, row: FindingRow) -> int:
    """Distinct photos among a finding's sightings (one indexed read)."""
    with ctx.session() as s:
        return int(
            s.execute(
                select(func.count(func.distinct(FindingSighting.image_id))).where(
                    FindingSighting.finding_id == row.id
                )
            ).scalar_one()
        )


def _phrase(ctx: ComposeContext, row: FindingRow, info: AssetInfo | None) -> str:
    unit = info.review.finding_unit if info is not None and info.review is not None else None
    return sightings_phrase(unit, row.sighting_count, photo_count(ctx, row) if unit == "photo" else 0)


def kicker(row: FindingRow, info: AssetInfo | None, phrase: str) -> str:
    parts = [f"Finding {row.label}"]
    if row.zone:
        parts.append((info.zone_label(row.zone) if info is not None else row.zone) or row.zone)
    if row.side:
        parts.append(row.side)
    if not _placed(row):
        parts.append("not placed on the model")
    parts.append(phrase)
    return " · ".join(parts)


def facts_order(info: AssetInfo | None) -> tuple[str, ...]:
    """The resolved review's `facts` (P1 copies the profile's list onto `asset_model.review`)."""
    facts = info.review.facts if info is not None and info.review is not None else None
    return tuple(facts) if facts else DEFAULT_FACTS


def half_extent_of(info: AssetInfo | None) -> float:
    """Half the locator's frame in metres: the tighter end of the review's `focus.frustum` (P1: a
    `(min, max)` pair of half-height fractions of the asset height, kit convention); never under 2 m."""
    if info is None or info.frame is None or info.review is None:
        return FALLBACK_HALF_M
    frac = float(info.review.focus.frustum[0])
    return round(max(MIN_HALF_M, frac * float(info.frame.height_m)), 3)


def oblique_of(info: AssetInfo | None) -> float:
    raw = info.review.focus.oblique_deg if info is not None and info.review is not None else 0.0
    return round(max(-89.0, min(89.0, float(raw))), 3)


def _captured(t: datetime) -> str:
    return f"{blocks.fmt_date(t)}, {t:%H:%M}"


def asset_facts(
    row: FindingRow, info: AssetInfo | None, rep: Rep | None, phrase: str
) -> list[tuple[str, str]]:
    basis = info.review.sides.basis if info is not None and info.review is not None else None
    frame = info.frame if info is not None else None
    datum = frame.datum_label if frame is not None and frame.datum_label else "ground"
    out: list[tuple[str, str]] = []
    for key in facts_order(info):
        if key == "severity":
            out.append(
                (
                    "Severity",
                    f"{row.severity} · {row.severity_name}"
                    if row.severity is not None
                    else row.severity_name,
                )
            )
        elif key == "class":
            out.append(("Type", row.type_name))
        elif key == "defect":
            out.append(("Finding", f"{row.label} · {phrase}"))
        elif key == "height":
            out.append(("Height", f"{row.height_m:.1f} m above {datum}" if _placed(row) else NOT_PLACED_TEXT))
        elif key == "zone" and row.zone:
            out.append(("Zone", (info.zone_label(row.zone) if info is not None else row.zone) or row.zone))
        elif key == "component" and row.component:
            out.append(("Component", row.component))
        elif key == "side":
            if row.side and row.bearing_deg is not None:
                tail = (
                    f"faces {row.bearing_deg:.0f}°"
                    if basis == "normal"
                    else f"{row.bearing_deg:.0f}° bearing"
                )
                out.append(("Side", f"{row.side} · {tail}"))
            else:
                out.append(("Side", NOT_PLACED_TEXT))
        elif key == "coverage" and rep is not None and rep.coverage is not None:
            out.append(("Marked area", f"{rep.coverage * 100:.2f}% of photo pixels"))
        elif key == "photo" and rep is not None:
            out.append(
                ("Source photo", rep.image_name + (f" · flight {rep.sequence}" if rep.sequence else ""))
            )
        elif key == "captured" and rep is not None and rep.capture_time is not None:
            out.append(("Captured", _captured(rep.capture_time)))
        elif key == "position" and rep is not None and rep.lat is not None and rep.lon is not None:
            alt = f" · {rep.alt:.1f} m GPS" if rep.alt is not None else ""
            out.append(("Drone position", f"{rep.lat:.6f}, {rep.lon:.6f}{alt}"))
        elif key == "camera" and rep is not None and rep.hfov is not None and rep.vfov is not None:
            out.append(("Camera", f"{rep.hfov:.1f}° × {rep.vfov:.1f}° field of view"))
        elif key == "confidence" and row.confidence is not None:
            out.append(("Confidence", f"{row.confidence:.0%}"))
    return out


def _crop(ctx: ComposeContext, row: FindingRow, rep: Rep, context: float, out, mm, caption: str):
    spec = ImageCropSpec(
        kind="image_crop",
        image_id=rep.image_id,
        annotation_id=rep.annotation_id,
        ring=rep.ring,
        colour=row.severity_colour,
        label=f"{row.label} · {row.type_name}",
        context=context,
        out=list(out),
        inset=False,
    )
    return blocks.figure(ctx.ref(spec, width_px=out[0], height_px=out[1]), caption, mm[0], mm[1])


def _normal(row: FindingRow) -> list[float]:
    if row.an_x is not None and row.an_y is not None and row.an_z is not None:
        return [round(row.an_x, 4), round(row.an_y, 4), round(row.an_z, 4)]
    h = (row.ax or 0.0, row.az or 0.0)  # no normal: look at the point from outside the axis
    return [1.0, 0.0, 0.0] if h == (0.0, 0.0) else [round(h[0], 4), 0.0, round(h[1], 4)]


def _locator(ctx: ComposeContext, row: FindingRow, info: AssetInfo | None, rep: Rep | None):
    if not _placed(row) or row.ax is None or row.ay is None or row.az is None or not row.asset_model_id:
        return None
    version = (
        (rep.placed_version if rep is not None else None)
        or row.asset_version
        or (info.current_version if info else None)
    )
    if not version:
        return None
    mark = "patch" if row.placement == "patch" else "pin"
    spec = AssetLocatorSpec(
        kind="asset_locator",
        asset_model_id=row.asset_model_id,
        version=int(version),
        sighting_id=rep.sighting_id if mark == "patch" and rep is not None else None,
        mark=mark,
        center=[round(row.ax, 3), round(row.ay, 3), round(row.az, 3)],
        normal=_normal(row),
        half_extent_m=half_extent_of(info),
        oblique_deg=oblique_of(info),
        colour=row.severity_colour,
        out=list(LOCATOR_OUT),
    )
    ref = ctx.ref(spec, width_px=LOCATOR_OUT[0], height_px=LOCATOR_OUT[1])
    return blocks.figure(ref, LOCATOR_CAPTION, *LOCATOR_MM)


def asset_finding_block(ctx: ComposeContext, row: FindingRow) -> Block:
    opts = ctx.options("finding_pages")
    kinds = {str(k) for k in opts.snapshots}
    info = ctx.asset_models.get(row.asset_model_id) if row.asset_model_id else None
    rep = read_rep(ctx, row)
    phrase = _phrase(ctx, row, info)
    wide = close = None
    if "image" in kinds and rep is not None:
        wide = _crop(ctx, row, rep, WIDE_CONTEXT, WIDE_OUT, WIDE_MM, f"Source photograph {rep.image_name}")
        close = _crop(ctx, row, rep, CLOSE_CONTEXT, CLOSE_OUT, CLOSE_MM, CLOSE_CAPTION)
    locator = _locator(ctx, row, info, rep) if "cloud" in kinds else None
    figures = [f for f in (wide, locator, close) if f is not None]
    loc = None
    if _placed(row) and info is not None and info.frame is not None:
        loc = height_locator(
            info.frame.height_m, info.frame.silhouette, info.frame.levels, row.height_m, row.severity_colour
        )
    photos = image_figures.photos(ctx, row, opts.photos_max) if opts.photos_max > 0 else []
    comments = image_figures.comments(ctx, row, str(opts.comments)) if str(opts.comments) != "none" else []
    return blocks.finding(
        row,
        figures=figures,
        kv_rows=asset_facts(row, info, rep, phrase),
        photos=photos,
        comments=comments,
        asset={"kicker": kicker(row, info, phrase), "height_locator": loc},
    )


def fingerprint(ctx: ComposeContext) -> str:
    """Sightings, frames and poses change no finding row; their latest change joins the etag."""
    ids = select(Finding.id).where(ctx.where, Finding.anchor_kind == "asset")
    with ctx.session() as s:
        n, last = s.execute(
            select(func.count(), func.max(FindingSighting.created_at)).where(
                FindingSighting.finding_id.in_(ids)
            )
        ).one()
        models = s.execute(select(func.max(AssetModel.updated_at))).scalar()
        poses = s.execute(select(func.max(ImagePose.updated_at))).scalar()
    stamp = [v.isoformat() if v is not None else "" for v in (last, models, poses)]
    return f"asset:{n}:{':'.join(stamp)}"
