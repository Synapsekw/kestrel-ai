# backend/app/asset_models/agent/plant/tools_plant.py
"""The plant run's tools (spec §8.3), in M1's ToolOut style. They are app code only, their reads are
bounded, and they never raise to the caller. Tools act on a Scope:
- in a package, on its own item buffer;
- in the orchestrator, on the merged store (`rc.store`)."""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Annotated

from pydantic import Field, ValidationError
from shapely.geometry import LineString, Polygon

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.merge import with_flag
from app.asset_models.agent.tools import _A, FinishArgs, Region, ToolOut, _short
from app.asset_models.agent.tools import TOOLS as M1_TOOLS
from app.asset_models.agent.tools import run_tool as run_m1_tool
from app.asset_models.builders.base import PLANNED_TYPES, REGISTRY, catalogue, load_all
from app.asset_models.look import LookError
from app.asset_models.siteframe import footprint_ref
from app.asset_models.spec import EnvFeature, Item, ItemFlag
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
    """A refusal text, or None. In the build stage the first write after a render opens a fix round."""
    if scope.package is not None:
        return None
    if scope.stage == "survey":
        return f"{what} are written once tracing has run: plan_packages, then next_stage."
    if scope.stage == "build" and scope.rendered:
        if rc.state.fix_rounds >= MAX_FIX_ROUNDS:
            return "Both fix rounds are used: call finish."
        rc.state.fix_rounds += 1
        scope.rendered = False
    return None


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
    load_all()
    return "\n".join(
        f"{x['type']} ({x['family']}, default height {x['default_height_m']:g} m): {x['doc']}"
        for x in catalogue()
    )


class Catalogue:
    name, Args = "catalogue", CatalogueArgs
    description = (
        "The builder types: without type, one line each; with type, its parameter schema and defaults."
    )

    def run(self, rc, scope, a):
        if not a.type:
            return ToolOut(catalogue_text(), "Read the catalogue")
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


# ------------------------------------------------------------------ registry and dispatch
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
]
PLANT_TOOLS = {t.name: t for t in _TOOLS}
ORCH_NAMES = (
    "list_sources",
    "drawing_view",
    "drawing_text",
    "catalogue",
    "plan_packages",
    "items_query",
    "upsert_items",
    "remove_items",
    "upsert_environment",
    "next_stage",
    "finish",
)
SUB_NAMES = (*LOOK, "catalogue", "items_query", "upsert_items", "remove_items", "finish_package")


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
