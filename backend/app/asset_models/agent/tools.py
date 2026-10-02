# backend/app/asset_models/agent/tools.py
"""The build agent's tools (spec 2026-10-02 §7.3). App code only; every read bounded; never raises.

A tool returns text for the model, a short app-written summary for the run's step list, an optional
JPEG, and the phase it belongs to (reading / building / checking).
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.asset_models import store
from app.asset_models.build import build_meshes
from app.asset_models.compare import CloudTransform, cloud_to_asset, compare
from app.asset_models.look import LookError, LookImage
from app.asset_models.look.cloud import CloudSample, cloud_fit, cloud_slice
from app.asset_models.look.drawing import drawing_text, drawing_view
from app.asset_models.look.photo import photo_view
from app.asset_models.raster import View, grid, render
from app.asset_models.spec import AssetInfo, AssetSpec, Part
from app.asset_models.validate import validate
from app.project_agent.history import ToolSpec
from app.project_agent.tools import clean_schema

MAX_IMAGES = 40
MAX_TEXT = 8000
MAX_RENDER_PX = 1024
OVERLAY_POINTS = 300_000
Region = Annotated[list[float], Field(min_length=4, max_length=4)]


@dataclass
class ToolOut:
    text: str
    summary: str
    ok: bool = True
    image: bytes | None = None
    phase: str = "reading"


@dataclass
class RunContext:
    handle: object
    model_id: str
    run_id: str
    sources: list[dict]
    spec: AssetSpec
    samples: dict[str, CloudSample]
    run_dir: Path | None = None
    images_sent: int = 0
    comparison: dict | None = None
    finished: dict | None = None
    _ids: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.run_dir is None:
            self.run_dir = store.run_dir(self.handle, self.model_id, self.run_id)

    def source_ids(self, kind: str) -> set[str]:
        return {s["id"] for s in self.sources if s["type"] == kind}

    def save_working(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.run_dir / "working.json.tmp"
        tmp.write_text(self.spec.model_dump_json(), encoding="utf-8")
        tmp.replace(self.run_dir / "working.json")


class _A(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _image(ctx: RunContext, img: LookImage | bytes, text: str, summary: str, phase: str) -> ToolOut:
    data = img.jpeg if isinstance(img, LookImage) else img
    if ctx.images_sent >= MAX_IMAGES:
        return ToolOut(
            text + "\n(The image budget for this run is used up, so no image was attached.)",
            summary,
            phase=phase,
        )
    ctx.images_sent += 1
    return ToolOut(text, summary, image=data, phase=phase)


def _png_to_jpeg(png: bytes) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


# ------------------------------------------------------------------ look
class NoArgs(_A):
    pass


class ListSources:
    name, Args = "list_sources", NoArgs
    description = "List the drawings, point clouds and photos chosen for this run, with ids and basic facts."

    def run(self, ctx, a):
        lines = [
            f"{s['type']} {s['id']}: {s.get('label', '')} {s.get('facts', '')}".strip() for s in ctx.sources
        ]
        return ToolOut("\n".join(lines) or "No sources.", f"Listed {len(ctx.sources)} sources")


class DrawingViewArgs(_A):
    drawing_id: str
    region: Region | None = Field(None, description="[x0, y0, x1, y1] page fractions, (0,0) top-left")


class DrawingView:
    name, Args = "drawing_view", DrawingViewArgs
    description = (
        "See a drawing page, or zoom into a region of it. Image <= 1600 px. Works for png/jpg/tif/pdf "
        "drawings only: DXF and LandXML have no rendered page (for DXF use drawing_text; LandXML can't be "
        "read by either tool). region = [x0, y0, x1, y1] page fractions, (0,0) top-left."
    )

    def run(self, ctx, a):
        if a.drawing_id not in ctx.source_ids("drawing"):
            raise LookError("That drawing is not one of this run's sources.")
        img = drawing_view(ctx.handle, a.drawing_id, a.region)
        return _image(
            ctx,
            img,
            f"Drawing image {img.width}x{img.height}. {img.note}".strip(),
            "Looked at a drawing",
            "reading",
        )


class DrawingText:
    name, Args = "drawing_text", DrawingViewArgs
    description = (
        "Exact text on a drawing (vector PDF or DXF) with positions as page fractions; use it for "
        "dimensions, nozzle schedules and the title block. Works on vector PDF and DXF; "
        "a scanned PDF returns no spans with a note, then read the image with drawing_view."
    )

    def run(self, ctx, a):
        if a.drawing_id not in ctx.source_ids("drawing"):
            raise LookError("That drawing is not one of this run's sources.")
        r = drawing_text(ctx.handle, a.drawing_id, a.region)
        body = json.dumps(r.spans, separators=(",", ":"))
        extra = " (more spans exist - ask for a smaller region)" if r.truncated else ""
        return ToolOut((r.note + "\n" if r.note else "") + body + extra, f"Read {len(r.spans)} text spans")


class SliceArgs(_A):
    cloud_id: str
    axis: Literal["x", "y", "z"]
    at_m: float
    thickness_m: float = Field(gt=0, le=2)


def _sample(ctx, cloud_id) -> CloudSample:
    if cloud_id not in ctx.samples:
        raise LookError("That point cloud is not one of this run's sources.")
    return ctx.samples[cloud_id]


class CloudSlice:
    name, Args = "cloud_slice", SliceArgs
    description = (
        "A thin slab of a point cloud as an image with axis ticks, plus some of its points. "
        "Cloud coordinates, metres, Z up."
    )

    def run(self, ctx, a):
        r = cloud_slice(_sample(ctx, a.cloud_id), a.axis, a.at_m, a.thickness_m)
        text = json.dumps(
            {"in_slab": r.in_slab, "note": r.note, "points": r.points[:400]}, separators=(",", ":")
        )
        return _image(ctx, _png_to_jpeg(r.png), text, f"Sliced a cloud at {a.axis}={a.at_m:.2f} m", "reading")


class FitArgs(_A):
    cloud_id: str
    kind: Literal["circle", "cylinder_vertical", "plane"]
    region: Annotated[list[float], Field(min_length=6, max_length=6)] | None = Field(
        None, description="[xmin, ymin, zmin, xmax, ymax, zmax] in cloud coordinates"
    )


class CloudFit:
    name, Args = "cloud_fit", FitArgs
    description = (
        "Fit a circle (in plan), a vertical cylinder or a plane to the cloud points in a box. kind: circle | "
        "cylinder_vertical | plane. region = 6 numbers [xmin, ymin, zmin, xmax, ymax, zmax] in the cloud's "
        "absolute coordinates, metres, Z up."
    )

    def run(self, ctx, a):
        r = cloud_fit(_sample(ctx, a.cloud_id), a.kind, a.region)
        return ToolOut(json.dumps(r, separators=(",", ":")), f"Fitted a {a.kind}")


class PhotoArgs(_A):
    image_id: str
    region: Region | None = None


class PhotoView:
    name, Args = "photo_view", PhotoArgs
    description = (
        "See a photo, or zoom into a region of it. Image <= 1600 px. "
        "region = 4 fractions of the photo [x0, y0, x1, y1]."
    )

    def run(self, ctx, a):
        if a.image_id not in ctx.source_ids("image"):
            raise LookError("That photo is not one of this run's sources.")
        img = photo_view(ctx.handle, a.image_id, a.region)
        return _image(ctx, img, f"Photo {img.width}x{img.height}.", "Looked at a photo", "reading")


class GetSpecArgs(_A):
    start: int = Field(0, ge=0)


class GetSpec:
    name, Args = "get_spec", GetSpecArgs
    description = "The working model spec as JSON, paged by part index when long."

    def run(self, ctx, a):
        doc = ctx.spec.model_dump(mode="json", exclude_none=True)
        asset = json.dumps(doc["asset"], separators=(",", ":"))
        budget = MAX_TEXT - len(asset) - 100  # room for the wrapper keys and next_start
        out, used, i = [], 0, a.start
        while i < len(doc["parts"]):
            piece = json.dumps(doc["parts"][i], separators=(",", ":"))
            if used + len(piece) + 1 > budget:
                if out:
                    break
                pid = doc["parts"][i].get("id", i)
                return ToolOut(
                    f"Part {pid!r} is too large to show. Continue with get_spec start={i + 1}.",
                    "A part was too large to show",
                    ok=False,
                )
            out.append(piece)
            used += len(piece) + 1
            i += 1
        more = f',"next_start":{i}' if i < len(doc["parts"]) else ""
        text = f'{{"asset":{asset},"parts":[{",".join(out)}]{more}}}'
        return ToolOut(text, f"Read the spec ({len(out)} parts)")


# ------------------------------------------------------------------ build
class SetAssetArgs(AssetInfo):
    pass


class SetAsset:
    name, Args = "set_asset", SetAssetArgs
    description = (
        "Set the asset block: tag, type, name, frame note, plant-to-true-north, title block attributes."
    )

    def run(self, ctx, a):
        ctx.spec = ctx.spec.model_copy(update={"asset": AssetInfo.model_validate(a.model_dump())})
        ctx.save_working()
        return ToolOut("Asset block set.", "Set the asset details", phase="building")


class UpsertArgs(_A):
    parts: Annotated[list[dict], Field(min_length=1, max_length=200)]


def _issues_text(issues) -> str:
    return "\n".join(f"- {i.code} ({i.part_id}): {i.message}" for i in issues)


class UpsertParts:
    name, Args = "upsert_parts", UpsertArgs
    description = (
        "Add parts, or replace parts with the same id. Units mm and degrees; asset frame Y up, X plant "
        "north, Z plant east. The whole call is rejected if any part is invalid. Error codes: duplicate_id, "
        "host_missing, host_wrong_kind, host_self, reserved_id (part id 'world' is reserved), bad_geometry; "
        "warnings: overlap, assumed_high_confidence. elevation_mm is ABSOLUTE asset-frame height (Y), not "
        "relative to the host. Hosts are vertical: a mounted part ignores a host's own axis. A partial "
        "sweep_deg starts at bearing 0 and runs anticlockwise in bearing terms (toward -Z)."
    )

    def run(self, ctx, a):
        try:
            new = [Part.model_validate(p) for p in a.parts]
        except ValidationError as e:
            return ToolOut(
                f"Rejected, nothing changed:\n{_short(e)}",
                "Rejected invalid parts",
                ok=False,
                phase="building",
            )
        by_id = {p.id: p for p in ctx.spec.parts}
        for p in new:
            by_id[p.id] = p
        order = [p.id for p in ctx.spec.parts] + [
            p.id for p in new if p.id not in {q.id for q in ctx.spec.parts}
        ]
        candidate = ctx.spec.model_copy(update={"parts": [by_id[i] for i in order]})
        report = validate(candidate)
        if not report.ok:
            return ToolOut(
                "Rejected, nothing changed:\n" + _issues_text(report.errors),
                "Rejected invalid parts",
                ok=False,
                phase="building",
            )
        ctx.spec = candidate
        ctx.save_working()
        warn = ("\nWarnings:\n" + _issues_text(report.warnings)) if report.warnings else ""
        n = len(new)
        return ToolOut(
            f"Saved {n} part{'s' if n != 1 else ''}; the model has {len(candidate.parts)}.{warn}",
            f"Added or changed {n} part{'s' if n != 1 else ''}",
            phase="building",
        )


class RemoveArgs(_A):
    ids: Annotated[list[str], Field(min_length=1, max_length=200)]


class RemoveParts:
    name, Args = "remove_parts", RemoveArgs
    description = "Remove parts by id."

    def run(self, ctx, a):
        gone = set(a.ids)
        missing = sorted(gone - {p.id for p in ctx.spec.parts})
        candidate = ctx.spec.model_copy(update={"parts": [p for p in ctx.spec.parts if p.id not in gone]})
        report = validate(candidate)
        if not report.ok:
            return ToolOut(
                "Rejected, nothing changed (other parts depend on these):\n" + _issues_text(report.errors),
                "Rejected a removal",
                ok=False,
                phase="building",
            )
        ctx.spec = candidate
        ctx.save_working()
        note = f" Not found: {', '.join(missing)}." if missing else ""
        return ToolOut(
            f"The model has {len(candidate.parts)} parts.{note}",
            f"Removed {len(gone) - len(missing)} parts",
            phase="building",
        )


# ------------------------------------------------------------------ check
# One pattern for every form, not a Literal | str union: a union becomes an anyOf that Gemini struggles with.
ViewName = Annotated[str, Field(pattern=r"^(iso|front|side|top|section@\d{1,3}(\.\d+)?)$")]


class RenderArgs(_A):
    views: Annotated[list[ViewName], Field(min_length=1, max_length=4)]
    labels: bool = False
    highlight: list[str] = Field(default_factory=list)


class Render:
    name, Args = "render", RenderArgs
    description = (
        "Render the current model: iso, front (looking north), side (looking east), top (north up), "
        "or section@<bearing> (cut through the axis, looking along that bearing). Up to 4 views. "
        "The iso view looks along (1, -0.8, 1), from the south-west and above, so parts on the "
        "north/east side (e.g. a nozzle at bearing 90) are hidden behind the shell: "
        "use front/side/top/section@<bearing> to see them."
    )

    def run(self, ctx, a):
        if not ctx.spec.parts:
            return ToolOut("The model has no parts yet.", "Nothing to render", ok=False, phase="checking")
        meshes = build_meshes(ctx.spec)
        groups = {p.id: p.group for p in ctx.spec.parts}
        imgs, titles = [], []
        for v in a.views:
            try:
                view = (
                    View("section", bearing_deg=float(v.split("@")[1]))
                    if v.startswith("section@")
                    else View(v)
                )
                imgs.append(
                    render(
                        meshes,
                        view,
                        size=800 if len(a.views) > 1 else 1024,
                        labels=a.labels,
                        groups=groups,
                        highlight=set(a.highlight),
                    )
                )
            except ValueError:  # app-written text only: never the exception's own
                return ToolOut(
                    f"That view can't be rendered: {v}.",
                    "A view could not be rendered",
                    ok=False,
                    phase="checking",
                )
            titles.append(v)
        try:
            sheet = grid(imgs, titles) if len(imgs) > 1 else imgs[0]
        except ValueError:
            return ToolOut(
                "The views can't be combined into one image.",
                "Views could not be combined",
                ok=False,
                phase="checking",
            )
        sheet.thumbnail((MAX_RENDER_PX, MAX_RENDER_PX))  # the model never gets more than 1024 px a side
        buf = io.BytesIO()
        sheet.save(buf, "JPEG", quality=85)
        return _image(
            ctx, buf.getvalue(), f"Rendered {', '.join(titles)}.", f"Rendered {len(titles)} views", "checking"
        )


class CompareArgs(_A):
    cloud_id: str
    origin: Annotated[
        list[float], Field(min_length=3, max_length=3, description="asset origin in cloud coordinates")
    ]
    yaw_deg: float = Field(description="bearing of plant north, clockwise from the cloud's +Y")


class CompareToCloud:
    name, Args = "compare_to_cloud", CompareArgs
    description = (
        "Distance from cloud points to the model, per part (median and p95 in mm), after placing the cloud. "
        "Reports UNSIGNED distance to the nearest model surface, inner or outer wall: a shell oversized by "
        "about its wall thickness (an ID/OD swap) can read near 0 mm, so check diameters with cloud_fit too."
    )

    def run(self, ctx, a):
        if not ctx.spec.parts:
            return ToolOut("The model has no parts yet.", "Nothing to compare", ok=False, phase="checking")
        sample = _sample(ctx, a.cloud_id)
        t = CloudTransform(tuple(a.origin), a.yaw_deg)
        pts = cloud_to_asset(sample.points(), t)
        try:
            result = compare(build_meshes(ctx.spec), pts).as_dict()
        except ValueError:  # app-written text only: never the exception's own
            return ToolOut(
                "The cloud can't be compared: its points are not usable (not finite, or not N x 3).",
                "The comparison could not run",
                ok=False,
                phase="checking",
            )
        ctx.comparison = {
            "cloud_id": a.cloud_id,
            "transform": {"origin": list(a.origin), "yaw_deg": a.yaw_deg},
            **result,
        }
        rng = np.random.default_rng(5)
        keep = (
            pts
            if len(pts) <= OVERLAY_POINTS
            else pts[np.sort(rng.choice(len(pts), OVERLAY_POINTS, replace=False))]
        )
        ctx.run_dir.mkdir(parents=True, exist_ok=True)
        (ctx.run_dir / f"overlay_{a.cloud_id}.bin").write_bytes(keep.astype("<f4").tobytes())
        return ToolOut(
            json.dumps(result, separators=(",", ":")),
            f"Compared with a cloud: median {result['overall']['median_mm']} mm",
            phase="checking",
        )


class Validate:
    name, Args = "validate", NoArgs
    description = (
        "Check the working spec for errors and warnings. Codes: duplicate_id, host_missing, "
        "host_wrong_kind, host_self, reserved_id, bad_geometry; warnings overlap, assumed_high_confidence."
    )

    def run(self, ctx, a):
        r = validate(ctx.spec)
        text = ("Errors:\n" + _issues_text(r.errors) + "\n" if r.errors else "") + (
            "Warnings:\n" + _issues_text(r.warnings) if r.warnings else ""
        )
        return ToolOut(
            text or "No problems.",
            f"Validated: {len(r.errors)} errors, {len(r.warnings)} warnings",
            phase="checking",
        )


class FinishArgs(_A):
    summary: str = Field(max_length=4000)
    open_questions: Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=30)] = Field(
        default_factory=list
    )


class Finish:
    name, Args = "finish", FinishArgs
    description = "End the run: a short summary and honest open questions for the operator."

    def run(self, ctx, a):
        ctx.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Finished.", "Finished", phase="done")


TOOLS = {
    t.name: t
    for t in (
        ListSources(),
        DrawingView(),
        DrawingText(),
        CloudSlice(),
        CloudFit(),
        PhotoView(),
        GetSpec(),
        SetAsset(),
        UpsertParts(),
        RemoveParts(),
        Render(),
        CompareToCloud(),
        Validate(),
        Finish(),
    )
}


def tool_specs() -> list[ToolSpec]:
    return [ToolSpec(t.name, t.description, clean_schema(t.Args.model_json_schema())) for t in TOOLS.values()]


def _short(e: ValidationError) -> str:
    lines = []
    for err in e.errors()[:20]:
        got = (
            f" (got {str(err['input'])[:40]!r})"
            if err["type"] in ("literal_error", "enum") and "input" in err
            else ""
        )
        lines.append(f"- {'.'.join(map(str, err['loc']))}: {err['msg']}{got}")
    return "\n".join(lines)


def run_tool(ctx: RunContext, name: str, raw_args: dict) -> ToolOut:
    tool = TOOLS.get(name)
    if tool is None:
        return ToolOut(f"Unknown tool {name!r}.", "Called an unknown tool", ok=False)
    try:
        args = tool.Args.model_validate(raw_args)
    except ValidationError as e:
        return ToolOut(f"Bad arguments for {name}:\n{_short(e)}", f"Bad arguments for {name}", ok=False)
    try:
        out = tool.run(ctx, args)
    except LookError as e:
        return ToolOut(e.message, f"{name} could not run", ok=False)
    except Exception as e:  # noqa: BLE001 - a tool bug must not end the run; the type name only, never the text
        return ToolOut(
            f"{name} failed ({type(e).__name__}). Try different arguments.", f"{name} failed", ok=False
        )
    if len(out.text) > MAX_TEXT:
        out.text = out.text[:MAX_TEXT] + "\n(cut off)"
    return out
