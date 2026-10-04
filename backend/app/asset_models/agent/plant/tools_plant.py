# backend/app/asset_models/agent/plant/tools_plant.py
"""The plant run's tools (spec §8.3), in M1's ToolOut style. They are app code only, their reads are
bounded, and they never raise to the caller. Tools act on a Scope:
- in a package, on its own item buffer;
- in the orchestrator, on the merged store (`rc.store`)."""

from __future__ import annotations

import base64
import json
import logging
import math
import time
from typing import Annotated, Literal

from pydantic import Field, ValidationError
from pyproj import CRS
from pyproj.exceptions import CRSError
from shapely.geometry import LineString, Polygon

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant import sitefit, views
from app.asset_models.agent.plant.merge import with_flag
from app.asset_models.agent.plant.state import env_of
from app.asset_models.agent.tools import _A, FinishArgs, Region, ToolOut, _short
from app.asset_models.agent.tools import TOOLS as M1_TOOLS
from app.asset_models.agent.tools import run_tool as run_m1_tool
from app.asset_models.builders.base import PLANNED_TYPES, REGISTRY, catalogue, load_all
from app.asset_models.look import LookError
from app.asset_models.siteframe import GridError, fit_plant_grid, footprint_ref
from app.asset_models.spec import Datum, EnvFeature, Item, ItemFlag, SiteCrs, SiteFrame, Source
from app.db.models import Drawing
from app.errors import AppError
from app.project_agent.history import ToolResult, ToolSpec
from app.project_agent.tools import clean_schema

log = logging.getLogger(__name__)
MAX_TEXT = 8000
MAX_ITEMS = 20_000
QUERY_ROWS = 300
ROW_BUDGET = 7000  # characters of rows per items_query answer, under MAX_TEXT
MAX_FIX_ROUNDS = 2
LOOK = ("list_sources", "drawing_view", "drawing_text", "cloud_slice", "cloud_fit", "photo_view")
ENV_STAGES = ("review", "environment", "build")
NO_IMAGE = "\n(The image budget is used up, so no image was attached.)"
RESERVED_ID = "world"
RESERVED = "'world' is reserved; pick another id"


# ------------------------------------------------------------------ item checks
def check_item(raw) -> tuple[Item | None, list[str]]:
    """One item, or the reasons it can't be saved (schema, reserved id, registry type, its params,
    footprint, heights). A planned type without a builder yet is accepted (it builds as `other`)."""
    try:
        item = Item.model_validate(raw)
    except ValidationError as e:
        return None, [_short(e).replace("\n", "; ")]
    errors = []
    if item.id == RESERVED_ID:
        errors.append(RESERVED)
    load_all()
    d = REGISTRY.get(item.type)
    if d is None:
        if item.type not in PLANNED_TYPES:
            errors.append(f"unknown type {item.type[:40]!r} (call catalogue for the types)")
    else:
        try:
            d.params.model_validate(item.params)
        except ValidationError as e:
            errors.append("params: " + _short(e).replace("\n", "; "))
    if item.base_el is not None and item.top_el is not None and item.top_el < item.base_el:
        errors.append("top_el is below base_el")
    fp = item.footprint
    if fp.kind == "polygon" and not Polygon([tuple(p) for p in fp.pts]).is_valid:
        errors.append("the footprint polygon crosses itself")
    if fp.kind == "line" and LineString([tuple(p) for p in fp.pts]).length <= 0:
        errors.append("the footprint line has no length")
    return (None, errors) if errors else (item, [])


def _num(v) -> str:
    return "?" if v is None else f"{v:g}"


def _row(i: Item) -> str:
    e, n = footprint_ref(i.footprint)
    flags = ",".join(f.code for f in i.flags) or "-"
    return (
        f"{i.id} | {i.tag or '-'} | {i.type} | {i.area or '-'} | {e:.1f},{n:.1f} | "
        f"{_num(i.base_el)}-{_num(i.top_el)} {i.height_source} | {flags}"
    )


def _begin_write(rc, scope, what: str) -> str | None:
    """A refusal text, or None. In the build stage a write after a render needs a fix round left."""
    if scope.package is not None:
        return None
    if scope.stage == "survey":
        return f"{what} are written once tracing has run: plan_packages, then next_stage."
    if scope.stage == "build" and scope.rendered and rc.state.fix_rounds >= MAX_FIX_ROUNDS:
        return "Both fix rounds are used: call finish."
    return None


def _wrote(rc, scope, changed: bool) -> None:
    """Ruling R15: the first write after a render that changed something opens a fix round; a write
    that saved or removed nothing does not use one."""
    if changed and scope.package is None and scope.stage == "build" and scope.rendered:
        rc.state.fix_rounds += 1
        scope.rendered = False


# ------------------------------------------------------------------ register tools
class UpsertItemsArgs(_A):
    items: Annotated[list[dict], Field(min_length=1, max_length=150)]


class UpsertItems:
    name, Args = "upsert_items", UpsertItemsArgs
    description = (
        "Add items to the register, or replace items with the same id. Up to 150 per call. Plant metres "
        "[E, N] on the drawing's grid, elevations plant EL in metres. Each item is checked on its own: "
        "valid ones are saved, invalid ones are listed with the reason. Fields: id (slug), tag (only "
        "if legible; else null), name, type (see catalogue), area, footprint {kind: rect, center, size: "
        "[along, across], rot_deg} | {kind: circle, center, d} | {kind: polygon, pts} | {kind: line, "
        "pts, width}, base_el, top_el, levels, params (per type), height_source drawing|cloud|indicative, "
        "source {kind, id, page, region}, confidence, notes, parts (M1 parts, item-local mm)."
    )

    def run(self, rc, scope, a):
        refusal = _begin_write(rc, scope, "Items")
        if refusal:
            return ToolOut(refusal, "Items not saved", ok=False, phase="building")
        saved, rejected = [], []
        with rc.lock:
            for k, raw in enumerate(a.items):
                label = raw.get("id") if isinstance(raw.get("id"), str) else f"#{k + 1}"
                item, errors = check_item(raw)
                if errors:
                    rejected.append(f"- {label[:64]}: {'; '.join(errors)}")
                    continue
                if item.id not in scope.items and len(scope.items) >= MAX_ITEMS:
                    rejected.append(f"- {item.id}: the model already holds {MAX_ITEMS} items")
                    continue
                new_from_cloud = (
                    scope.package is None
                    and scope.stage == "review"
                    and item.id not in scope.items
                    and item.source.kind == "cloud"
                )
                if new_from_cloud:
                    item = with_flag(
                        item,
                        ItemFlag(code="unregistered", note="Found in the point cloud, not on the drawings."),
                    )
                scope.items[item.id] = item
                saved.append(item.id)
            total = len(scope.items)
            _wrote(rc, scope, bool(saved))
        if scope.package is None:
            rc.save_store()
            rc.save()
        where = "this package" if scope.package is not None else "the model"
        text = f"Saved {len(saved)} item(s); {where} has {total}."
        if rejected:
            text += f"\nRejected {len(rejected)} (fix them and send again):\n" + "\n".join(rejected[:60])
        return ToolOut(
            text,
            f"Saved {len(saved)} items, rejected {len(rejected)}",
            ok=bool(saved) or not rejected,
            phase="building",
        )


class RemoveItemsArgs(_A):
    ids: Annotated[list[Annotated[str, Field(max_length=64)]], Field(min_length=1, max_length=500)]


class RemoveItems:
    name, Args = "remove_items", RemoveItemsArgs
    description = "Remove items from the register by id."

    def run(self, rc, scope, a):
        refusal = _begin_write(rc, scope, "Items")
        if refusal:
            return ToolOut(refusal, "Items not removed", ok=False, phase="building")
        with rc.lock:
            missing = [i for i in a.ids if i not in scope.items]
            for i in a.ids:
                scope.items.pop(i, None)
            total = len(scope.items)
            _wrote(rc, scope, len(missing) < len(a.ids))
        if scope.package is None:
            rc.save_store()
            rc.save()
        removed = len(a.ids) - len(missing)
        note = f" Not found: {', '.join(missing[:30])}." if missing else ""
        return ToolOut(
            f"Removed {removed}; {total} left.{note}", f"Removed {removed} items", phase="building"
        )


class ItemsQueryArgs(_A):
    area: str | None = Field(None, max_length=60)
    type: str | None = Field(None, max_length=60)
    tag: str | None = Field(None, max_length=64, description="case-insensitive part of the tag")
    flag: str | None = Field(None, max_length=40)
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)] | None = Field(
        None, description="[E0, N0, E1, N1] plant metres; matches by footprint reference point"
    )
    start: int = Field(0, ge=0)


class ItemsQuery:
    name, Args = "items_query", ItemsQueryArgs
    description = (
        "List register items as compact rows (id | tag | type | area | E,N | base-top height_source | "
        "flags), filtered by area, type, tag, flag or bbox. At most 300 rows per call; page with start."
    )

    def run(self, rc, scope, a):
        with rc.lock:
            items = list(scope.items.values())
        out = []
        for i in items:
            if a.area and i.area != a.area:
                continue
            if a.type and i.type != a.type:
                continue
            if a.tag and a.tag.lower() not in (i.tag or "").lower():
                continue
            if a.flag and a.flag not in {f.code for f in i.flags}:
                continue
            if a.bbox:
                e, n = footprint_ref(i.footprint)
                if not (a.bbox[0] <= e <= a.bbox[2] and a.bbox[1] <= n <= a.bbox[3]):
                    continue
            out.append(i)
        page, used = [], 0
        for i in out[a.start : a.start + QUERY_ROWS]:  # <= 300 rows and <= ROW_BUDGET characters
            line = _row(i)
            if used + len(line) + 1 > ROW_BUDGET:
                break
            page.append(line)
            used += len(line) + 1
        nxt = a.start + len(page)
        lines = [f"{len(out)} items match; rows {a.start}..{nxt}.", *page]
        if nxt < len(out):
            lines.append(f"(more: call again with start={nxt})")
        if scope.package is not None and scope.package.expected_tags:
            have = {(i.tag or "").upper() for i in items}
            missing = [t for t in scope.package.expected_tags if t.upper() not in have]
            if missing:
                lines.append("Expected but not traced yet: " + ", ".join(missing[:100]))
        return ToolOut("\n".join(lines), f"Queried items: {len(out)} match")


class CatalogueArgs(_A):
    type: str | None = Field(None, max_length=60)


def catalogue_text() -> str:
    """The full catalogue, for the sub-run system prompt (a cached prefix, so no reply cap)."""
    load_all()
    return "\n".join(
        f"{x['type']} ({x['family']}, default height {x['default_height_m']:g} m): {x['doc']}"
        for x in catalogue()
    )


SHORT_DOC = 110


def _first_sentence(doc: str) -> str:
    head = doc.split(". ", 1)[0].strip().rstrip(".")
    return head if len(head) <= SHORT_DOC else head[: SHORT_DOC - 1].rstrip() + "…"


def catalogue_listing() -> str:
    """One short line per type, so every registered type fits in a tool reply (MAX_TEXT)."""
    load_all()
    lines = [
        f"{x['type']} ({x['family']}, {x['default_height_m']:g} m): {_first_sentence(x['doc'])}"
        for x in catalogue()
    ]
    lines.append("Call catalogue with a type for its parameter schema and defaults.")
    return "\n".join(lines)


class Catalogue:
    name, Args = "catalogue", CatalogueArgs
    description = (
        "The builder types: without type, one line each; with type, its parameter schema and defaults."
    )

    def run(self, rc, scope, a):
        if not a.type:
            return ToolOut(catalogue_listing(), "Read the catalogue")
        load_all()
        entry = next((x for x in catalogue() if x["type"] == a.type), None)
        if entry is None:
            return ToolOut(
                f"There is no type {a.type!r}. Call catalogue without a type for the list.",
                "Unknown type",
                ok=False,
            )
        return ToolOut(json.dumps(entry, separators=(",", ":")), f"Read the {a.type} schema")


class EnvArgs(_A):
    features: Annotated[list[dict], Field(min_length=1, max_length=50)]


class UpsertEnvironment:
    name, Args = "upsert_environment", EnvArgs
    description = (
        "Add or replace environment polygons (land, sea, road, paved, laydown, slope, revetment): "
        "{id, kind, pts: [[E, N], ...] (>= 3, plant m), el (plant EL m), source, confidence}. "
        "Up to 50 per call."
    )

    def run(self, rc, scope, a):
        if scope.package is not None or scope.stage not in ENV_STAGES:
            return ToolOut(
                "The environment is traced in the environment stage.",
                "Environment not saved",
                ok=False,
                phase="building",
            )
        refusal = _begin_write(rc, scope, "Environment features")
        if refusal:
            return ToolOut(refusal, "Environment not saved", ok=False, phase="building")
        saved, rejected = [], []
        with rc.lock:
            by_id = {f["id"]: f for f in rc.state.environment}
            for k, raw in enumerate(a.features):
                label = raw.get("id") if isinstance(raw.get("id"), str) else f"#{k + 1}"
                try:
                    feat = EnvFeature.model_validate(raw)
                except ValidationError as e:
                    rejected.append(f"- {label[:64]}: {_short(e).replace(chr(10), '; ')}")
                    continue
                if feat.id == RESERVED_ID:
                    rejected.append(f"- {feat.id}: {RESERVED}")
                    continue
                if len(feat.pts) < 3 or not Polygon([tuple(p) for p in feat.pts]).is_valid:
                    rejected.append(f"- {feat.id}: the polygon needs 3+ points and must not cross itself")
                    continue
                by_id[feat.id] = feat.model_dump(mode="json")
                saved.append(feat.id)
            rc.state.environment = list(by_id.values())
            _wrote(rc, scope, bool(saved))
        rc.save()
        text = f"Saved {len(saved)} feature(s); the environment has {len(rc.state.environment)}."
        if rejected:
            text += f"\nRejected {len(rejected)}:\n" + "\n".join(rejected)
        return ToolOut(
            text, f"Saved {len(saved)} environment features", ok=bool(saved) or not rejected, phase="building"
        )


# ------------------------------------------------------------------ stage tools
class PackageSpec(_A):
    label: str = Field(min_length=1, max_length=80)
    drawing_id: str
    region: Region | None = Field(None, description="[x0, y0, x1, y1] page fractions; null = the whole page")
    area: str | None = Field(None, max_length=60)
    brief: str = Field("", max_length=2000)
    expected_tags: Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=300)] = Field(
        default_factory=list
    )


class PlanArgs(_A):
    packages: Annotated[list[PackageSpec], Field(min_length=1, max_length=64)]


class PlanPackages:
    name, Args = "plan_packages", PlanArgs
    description = (
        "Split the tracing into packages (survey stage only; calling again replaces the packages not yet "
        "started). Each package: one region of one drawing page, an area label, a brief (what is there, the "
        "scale) and the tags expected from the equipment list. Size each for one sub-run: about 20-60 items."
    )

    def run(self, rc, scope, a):
        if scope.package is not None or scope.stage != "survey":
            return ToolOut("Packages are planned during the survey.", "Packages not planned", ok=False)
        bad = sorted({p.drawing_id for p in a.packages if p.drawing_id not in rc.drawing_ids()})
        if bad:
            return ToolOut(
                f"These are not one of this run's drawings: {', '.join(bad)}.",
                "Packages not planned",
                ok=False,
            )
        for p in a.packages:
            if p.region and (p.region[2] <= p.region[0] or p.region[3] <= p.region[1]):
                return ToolOut(
                    f"Package {p.label!r}: region needs x1 > x0 and y1 > y0.",
                    "Packages not planned",
                    ok=False,
                )
        with rc.lock, rc.handle.session() as s:
            rows = pk.replace_queued(s, rc.run_id, [p.model_dump() for p in a.packages])
            live = {r.id for r in pk.rows(s, rc.run_id)}
            meta = {k: v for k, v in rc.state.packages_meta.items() if k in live}
            for row, p in zip(rows, a.packages, strict=True):
                meta[row.id] = {"brief": p.brief, "expected_tags": list(p.expected_tags)}
            listing = [f"P{r.n} {r.label} (drawing {r.drawing_id}, area {r.area or '-'})" for r in rows]
            rc.state.packages_meta = meta
        rc.save()
        return ToolOut(
            f"Planned {len(rows)} packages:\n"
            + "\n".join(listing)
            + "\nCall next_stage when the survey is done.",
            f"Planned {len(rows)} packages",
        )


class NextStageArgs(_A):
    summary: str = Field(max_length=2000)


class NextStage:
    name, Args = "next_stage", NextStageArgs
    description = "Close the current stage with a short summary; the app starts the next one."

    def run(self, rc, scope, a):
        if scope.stage == "build":
            return ToolOut("This is the last stage: call finish.", "Stage not closed", ok=False)
        if scope.stage == "survey":
            with rc.handle.session() as s:
                if not pk.rows(s, rc.run_id):
                    return ToolOut(
                        "Plan at least one package with plan_packages first.", "Stage not closed", ok=False
                    )
        scope.next_stage = a.summary
        return ToolOut("Stage closed.", f"Closed the {scope.stage} stage")


class PlantFinish:
    name, Args = "finish", FinishArgs
    description = "End the run after the build stage's self-check: a short summary and honest open questions."

    def run(self, rc, scope, a):
        if scope.stage != "build":
            return ToolOut(
                "finish ends the run in the build stage; use next_stage to move on.", "Not finished", ok=False
            )
        rc.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Finished.", "Finished", phase="done")


class FinishPackageArgs(_A):
    summary: str = Field(max_length=2000)
    open_questions: Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=10)] = Field(
        default_factory=list
    )


class FinishPackage:
    name, Args = "finish_package", FinishPackageArgs
    description = "End this package: what was traced, and what could not be read."

    def run(self, rc, scope, a):
        scope.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Package finished.", "Finished the package", phase="done")


class ZoomArgs(_A):
    drawing_id: str
    region: Region = Field(description="[x0, y0, x1, y1] page fractions, (0,0) top-left")
    dpi: int = Field(300, ge=36, le=1200, description="source resolution; at most 600 dpi is rendered")
    grid: bool = Field(
        True,
        description="page-fraction ticks, and plant E/N grid lines once the frame is known",
    )


class DrawingZoom:
    name, Args = "drawing_zoom", ZoomArgs
    description = (
        "Zoom into a region of a drawing page at a chosen resolution (up to 600 dpi; the image is at "
        "most 1 600 px, and a region too large for the dpi is rendered at the largest dpi that fits, "
        "with a note). Use it to read small tags, leaders and grid labels on scanned plot plans. The "
        "image carries page-fraction ticks on its top and left edges (use them for set_site grid "
        "points) and plant E/N grid lines once the frame is known."
    )

    def run(self, rc, scope, a):
        if a.drawing_id not in rc.drawing_ids():
            raise LookError("That drawing is not one of this run's sources.")
        mapper = _page_to_plant(rc, a.drawing_id) if a.grid else None
        z = views.drawing_zoom(rc.handle, a.drawing_id, a.region, a.dpi, grid=a.grid, page_to_plant=mapper)
        at = f" at {z.dpi} dpi" if z.dpi else ""
        grid = f" Plant grid lines every {z.grid_step_m:g} m." if z.grid_step_m else ""
        text = f"Drawing zoom {z.width}x{z.height}{at}.{grid} {z.note}".strip()
        return ToolOut(text, f"Zoomed into a drawing{at}", image=z.jpeg, phase="reading")


def _page_to_plant(rc, drawing_id):
    return sitefit.page_to_plant_fn(rc, drawing_id)


NEED_FRAME = (
    "The site frame can't be fixed yet. Give either at least two grid points on a page that is already "
    "placed on the map, or origin_crs and plant_north_deg read off a drawing (a coordinate note or the "
    "key plan) with the epsg of their coordinate system. Pages without a georeference are placed from "
    "their grid points once the frame is known."
)
Frac = Annotated[float, Field(ge=0, le=1)]


class GridPoint(_A):
    drawing_id: str
    page_xy: Annotated[list[Frac], Field(min_length=2, max_length=2)] = Field(
        description="[x, y] page fractions of the grid intersection, (0,0) top-left (read the zoom's ticks)"
    )
    plant_E: float
    plant_N: float


class SetSiteArgs(_A):
    epsg: int | None = Field(None, ge=1024, le=999_999)
    origin_crs: Annotated[list[float], Field(min_length=2, max_length=2)] | None = Field(
        None, description="plant (E 0, N 0) in the site CRS, metres"
    )
    plant_north_deg: float | None = Field(
        None, ge=-360, le=360, description="plant north, clockwise from grid north"
    )
    datum_label: str = Field("EL", min_length=1, max_length=20)
    datum_el_m: float = Field(0.0, ge=-1000, le=10_000, description="plant EL at the model's base level")
    grid_points: Annotated[list[GridPoint], Field(max_length=12)] = Field(default_factory=list)
    source_drawing_id: str | None = None
    note: str | None = Field(None, max_length=300)


def _site_crs(handle, epsg):
    from app.workspace.service import get_frame

    if epsg is not None:
        try:
            return CRS.from_epsg(epsg).to_wkt(), SiteCrs(epsg=epsg)
        except CRSError:
            raise LookError(f"EPSG:{epsg} is not a coordinate system this app knows.") from None
    ws = get_frame(handle)
    if ws.kind == "local":
        return None, SiteCrs()
    return ws.crs_wkt, SiteCrs(epsg=ws.epsg) if ws.epsg else SiteCrs(wkt=ws.crs_wkt)


class SetSite:
    name, Args = "set_site", SetSiteArgs
    description = (
        "Fix the site frame: where plant (E 0, N 0) sits in the site CRS, plant north's angle clockwise "
        "from grid north, and the vertical datum. Either give grid_points (grid intersections read off "
        "pages: page_xy fractions + the plant E/N labels; >= 2 on a page already placed on the map, "
        "spread wide) or origin_crs + plant_north_deg (+ epsg) read off a drawing. Unplaced pages with 2+ "
        "grid points are then placed on the map from the grid."
    )

    def run(self, rc, scope, a):
        ids = rc.drawing_ids()
        for did in {gp.drawing_id for gp in a.grid_points} | (
            {a.source_drawing_id} if a.source_drawing_id else set()
        ):
            if did not in ids:
                raise LookError("That drawing is not one of this run's sources.")
        site_wkt, crs = _site_crs(rc.handle, a.epsg)
        rows = {did: sitefit.drawing_row(rc.handle, did) for did in {gp.drawing_id for gp in a.grid_points}}
        pairs, placed_from = [], None
        for gp in a.grid_points:
            row = rows.get(gp.drawing_id)
            xy = (
                sitefit.page_to_site(row, gp.page_xy[0], gp.page_xy[1], site_wkt) if row is not None else None
            )
            if xy is not None:
                pairs.append(((gp.plant_E, gp.plant_N), (float(xy[0]), float(xy[1]))))
                placed_from = placed_from or gp.drawing_id
        lines, rms, mismatch = [], None, None
        stated = a.origin_crs is not None and a.plant_north_deg is not None
        if len(pairs) >= 2 and not stated:
            try:
                origin, theta, rms = fit_plant_grid(pairs)
            except GridError as e:
                raise LookError(str(e)) from None
            source = Source(kind="drawing", id=placed_from, note=a.note)
        elif stated:
            # A frame the drawing states (a coordinate note) is authoritative: a grid fit goes through
            # the page's map placement, which the operator may have made only roughly (Al-Zour: 26 m).
            if len(pairs) >= 2:
                try:
                    f_origin, f_theta, rms = fit_plant_grid(pairs)
                except GridError:
                    f_origin = None
                if f_origin is not None:
                    d = math.dist(f_origin, a.origin_crs)
                    dt = abs(f_theta - a.plant_north_deg)
                    lines.append(
                        f"The grid fit through the placed page differs from the stated frame by {d:.2f} m "
                        f"and {dt:.4f} deg; the stated frame is used."
                    )
                    if d > 1.0 or dt > 0.01:
                        mismatch = (
                            f"The frame the drawing states differs from a grid fit through the page's map "
                            f"placement by {d:.1f} m and {dt:.3f} deg; the stated frame is used. Check the "
                            "page's placement on the map."
                        )
            origin, theta = (a.origin_crs[0], a.origin_crs[1]), a.plant_north_deg
            source = (
                Source(kind="drawing", id=a.source_drawing_id, note=a.note)
                if a.source_drawing_id
                else Source(kind="assumed", note=a.note or "Frame given without a drawing reference.")
            )
        else:
            return ToolOut(NEED_FRAME, "Site frame not set", ok=False)
        frame = SiteFrame(
            crs=crs,
            origin_crs=(float(origin[0]), float(origin[1])),
            plant_north_deg=float(theta),
            datum=Datum(label=a.datum_label, el_m=a.datum_el_m),
            source=source,
        )
        with rc.lock:
            rc.state.site = frame.model_dump(mode="json")
            # a new frame replaces the old one: its fit question goes, and comes back only if this
            # fit's residual is over 1 m too
            stale = ("plant grid fit", "frame the drawing states")
            rc.state.questions = [x for x in rc.state.questions if not any(k in x for k in stale)]
            if mismatch:
                rc.state.questions.append(mismatch)
            if rms is not None and rms > 1.0:
                q = (
                    f"The plant grid fit has a residual of {rms:.2f} m over {len(pairs)} grid points: "
                    "check the grid points read off the drawings."
                )
                rc.state.questions.append(q)
                lines.append("The residual is over 1 m: check the grid points (an open question was added).")
        rc.save()
        for did, row in rows.items():
            gps = [gp for gp in a.grid_points if gp.drawing_id == did]
            if row is not None and row.georef is None and len(gps) >= 2:
                lines.append(sitefit.georef_from_grid(rc, row, gps))
        crs_label = (
            f"EPSG:{crs.epsg}" if crs.epsg else ("the map's CRS" if crs.wkt else "local metres (no CRS)")
        )
        text = (
            f"Site frame set: plant (0, 0) at ({frame.origin_crs[0]:.3f}, {frame.origin_crs[1]:.3f}) in "
            f"{crs_label}; plant north {frame.plant_north_deg:.4f} deg clockwise from grid north; datum "
            f"{a.datum_label} = {a.datum_el_m:g} m."
        )
        if rms is not None:
            text += f" Grid fit residual {rms:.2f} m over {len(pairs)} points."
        return ToolOut("\n".join([text, *lines]), "Set the site frame")


class OrthoArgs(_A):
    bbox: Annotated[list[float], Field(min_length=4, max_length=4)] = Field(
        description="[E0, N0, E1, N1] plant metres"
    )
    map_id: str | None = None
    items: bool = Field(True, description="draw the register's footprints on top")


class OrthoView:
    name, Args = "ortho_view", OrthoArgs
    description = (
        "The project's ortho photo over a plant-metre box (at most 5 000 m across), plant north up, "
        "<= 1 600 px, with the register's footprints drawn on top. Use it to check positions and to "
        "trace the environment."
    )

    def run(self, rc, scope, a):
        e0, n0, e1, n1 = a.bbox
        if not (e1 > e0 and n1 > n0) or max(e1 - e0, n1 - n0) > 5000:
            return ToolOut(
                "bbox must be [E0, N0, E1, N1] with E1 > E0, N1 > N0 and at most 5 000 m across.",
                "Bad box",
                ok=False,
            )
        if rc.site() is None:
            return ToolOut(
                "Set the site frame first (set_site): the ortho is placed through it.",
                "No site frame",
                ok=False,
            )
        map_id = a.map_id or views.pick_map(rc.handle)
        if map_id is None:
            return ToolOut("This project has no ortho map.", "No ortho", ok=False)
        cv = views.canvas_for(a.bbox)
        try:
            bg = views.background(rc, cv, "map", map_id)
        except AppError as e:
            return ToolOut(f"The ortho can't be read: {e.message}", "Ortho unreadable", ok=False)
        if bg is None:
            return ToolOut(
                "The ortho does not cover that box, or the map has no coordinate system.",
                "Ortho does not cover the box",
                ok=False,
            )
        with rc.lock:
            items = list(scope.items.values()) if a.items else []
        img = views.plan_image(rc, items, [], a.bbox, bg=bg)
        text = (
            f"Ortho {img.width}x{img.height}, plant north up, {cv.res:.2f} m per pixel, "
            f"E {e0:g}..{e1:g}, N {n0:g}..{n1:g}."
        )
        return ToolOut(text, "Looked at the ortho", image=views.jpeg(img), phase="checking")


SiteView = Annotated[str, Field(pattern=r"^(plan|iso|area:[A-Za-z0-9_.\- ]{1,40})$")]


class RenderSiteArgs(_A):
    views: Annotated[list[SiteView], Field(min_length=1, max_length=4)]
    overlay: Literal["ortho", "drawing", "none"] = "ortho"
    drawing_id: str | None = None
    highlight: Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=50)] = Field(
        default_factory=list
    )


def _overlay(rc, a, notes: list[str]):
    if a.overlay == "none":
        return None
    if rc.site() is None:
        notes.append("No overlay: the site frame is not set.")
        return None
    if a.overlay == "ortho":
        mid = views.pick_map(rc.handle)
        if mid is None:
            notes.append("No ortho in this project.")
            return None
        return "map", mid
    did = a.drawing_id
    if did is None:
        with rc.handle.session() as s:
            did = next(
                (
                    x["id"]
                    for x in rc.sources
                    if x["type"] == "drawing" and getattr(s.get(Drawing, x["id"]), "georef", None)
                ),
                None,
            )
    if did is None or did not in rc.drawing_ids():
        notes.append("No placed drawing to overlay.")
        return None
    return "drawing_raster", did


class RenderSite:
    name, Args = "render_site", RenderSiteArgs
    description = (
        "Render the model for a self-check: 'plan' (the whole site, plant north up, footprints over the "
        "ortho or a placed drawing, flagged items red), 'area:<label>' (one area), 'iso' (the built 3D "
        "model from the south-west). Up to 4 views, <= 1 600 px."
    )

    def run(self, rc, scope, a):
        with rc.lock:
            items = list(scope.items.values())
        env = env_of(rc.state)
        if not items and not env:
            return ToolOut("Nothing to render yet.", "Nothing to render", ok=False, phase="checking")
        notes: list[str] = []
        layer = _overlay(rc, a, notes)
        imgs, titles = [], []
        for v in a.views:
            if v == "iso":
                img, note = views.iso_image(rc, items)
                if note:
                    notes.append(note)
            else:
                sel = items if v == "plan" else [i for i in items if i.area == v[5:]]
                if not sel:
                    areas = sorted({i.area for i in items if i.area})
                    return ToolOut(
                        f"No items in area {v[5:]!r}. Areas: {', '.join(areas[:40]) or 'none'}.",
                        "Unknown area",
                        ok=False,
                        phase="checking",
                    )
                shown_env = env if v == "plan" else []
                bbox = views.bbox_of(sel, shown_env)
                cv = views.canvas_for(bbox)
                bg = None
                if layer is not None:
                    try:
                        bg = views.background(rc, cv, *layer)
                    except AppError as e:
                        notes.append(f"Overlay not drawn: {e.message}")
                img = views.plan_image(rc, sel, shown_env, bbox, bg=bg, highlight=frozenset(a.highlight))
            imgs.append(img)
            titles.append(v)
        out = views.sheet(imgs, titles)
        if scope.package is None:
            scope.rendered = True
        text = f"Rendered {', '.join(titles)}." + ("" if not notes else " " + " ".join(notes))
        return ToolOut(text, f"Rendered {len(titles)} site views", image=views.jpeg(out), phase="checking")


# ------------------------------------------------------------------ registry and dispatch
class CloudCheckArgs(_A):
    item_ids: (
        Annotated[list[Annotated[str, Field(max_length=64)]], Field(min_length=1, max_length=300)] | None
    ) = None


class CloudCheck:
    name, Args = "cloud_check", CloudCheckArgs
    description = (
        "Re-run the cloud check after edits and report chosen items (or all): per item, ground and top EL "
        "from the cloud, scan coverage, the plan offset, and flags; plus the unregistered candidates. "
        "Positions never move; heights fill in only where the height is indicative or from the cloud."
    )

    def run(self, rc, scope, a):
        from app.asset_models import cloudcheck as cc
        from app.asset_models.agent.plant.cloud import check_all

        if rc.cloud is None:
            return ToolOut(
                "No cloud check ran in this run. " + " ".join(rc.state.notes),
                "No cloud check",
                ok=False,
                phase="checking",
            )
        wanted = set(a.item_ids) if a.item_ids else None
        if wanted is not None and not wanted & set(rc.store):
            return ToolOut(
                "None of those items are in the register.", "Nothing to check", ok=False, phase="checking"
            )
        result = check_all(rc, cc, rc.cloud, rc.grid())  # every item: a subset turns the rest into candidates
        shown = result
        if wanted is not None:  # only the digest is filtered (C1 hand-off 3)
            shown = cc.CheckResult(
                result.datum,
                {k: v for k, v in result.items.items() if k in wanted},
                result.candidates,
                result.note,
            )
        digest = cc.summarise(shown, limit=QUERY_ROWS)
        head = f"Checked {len(result.items)} items. {rc.state.check_summary}"
        return ToolOut(
            head + "\n" + json.dumps(digest, separators=(",", ":")),
            f"Checked {len(result.items)} items against the cloud",
            phase="checking",
        )


_TOOLS = [
    UpsertItems(),
    RemoveItems(),
    ItemsQuery(),
    Catalogue(),
    UpsertEnvironment(),
    PlanPackages(),
    NextStage(),
    PlantFinish(),
    FinishPackage(),
    DrawingZoom(),
    SetSite(),
    OrthoView(),
    RenderSite(),
    CloudCheck(),
]
PLANT_TOOLS = {t.name: t for t in _TOOLS}
ORCH_NAMES = (
    "list_sources",
    "drawing_view",
    "drawing_text",
    "drawing_zoom",
    "set_site",
    "catalogue",
    "plan_packages",
    "items_query",
    "upsert_items",
    "remove_items",
    "upsert_environment",
    "ortho_view",
    "render_site",
    "cloud_check",
    "next_stage",
    "finish",
)
SUB_NAMES = (
    *LOOK,
    "drawing_zoom",
    "ortho_view",
    "catalogue",
    "items_query",
    "upsert_items",
    "remove_items",
    "finish_package",
)


def _names(scope) -> tuple[str, ...]:
    return ORCH_NAMES if scope.package is None else SUB_NAMES


def specs_for(role: str) -> list[ToolSpec]:
    names = ORCH_NAMES if role == "orchestrator" else SUB_NAMES
    out = []
    for n in names:
        t = PLANT_TOOLS.get(n) or M1_TOOLS[n]
        out.append(ToolSpec(t.name, t.description, clean_schema(t.Args.model_json_schema())))
    return out


def run_plant_tool(rc, scope, name: str, raw) -> ToolOut:
    if name not in _names(scope):
        return ToolOut(f"Unknown tool {name!r}.", "Called an unknown tool", ok=False)
    if name in LOOK:
        rc.m1.images_sent = 0  # image budgets are the plant run's (admit_image), not M1's 40
        return run_m1_tool(rc.m1, name, raw if isinstance(raw, dict) else {})
    tool = PLANT_TOOLS[name]
    try:
        args = tool.Args.model_validate(raw if isinstance(raw, dict) else {})
    except ValidationError as e:
        return ToolOut(f"Bad arguments for {name}:\n{_short(e)}", f"Bad arguments for {name}", ok=False)
    try:
        out = tool.run(rc, scope, args)
    except LookError as e:
        return ToolOut(e.message, f"{name} could not run", ok=False)
    except Exception as e:  # noqa: BLE001 - a tool bug must not end the run; the type name only
        return ToolOut(
            f"{name} failed ({type(e).__name__}). Try different arguments.", f"{name} failed", ok=False
        )
    if len(out.text) > MAX_TEXT:
        out.text = out.text[:MAX_TEXT] + "\n(cut off)"
    return out


def admit_image(rc, scope, out: ToolOut) -> None:
    """Keep the image only while the package's and the run's image budgets allow it."""
    if not out.image:
        return
    over_package = scope.package is not None and scope.images >= rc.limits.sub_images
    if over_package or not rc.budget.charge_image(scope.stage):
        out.image = None
        out.text += NO_IMAGE
        return
    scope.images += 1


def execute(rc, scope, call) -> ToolResult:
    """Run one tool call: dispatch, image budget, a log line (names and timings only), a step."""
    t0 = time.monotonic()
    tool_name = call.name if call.name in _names(scope) else "unknown"  # never log model output verbatim
    out = run_plant_tool(rc, scope, call.name, call.input)
    admit_image(rc, scope, out)
    log.info("plant tool %s %s ok=%s %.2fs", scope.name, tool_name, out.ok, time.monotonic() - t0)
    rc.recorder.step(scope.name, tool_name, out)
    return ToolResult(
        call.id,
        call.name,
        out.text,
        is_error=not out.ok,
        image_jpeg_b64=base64.b64encode(out.image).decode() if out.image else None,
    )
