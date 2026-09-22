"""The project agent's tools: what the model may do inside one project, and how.

Every tool reaches the app through its own HTTP routes (`dispatch.ApiCaller`), so validation,
background jobs and websocket events are exactly the UI's. A tool has a risk:

- `read` and `write` tools run as soon as the model calls them;
- `approval` tools only prepare a card (`Prepared`) and run after the user approves it;
- `label_images` is a write tool whose `prepare` returns a card for cloud labeling (it costs money).

Results are compact JSON for the model (at most 8,000 characters); `summary` is one line for the
UI. Nothing here reads, returns or logs a provider key, and no log line carries tool payloads.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Annotated, Any, ClassVar, Literal
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.project_agent.dispatch import ApiCaller, ApiCallError, ImageSelector, resolve_selection
from app.project_agent.history import ToolSpec

log = logging.getLogger(__name__)

MAX_RESULT_CHARS = 8000
FIND_ROWS = 50
MAX_BOXES_SHOWN = 100
VIEW_MAX_SIDE = 1024
WAIT_POLL_S = 2.0
LOG_TAIL = 40
LIST_ROWS = 50
RUNS_AND_JOBS_ROWS = 20
# New classes cycle through the app's standard class palette.
PALETTE = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"]
HOTKEYS = "123456789"
SCREENS = Literal[
    "home",
    "images",
    "label",
    "review",
    "datasets",
    "models",
    "train",
    "detect",
    "export",
    "settings",
    "editor",
]
JOB_STATES = Literal["queued", "running", "succeeded", "failed", "cancelled"]
JOB_TYPES = Literal["import", "dataset", "train", "infer", "export", "results_export"]


# --------------------------------------------------------------------- types


@dataclass
class ToolContext:
    api: ApiCaller
    project_id: str
    user_texts: list[str]


@dataclass
class ToolOutcome:
    result: str  # sent to the model; truncated to 8,000 chars by `run_tool`
    summary: str  # one line for the UI, e.g. "Started labeling 500 images"
    is_error: bool = False
    job_ids: list[str] = field(default_factory=list)
    image_id: str | None = None  # view_image: the runner renders it for the model
    navigate: dict | None = None  # {"screen": ..., "image_id": ...}


@dataclass
class Prepared:
    title: str
    detail: str
    estimated_cost: float | None
    args: dict  # normalised args to execute on approval (e.g. resolved image_ids)


class ToolError(Exception):
    """A tool refuses or cannot proceed; the message goes back to the model as an error result."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class Tool:
    name: ClassVar[str]
    description: ClassVar[str]
    Args: ClassVar[type[BaseModel]]
    risk: ClassVar[Literal["read", "write", "approval"]]
    label: ClassVar[str]  # human verb phrase, e.g. "Label images"

    async def prepare(self, ctx: ToolContext, args: BaseModel) -> Prepared | None:
        return None

    async def run(self, ctx: ToolContext, args: dict) -> ToolOutcome:
        raise NotImplementedError


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class NoArgs(_Args):
    pass


# ------------------------------------------------------------------- helpers


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _seg(value: str) -> str:
    """A path segment the model supplied, quoted so it cannot walk to another route."""
    return quote(value, safe="")


def _plural(n: int, word: str, plural: str | None = None) -> str:
    return f"{n:,} {word}" if n == 1 else f"{n:,} {plural or word + 's'}"


def _ok(value: Any, summary: str, **extra) -> ToolOutcome:
    return ToolOutcome(result=value if isinstance(value, str) else _json(value), summary=summary, **extra)


def _error(message: str) -> ToolOutcome:
    summary = message if len(message) <= 120 else message[:117] + "..."
    return ToolOutcome(result=message, summary=summary, is_error=True)


def _api_error_text(e: ApiCallError) -> str:
    text = f"The app refused the request ({e.status} {e.code}): {e.message}"
    errors = e.details.get("errors") if isinstance(e.details, dict) else None
    if isinstance(errors, list):
        parts = []
        for err in errors[:8]:
            if not isinstance(err, dict):
                continue
            loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path"))
            parts.append(f"{loc or 'request'}: {err.get('msg', '')}")
        if parts:
            text += " — " + "; ".join(parts)
    return text


def _validation_text(name: str, e: ValidationError) -> str:
    parts = []
    for err in e.errors()[:8]:
        loc = ".".join(str(p) for p in err["loc"]) or "arguments"
        parts.append(f"{loc}: {err['msg']}")
    return f"Invalid arguments for {name}: " + "; ".join(parts)


def _truncate(text: str) -> str:
    if len(text) <= MAX_RESULT_CHARS:
        return text
    marker = " …[truncated]"
    return text[: MAX_RESULT_CHARS - len(marker)] + marker


async def _select(ctx: ToolContext, selection: dict | ImageSelector | None) -> list[str]:
    sel = selection if isinstance(selection, ImageSelector) else ImageSelector(**(selection or {}))
    ids = await resolve_selection(ctx.api, sel)
    if not ids:
        raise ToolError("No images match this selection. Use find_images to check the filters.")
    return ids


async def _classes(ctx: ToolContext) -> list[dict]:
    return (await ctx.api.call("GET", ""))["classes"]


def _class_id(classes: list[dict], name: str) -> str:
    for c in classes:
        if c["name"] == name:
            return c["id"]
    for c in classes:
        if c["name"].lower() == name.strip().lower():
            return c["id"]
    names = ", ".join(c["name"] for c in classes) or "none"
    raise ToolError(f"There is no class named {name!r}. The project's classes are: {names}.")


def _box(b: dict, class_names: dict[str, str]) -> dict:
    out = {
        "id": b["id"],
        "class": class_names.get(b["class_id"], b["class_id"]),
        "x": round(b["x"], 1),
        "y": round(b["y"], 1),
        "w": round(b["w"], 1),
        "h": round(b["h"], 1),
        "review_state": b["review_state"],
        "source": b["provenance"]["kind"],
    }
    if b.get("angle"):
        out["angle"] = round(b["angle"], 1)
    if b.get("confidence") is not None:
        out["confidence"] = round(b["confidence"], 3)
    return out


def _job(j: dict) -> dict:
    return {
        "id": j["id"],
        "type": j["type"],
        "state": j["state"],
        "progress": round(j["progress"], 3),
        "message": j["message"],
        "error": j["error"],
        "created_at": j["created_at"],
        "finished_at": j["finished_at"],
    }


def _page(key: str, rows: list, next_cursor: str | None) -> dict:
    out: dict = {key: rows}
    if next_cursor:
        out["more"] = True
    return out


# ------------------------------------------------------------ shared args


class LocalLabeler(_Args):
    kind: Literal["local_model"]
    model_id: str = Field(description="A model id from list_models.")


class CloudLabeler(_Args):
    kind: Literal["cloud_provider"]
    provider: Literal["openai", "anthropic"]
    query: str = Field(
        min_length=1,
        max_length=2000,
        description="What to find, in plain words, e.g. 'every excavator and dump truck'.",
    )


Labeler = Annotated[LocalLabeler | CloudLabeler, Field(discriminator="kind")]

SELECTION_DOC = (
    "Which images: filters over the project (source_id, labeled, has_pending, search), sort, "
    "order, offset and limit (1-5000, default 100), or explicit image_ids (at most 200). "
    "'The first 500 images' is {sort: 'path', order: 'asc', offset: 0, limit: 500}."
)


def _selection_field(optional: bool = False, required: bool = False):
    """`required` for tools that change images: a missing selection must never mean "some images"."""
    if required:
        return Field(description=SELECTION_DOC + " Required: say exactly which images.")
    if optional:
        return Field(None, description=SELECTION_DOC + " Omit for the tool's default.")
    return Field(default_factory=ImageSelector, description=SELECTION_DOC)


# ---------------------------------------------------------------- read tools


class GetProject(Tool):
    name = "get_project"
    label = "Read the project"
    risk = "read"
    Args = NoArgs
    description = (
        "Get the project's name, its classes (id and name), the pre-annotation model and summary "
        "counts: images, labeled and unlabeled images, accepted boxes, unreviewed suggestions, "
        "boxes per class and images per source. Call this first to orient yourself."
    )

    async def run(self, ctx, args):
        project = await ctx.api.call("GET", "")
        stats = await ctx.api.call("GET", "/stats")
        body = {
            "id": project["id"],
            "name": project["name"],
            "classes": [{"id": c["id"], "name": c["name"]} for c in project["classes"]],
            "preannotation_model_id": project["preannotation_model_id"],
            "stats": {
                "image_count": stats["image_count"],
                "labeled_count": stats["labeled_count"],
                "unlabeled_count": stats["unlabeled_count"],
                "box_count": stats["box_count"],
                "pending_review_count": stats["pending_review_count"],
                "duplicate_count": stats["duplicate_count"],
                "boxes_per_class": [
                    {"class": b["class_name"], "count": b["count"]} for b in stats["boxes_per_class"]
                ],
                "sources": [
                    {"source_id": s["source_id"], "site": s["site"], "image_count": s["image_count"]}
                    for s in stats["sources"][:20]
                ],
            },
        }
        return _ok(body, f"Read project {project['name']}")


class ListSources(Tool):
    name = "list_sources"
    label = "List sources"
    risk = "read"
    Args = NoArgs
    description = (
        "List the folders imported into the project (at most 50): id, folder, site, image and "
        "duplicate counts, and when each was imported. Use a source id in an image selection."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call("GET", "/sources", params={"limit": LIST_ROWS})
        rows = [
            {
                "id": s["id"],
                "folder": s["folder"],
                "site": s["site"],
                "image_count": s["image_count"],
                "duplicate_count": s["duplicate_count"],
                "imported_at": s["imported_at"],
            }
            for s in page["items"]
        ]
        return _ok(_page("sources", rows, page["next_cursor"]), f"Listed {_plural(len(rows), 'source')}")


class FindImagesArgs(_Args):
    selection: ImageSelector = _selection_field()


class FindImages(Tool):
    name = "find_images"
    label = "Find images"
    risk = "read"
    Args = FindImagesArgs
    description = (
        "Resolve an image selection and return how many images it selects (`count`, at most "
        "5000) and the first 50 of them with file name, labeled, accepted box count, unreviewed "
        "suggestion count and marked_empty. Use it to check a selection before acting on it, "
        "or to find image ids."
    )

    async def run(self, ctx, args):
        ids = await resolve_selection(ctx.api, ImageSelector(**args["selection"]))
        rows: list[dict] = []
        shown = ids[:FIND_ROWS]
        if shown:
            page = await ctx.api.call("GET", "/images", params={"ids": ",".join(shown), "limit": len(shown)})
            by_id = {i["id"]: i for i in page["items"]}
            for image_id in shown:
                i = by_id.get(image_id)
                if i:
                    rows.append(
                        {
                            "id": i["id"],
                            "file_name": i["file_name"],
                            "labeled": i["labeled"],
                            "box_count": i["box_count"],
                            "pending_count": i["pending_count"],
                            "marked_empty": i["marked_empty"],
                        }
                    )
        return _ok({"count": len(ids), "images": rows}, f"Found {_plural(len(ids), 'image')}")


class ImageIdArgs(_Args):
    image_id: str = Field(description="An image id from find_images.")


class GetImage(Tool):
    name = "get_image"
    label = "Read an image"
    risk = "read"
    Args = ImageIdArgs
    description = (
        "Get one image's metadata (file name, size, source, group, capture time, labeled, "
        "marked_empty) and its boxes (at most 100) with class names, pixel coordinates (x, y "
        "top-left, w, h), review state (unreviewed = a suggestion), source and confidence."
    )

    async def run(self, ctx, args):
        image_id = _seg(args["image_id"])
        image = await ctx.api.call("GET", f"/images/{image_id}")
        boxes = (await ctx.api.call("GET", f"/images/{image_id}/boxes"))["items"]
        names = {c["id"]: c["name"] for c in await _classes(ctx)}
        body = {
            "image": {
                k: image[k]
                for k in (
                    "id",
                    "file_name",
                    "path",
                    "width",
                    "height",
                    "source_id",
                    "group_key",
                    "capture_time",
                    "labeled",
                    "marked_empty",
                    "box_count",
                    "pending_count",
                )
            },
            "boxes": [_box(b, names) for b in boxes[:MAX_BOXES_SHOWN]],
        }
        if len(boxes) > MAX_BOXES_SHOWN:
            body["boxes_not_shown"] = len(boxes) - MAX_BOXES_SHOWN
        return _ok(body, f"Read {image['file_name']}")


class ViewImage(Tool):
    name = "view_image"
    label = "Look at an image"
    risk = "read"
    Args = ImageIdArgs
    description = (
        "Look at one image yourself: it is attached to this tool result as a JPEG downscaled to "
        "at most 1024 px on the long side, so small or distant machines may be unreadable. Use "
        "it to check what is in a picture or to judge suggestions; it is sent to the provider."
    )

    async def run(self, ctx, args):
        image = await ctx.api.call("GET", f"/images/{_seg(args['image_id'])}")
        w, h = image["width"], image["height"]
        scale = min(1.0, VIEW_MAX_SIDE / max(w, h))
        shown = f"{round(w * scale)}x{round(h * scale)}"
        text = (
            f"Image {image['file_name']} ({w}x{h} px) is attached, shown at {shown}. "
            "Box coordinates from get_image are in full-size pixels."
        )
        return ToolOutcome(result=text, summary=f"Looked at {image['file_name']}", image_id=image["id"])


class ListModels(Tool):
    name = "list_models"
    label = "List models"
    risk = "read"
    Args = NoArgs
    description = (
        "List the project's registered detection models (at most 50): id, name, kind (imported "
        "or trained), base weights, dataset, mAP50 when trained, the classes the weights predict "
        "(first 20) and their aliases to project classes, and exports. A model id labels images "
        "locally for free (label_images with a local_model labeler) or is a base for training."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call("GET", "/models", params={"limit": LIST_ROWS})
        rows = []
        for m in page["items"]:
            rows.append(
                {
                    "id": m["id"],
                    "name": m["name"],
                    "kind": m["kind"],
                    "base_weights": m["base_weights"],
                    "dataset_id": m["dataset_id"],
                    "map50": round(m["metrics"]["map50"], 3) if m.get("metrics") else None,
                    "class_count": len(m["class_names"]),
                    "classes": m["class_names"][:20],
                    "class_aliases": m["class_aliases"],
                    "exports": sorted(m["exports"]),
                    "created_at": m["created_at"],
                }
            )
        return _ok(_page("models", rows, page["next_cursor"]), f"Listed {_plural(len(rows), 'model')}")


class ListStarterModels(Tool):
    name = "list_starter_models"
    label = "List starter models"
    risk = "read"
    Args = NoArgs
    description = (
        "List the supported COCO-pretrained YOLO starter weights: key, name, family and whether "
        "they are available offline. Register one with acquire_starter_model (a background job "
        "that may download it). Smaller keys (n, s) train and run fastest."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call("GET", "/api/v1/starter-models")
        rows = [
            {"key": s["key"], "name": s["name"], "family": s.get("family"), "available": s["available"]}
            for s in page["items"]
        ]
        return _ok({"starters": rows}, f"Listed {_plural(len(rows), 'starter model')}")


def _dataset(d: dict) -> dict:
    return {
        "id": d["id"],
        "name": d["name"],
        "image_count": d["image_count"],
        "train_count": d["train_count"],
        "val_count": d["val_count"],
        "split_method": d["split_method"],
        "classes": [c["name"] for c in d["classes"]],
        "job_id": d["job_id"],
        "created_at": d["created_at"],
    }


class ListDatasets(Tool):
    name = "list_datasets"
    label = "List datasets"
    risk = "read"
    Args = NoArgs
    description = (
        "List the project's frozen training datasets (at most 50): id, name, image, train and "
        "val counts, split method, classes and the job that materialised it."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call("GET", "/datasets", params={"limit": LIST_ROWS})
        rows = [_dataset(d) for d in page["items"]]
        return _ok(_page("datasets", rows, page["next_cursor"]), f"Listed {_plural(len(rows), 'dataset')}")


class DatasetIdArgs(_Args):
    dataset_id: str = Field(description="A dataset id from list_datasets.")


class GetDataset(Tool):
    name = "get_dataset"
    label = "Read a dataset"
    risk = "read"
    Args = DatasetIdArgs
    description = (
        "Get one dataset with its statistics: train/val boxes per class and how many groups "
        "went to each split. Use it before training to check the class balance."
    )

    async def run(self, ctx, args):
        dataset_id = _seg(args["dataset_id"])
        d = await ctx.api.call("GET", f"/datasets/{dataset_id}")
        stats = await ctx.api.call("GET", f"/datasets/{dataset_id}/stats")
        body = _dataset(d)
        body["boxes_per_class"] = [
            {"class": b["class_name"], "train": b["train"], "val": b["val"]} for b in stats["boxes_per_class"]
        ]
        body["groups"] = {
            "train": sum(1 for g in stats["groups"] if g["split"] == "train"),
            "val": sum(1 for g in stats["groups"] if g["split"] == "val"),
        }
        return _ok(body, f"Read dataset {d['name']}")


class ListQueryRuns(Tool):
    name = "list_query_runs"
    label = "List labeling runs"
    risk = "read"
    Args = NoArgs
    description = (
        "List the 20 newest labeling runs (query runs), newest first: id, local model or cloud "
        "provider, query, image count, suggestions written so far, confidence threshold, job id "
        "and whether the suggestions were accepted in bulk (promoted_at). A run id is what "
        "accept_suggestions and undo_accept_suggestions take."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call("GET", "/query-runs", params={"limit": RUNS_AND_JOBS_ROWS})
        rows = [
            {
                "id": r["id"],
                "kind": r["kind"],
                "provider": r["provider"],
                "model_id": r["model_id"],
                "model_name": r["model_name"],
                "query": r["query"],
                "image_count": len(r["image_ids"]),
                "box_count": r["box_count"],
                "conf": r["conf"],
                "job_id": r["job_id"],
                "promoted_at": r["promoted_at"],
                "created_at": r["created_at"],
            }
            for r in page["items"]
        ]
        return _ok(
            _page("query_runs", rows, page["next_cursor"]), f"Listed {_plural(len(rows), 'labeling run')}"
        )


class ListJobsArgs(_Args):
    state: JOB_STATES | None = Field(None, description="Only jobs in this state.")
    type: JOB_TYPES | None = Field(None, description="Only jobs of this type.")


class ListJobs(Tool):
    name = "list_jobs"
    label = "List jobs"
    risk = "read"
    Args = ListJobsArgs
    description = (
        "List the 20 newest background jobs (import, dataset, train, infer = labeling, export, "
        "results_export), optionally filtered by state or type: id, state, progress 0-1, "
        "message and error."
    )

    async def run(self, ctx, args):
        page = await ctx.api.call(
            "GET", "/jobs", params={"state": args["state"], "type": args["type"], "limit": RUNS_AND_JOBS_ROWS}
        )
        rows = [_job(j) for j in page["items"]]
        return _ok(_page("jobs", rows, page["next_cursor"]), f"Listed {_plural(len(rows), 'job')}")


class JobIdArgs(_Args):
    job_id: str = Field(description="A job id.")


class GetJob(Tool):
    name = "get_job"
    label = "Read a job"
    risk = "read"
    Args = JobIdArgs
    description = (
        "Get one background job: state, progress, message, parameters, result (for example the "
        "trained model_id or the export folder) or error, and the last 40 lines of its log."
    )

    async def run(self, ctx, args):
        job_id = _seg(args["job_id"])
        j = await ctx.api.call("GET", f"/jobs/{job_id}")
        lines = (await ctx.api.call("GET", f"/jobs/{job_id}/log", params={"tail": LOG_TAIL}))["lines"]
        body = {**_job(j), "params": j["params"], "result": j["result"], "log": [ln[:300] for ln in lines]}
        return _ok(body, f"Read {j['type']} job ({j['state']})")


LABELER_DOC = (
    "local_model with a model_id from list_models (free, runs on this PC), or "
    "cloud_provider with provider openai|anthropic and a plain-words query (costs money)."
)
CONF_DOC = "Minimum confidence for a suggestion (0-1)."


class EstimateArgs(_Args):
    selection: ImageSelector = _selection_field()
    labeler: Labeler = Field(description=LABELER_DOC)
    conf: float = Field(0.25, ge=0, le=1, description=CONF_DOC)


class LabelArgs(_Args):
    selection: ImageSelector = _selection_field(required=True)
    labeler: Labeler = Field(description=LABELER_DOC)
    conf: float = Field(0.25, ge=0, le=1, description=CONF_DOC)


def _query_body(labeler: dict, image_ids: list[str], conf: float) -> dict:
    body: dict = {"kind": labeler["kind"], "image_ids": image_ids, "conf": conf}
    if labeler["kind"] == "local_model":
        body["model_id"] = labeler["model_id"]
    else:
        body["provider"] = labeler["provider"]
        body["query"] = labeler["query"]
    return body


class EstimateLabeling(Tool):
    name = "estimate_labeling"
    label = "Estimate labeling cost"
    risk = "read"
    Args = EstimateArgs
    description = (
        "Estimate a labeling run before starting it: images, tiles (large images are cut into "
        "tiles), requests, cost per request and estimated USD cost (0 for a local model). "
        "Changes nothing."
    )

    async def run(self, ctx, args):
        ids = await _select(ctx, args["selection"])
        est = await ctx.api.call(
            "POST", "/query-runs/estimate", json=_query_body(args["labeler"], ids, args["conf"])
        )
        return _ok(est, f"Estimated {_plural(est['images'], 'image')}: about ${est['estimated_cost']:,.2f}")


# --------------------------------------------------------------- write tools


class RenameClass(_Args):
    from_: str = Field(alias="from", description="The current class name.")
    to: str = Field(min_length=1, max_length=64, description="The new class name.")


class UpdateClassesArgs(_Args):
    add: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(
        default_factory=list, max_length=32, description="New class names to append."
    )
    rename: list[RenameClass] = Field(default_factory=list, max_length=32, description="Classes to rename.")


class UpdateClasses(Tool):
    name = "update_classes"
    label = "Update classes"
    risk = "write"
    Args = UpdateClassesArgs
    description = (
        "Add classes to the project and/or rename existing ones. Renaming keeps the class id, so "
        "boxes keep their class. New classes get a colour and a free hotkey. Classes cannot be "
        "removed with this tool. Class names are what cloud labeling looks for, so use clear "
        "English names such as dump_truck."
    )

    async def run(self, ctx, args):
        if not args["add"] and not args["rename"]:
            raise ToolError("Nothing to change: give classes to add or to rename.")
        classes = await _classes(ctx)
        items = [
            {"id": c["id"], "name": c["name"], "colour": c["colour"], "hotkey": c["hotkey"]} for c in classes
        ]
        by_id = {i["id"]: i for i in items}
        for r in args["rename"]:
            by_id[_class_id(classes, r["from"])]["name"] = r["to"].strip()
        existing = {i["name"].lower() for i in items}
        used = {i["hotkey"] for i in items if i["hotkey"]}
        added = []
        for name in args["add"]:
            name = name.strip()
            if not name or name.lower() in existing:
                continue
            hotkey = next((k for k in HOTKEYS if k not in used), None)
            if hotkey:
                used.add(hotkey)
            items.append({"name": name, "colour": PALETTE[len(items) % len(PALETTE)], "hotkey": hotkey})
            existing.add(name.lower())
            added.append(name)
        project = await ctx.api.call("PUT", "/classes", json=items)
        parts = []
        if added:
            parts.append(f"added {', '.join(added)}")
        if args["rename"]:
            parts.append("renamed " + ", ".join(f"{r['from']} to {r['to']}" for r in args["rename"]))
        summary = ("; ".join(parts) or "no change").capitalize()
        return _ok({"classes": [c["name"] for c in project["classes"]]}, summary)


class LabelImages(Tool):
    name = "label_images"
    label = "Label images"
    risk = "write"
    Args = LabelArgs
    description = (
        "Start a background labeling run that writes suggestions (unreviewed boxes) onto the "
        "selected images. With a local_model labeler it starts at once and is free. With a "
        "cloud_provider labeler it costs money: the user sees the image count, requests and "
        "estimated USD cost and must approve first. Returns the query_run_id and job_id; use "
        "wait_for_job or get_job to follow it, then accept_suggestions or review_boxes."
    )

    async def prepare(self, ctx, args):
        labeler = args.labeler
        if not isinstance(labeler, CloudLabeler):
            return None
        providers = (await ctx.api.call("GET", "/api/v1/providers"))["items"]
        if not any(p["name"] == labeler.provider and p["has_key"] for p in providers):
            raise ToolError(
                f"No API key is stored for {labeler.provider}. Ask the user to add one under "
                "Settings > Providers (the agent cannot manage keys), or use a local model."
            )
        ids = await _select(ctx, args.selection)
        body = _query_body(labeler.model_dump(), ids, args.conf)
        est = await ctx.api.call("POST", "/query-runs/estimate", json=body)
        cost = float(est["estimated_cost"])
        return Prepared(
            title=f"Label {_plural(len(ids), 'image')} with {labeler.provider}",
            detail=(
                f"{_plural(len(ids), 'image')} · {_plural(est['requests'], 'request')} · about "
                f"${cost:,.2f}. Suggestions stay unreviewed until you accept them."
            ),
            estimated_cost=cost,
            args=body,
        )

    async def run(self, ctx, args):
        if "labeler" in args:  # local: not prepared, so resolve the selection now
            ids = await _select(ctx, args["selection"])
            body = _query_body(args["labeler"], ids, args["conf"])
        else:  # the approved cloud run, ids resolved at prepare time
            body = args
        created = await ctx.api.call("POST", "/query-runs", json=body)
        run, job = created["query_run"], created["job"]
        n = len(run["image_ids"])
        result = {"query_run_id": run["id"], "job_id": job["id"], "images": n, "kind": run["kind"]}
        return _ok(result, f"Started labeling {_plural(n, 'image')}", job_ids=[job["id"]])


class AcceptArgs(_Args):
    query_run_id: str = Field(description="A labeling run id from list_query_runs.")
    min_confidence: float = Field(
        0, ge=0, le=1, description="Accept only suggestions at or above this confidence."
    )


class AcceptSuggestions(Tool):
    name = "accept_suggestions"
    label = "Accept suggestions"
    risk = "write"
    Args = AcceptArgs
    description = (
        "Accept, in bulk, a labeling run's unreviewed suggestions at or above min_confidence; "
        "they become ground truth used for datasets. Suggestions a person reviewed are left "
        "alone. Reversible with undo_accept_suggestions."
    )

    async def run(self, ctx, args):
        res = await ctx.api.call(
            "POST",
            f"/query-runs/{_seg(args['query_run_id'])}/promote",
            json={"min_confidence": args["min_confidence"]},
        )
        return _ok(
            {"query_run_id": res["query_run"]["id"], "accepted": res["accepted"]},
            f"Accepted {_plural(res['accepted'], 'suggestion')}",
        )


class RunIdArgs(_Args):
    query_run_id: str = Field(description="A labeling run id from list_query_runs.")


class UndoAcceptSuggestions(Tool):
    name = "undo_accept_suggestions"
    label = "Undo accepted suggestions"
    risk = "write"
    Args = RunIdArgs
    description = (
        "Undo accept_suggestions for a labeling run: boxes the bulk accept accepted go back to "
        "unreviewed. Boxes a person accepted, edited or rejected are left alone."
    )

    async def run(self, ctx, args):
        res = await ctx.api.call("POST", f"/query-runs/{_seg(args['query_run_id'])}/unpromote")
        return _ok(
            {"query_run_id": res["query_run"]["id"], "reverted": res["reverted"]},
            f"Returned {_plural(res['reverted'], 'suggestion')} to unreviewed",
        )


class ReviewArgs(_Args):
    box_ids: list[str] = Field(
        min_length=1, max_length=500, description="Box ids from get_image (at most 500)."
    )
    action: Literal["accept", "reject", "unreview"]


class ReviewBoxes(Tool):
    name = "review_boxes"
    label = "Review suggestions"
    risk = "write"
    Args = ReviewArgs
    description = (
        "Accept or reject suggestions by box id (at most 500), or unreview them to undo a "
        "review. Person-drawn boxes are ignored. Returns how many boxes changed."
    )

    async def run(self, ctx, args):
        res = await ctx.api.call(
            "POST", "/boxes/review", json={"box_ids": args["box_ids"], "action": args["action"]}
        )
        verb = {"accept": "Accepted", "reject": "Rejected", "unreview": "Unreviewed"}[args["action"]]
        return _ok({"updated": res["updated"]}, f"{verb} {_plural(res['updated'], 'box', 'boxes')}")


class MarkEmptyArgs(_Args):
    selection: ImageSelector = _selection_field(required=True)
    empty: bool = Field(
        True, description="true marks the images as containing no machinery; false undoes it."
    )


class MarkImagesEmpty(Tool):
    name = "mark_images_empty"
    label = "Mark images empty"
    risk = "write"
    Args = MarkEmptyArgs
    description = (
        "Mark the selected images as containing no machinery (they count as labeled and train "
        "as negatives), or undo it with empty=false. Images with accepted or edited boxes are "
        "skipped. Marking rejects the images' unreviewed suggestions."
    )

    async def run(self, ctx, args):
        ids = await _select(ctx, args["selection"])
        res = await ctx.api.call(
            "POST", "/images/bulk-mark-empty", json={"image_ids": ids, "marked_empty": args["empty"]}
        )
        verb = "Marked" if args["empty"] else "Unmarked"
        return _ok(
            {"images": len(ids), "updated": res["updated"], "skipped": res["skipped"]},
            f"{verb} {_plural(res['updated'], 'image')} empty",
        )


class CreateBoxArgs(_Args):
    image_id: str
    class_name: str = Field(description="A project class name.")
    x: float = Field(description="Left edge in full-size image pixels.")
    y: float = Field(description="Top edge in full-size image pixels.")
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = Field(0, description="Rotation in degrees about the box centre, clockwise.")


class CreateBox(Tool):
    name = "create_box"
    label = "Draw a box"
    risk = "write"
    Args = CreateBoxArgs
    description = (
        "Draw one box (ground truth, accepted) on an image, in full-size pixel coordinates. The "
        "box must lie inside the image. Coordinates you estimate from view_image must be scaled "
        "back to the image's full size."
    )

    async def run(self, ctx, args):
        classes = await _classes(ctx)
        body = {k: args[k] for k in ("x", "y", "w", "h", "angle")}
        body["class_id"] = _class_id(classes, args["class_name"])
        box = await ctx.api.call("POST", f"/images/{_seg(args['image_id'])}/boxes", json=body)
        names = {c["id"]: c["name"] for c in classes}
        return _ok(_box(box, names), f"Drew a {names[box['class_id']]} box")


class UpdateBoxArgs(_Args):
    box_id: str
    class_name: str | None = Field(None, description="New class name.")
    x: float | None = None
    y: float | None = None
    w: float | None = Field(None, gt=0)
    h: float | None = Field(None, gt=0)
    angle: float | None = None


class UpdateBox(Tool):
    name = "update_box"
    label = "Edit a box"
    risk = "write"
    Args = UpdateBoxArgs
    description = (
        "Move, resize, rotate or reclassify one box; give only the fields to change. A "
        "suggestion edited this way becomes ground truth (edited)."
    )

    async def run(self, ctx, args):
        classes = await _classes(ctx)
        body = {k: args[k] for k in ("x", "y", "w", "h", "angle") if args[k] is not None}
        if args["class_name"] is not None:
            body["class_id"] = _class_id(classes, args["class_name"])
        if not body:
            raise ToolError("Nothing to change: give at least one field.")
        box = await ctx.api.call("PATCH", f"/boxes/{_seg(args['box_id'])}", json=body)
        names = {c["id"]: c["name"] for c in classes}
        return _ok(_box(box, names), "Edited a box")


class ImportFolderArgs(_Args):
    folder: str = Field(min_length=1, description="The absolute folder path exactly as the user typed it.")
    site: str | None = Field(None, description="Short site name; defaults to the folder name.")


def _norm_path(text: str) -> str:
    return text.replace("\\", "/").lower()


# A typed path ends at the end of the text, whitespace, a quote or closing punctuation, so a prefix
# of what the user typed (a parent folder, a drive) never counts as typed.
_PATH_END = re.compile(r"/?(?:$|[\s\"'`,;!?)\]>]|\.(?:$|\s))")
_PATH_START = re.compile(r"(?:^|[\s\"'`(\[<:=])$")
_ABSOLUTE = re.compile(r"^(?:[a-z]:/|//[^/])")


def _typed_by_user(folder: str, user_texts: list[str]) -> bool:
    """True when `folder` is absolute and appears as a whole path in one of the user's messages."""
    wanted = _norm_path(folder.strip())
    if wanted.endswith("/") and len(wanted) > 3:
        wanted = wanted.rstrip("/")
    if not _ABSOLUTE.match(wanted):
        return False
    for text in user_texts:
        norm = _norm_path(text)
        start = norm.find(wanted)
        while start != -1:
            end = start + len(wanted)
            if _PATH_START.search(norm[:start]) and _PATH_END.match(norm, end):
                return True
            start = norm.find(wanted, start + 1)
    return False


class ImportFolder(Tool):
    name = "import_folder"
    label = "Import a folder"
    risk = "write"
    Args = ImportFolderArgs
    description = (
        "Import the images of a folder on this PC into the project as a background job "
        "(convert, downscale, skip near-duplicates). Only folders the user typed in this "
        "conversation are allowed; never guess or invent a path. Re-importing a folder adds "
        "only new files. Originals are never modified."
    )

    async def run(self, ctx, args):
        if not _typed_by_user(args["folder"], ctx.user_texts):
            raise ToolError(
                "Refused: import_folder only imports a folder the user typed in this conversation. "
                "Ask the user for the exact folder path."
            )
        body = {"folder": args["folder"].strip()}
        if args["site"]:
            body["site"] = args["site"]
        res = await ctx.api.call("POST", "/sources", json=body)
        job_id = res["job"]["id"]
        return _ok(
            {"source_id": res["source"]["id"], "site": res["source"]["site"], "job_id": job_id},
            f"Started importing {res['source']['folder']}",
            job_ids=[job_id],
        )


class StarterArgs(_Args):
    key: str = Field(description="A starter key from list_starter_models, e.g. yolo11n.")
    name: str | None = Field(None, min_length=1, description="Registry name; defaults to <key>-coco.")


class AcquireStarterModel(Tool):
    name = "acquire_starter_model"
    label = "Get a starter model"
    risk = "write"
    Args = StarterArgs
    description = (
        "Register a COCO-pretrained YOLO starter model in the project through a background job "
        "(it may download the weights). The finished job's result.model_id is the new model; "
        "use it as a training base or, where its COCO classes fit, for local labeling."
    )

    async def run(self, ctx, args):
        body = {"key": args["key"]} | ({"name": args["name"]} if args["name"] else {})
        job = (await ctx.api.call("POST", "/models/acquire-starter", json=body))["job"]
        return _ok({"job_id": job["id"]}, f"Started getting {args['key']}", job_ids=[job["id"]])


class CreateDatasetArgs(_Args):
    name: str = Field(pattern=r"^[A-Za-z0-9._-]+$", description="Folder-safe name, e.g. v1.")
    split_method: Literal["by_group", "by_tile", "random"] | None = Field(
        None, description="by_group (default: whole flights go to one split), by_tile or random."
    )
    val_fraction: float | None = Field(None, ge=0.05, le=0.5, description="Validation share, default 0.2.")
    seed: int | None = None
    selection: ImageSelector | None = _selection_field(optional=True)


class CreateDataset(Tool):
    name = "create_dataset"
    label = "Create a dataset"
    risk = "write"
    Args = CreateDatasetArgs
    description = (
        "Freeze the accepted and edited boxes (and images marked empty) into an immutable "
        "training dataset, split into train/val, through a background job. By default every "
        "labeled image is included; a selection narrows it. Unreviewed suggestions are never "
        "included."
    )

    async def run(self, ctx, args):
        body: dict = {"name": args["name"]}
        for k in ("split_method", "val_fraction", "seed"):
            if args[k] is not None:
                body[k] = args[k]
        if args["selection"] is not None:
            body["image_ids"] = await _select(ctx, args["selection"])
        res = await ctx.api.call("POST", "/datasets", json=body)
        d, job = res["dataset"], res["job"]
        return _ok(
            {"dataset_id": d["id"], "name": d["name"], "job_id": job["id"]},
            f"Started dataset {d['name']}",
            job_ids=[job["id"]],
        )


class ExportResultsArgs(_Args):
    formats: list[Literal["csv", "yolo", "coco", "html"]] = Field(min_length=1, max_length=4)
    include_unreviewed: bool = Field(False, description="Also export suggestions nobody reviewed.")
    selection: ImageSelector | None = _selection_field(optional=True)


class ExportResults(Tool):
    name = "export_results"
    label = "Export results"
    risk = "write"
    Args = ExportResultsArgs
    description = (
        "Write the project's detections to exports/<timestamp>/ in the project folder (csv, "
        "yolo, coco, html) through a background job. Accepted and edited boxes only unless "
        "include_unreviewed; rejected boxes never. Defaults to every image."
    )

    async def run(self, ctx, args):
        body: dict = {
            "formats": list(dict.fromkeys(args["formats"])),
            "include_unreviewed": args["include_unreviewed"],
        }
        if args["selection"] is not None:
            body["image_ids"] = await _select(ctx, args["selection"])
        job = (await ctx.api.call("POST", "/exports", json=body))["job"]
        return _ok({"job_id": job["id"]}, "Started exporting results", job_ids=[job["id"]])


class ExportModelArgs(_Args):
    model_id: str
    format: Literal["onnx", "engine"] = Field(description="onnx, or engine for TensorRT on the GPU.")
    imgsz: int = Field(1280, ge=320, le=4096)
    half: bool = Field(False, description="FP16; only for engine.")


class ExportModel(Tool):
    name = "export_model"
    label = "Export a model"
    risk = "write"
    Args = ExportModelArgs
    description = (
        "Export a registered model to ONNX or TensorRT (engine) through a background job; the "
        "file path lands in the model's exports."
    )

    async def run(self, ctx, args):
        body = {"format": args["format"], "imgsz": args["imgsz"], "half": args["half"]}
        job = (await ctx.api.call("POST", f"/models/{_seg(args['model_id'])}/export", json=body))["job"]
        return _ok({"job_id": job["id"]}, f"Started {args['format']} export", job_ids=[job["id"]])


class UpdateProjectArgs(_Args):
    name: str | None = Field(None, min_length=1, description="New project name.")
    preannotation_model_id: str | None = Field(
        None, description="Model used for one-image pre-annotation in the editor."
    )
    clear_preannotation_model: bool = Field(False, description="true removes the pre-annotation model.")


class UpdateProject(Tool):
    name = "update_project"
    label = "Update project settings"
    risk = "write"
    Args = UpdateProjectArgs
    description = "Rename the project, or set or clear its pre-annotation model."

    async def run(self, ctx, args):
        body: dict = {}
        if args["name"]:
            body["name"] = args["name"]
        if args["clear_preannotation_model"]:
            body["preannotation_model_id"] = None
        elif args["preannotation_model_id"]:
            body["preannotation_model_id"] = args["preannotation_model_id"]
        if not body:
            raise ToolError("Nothing to change: give a name or a pre-annotation model.")
        p = await ctx.api.call("PATCH", "", json=body)
        return _ok(
            {"name": p["name"], "preannotation_model_id": p["preannotation_model_id"]},
            "Updated project settings",
        )


class CancelJob(Tool):
    name = "cancel_job"
    label = "Cancel a job"
    risk = "write"
    Args = JobIdArgs
    description = (
        "Ask a queued or running background job to stop. Finished work (imported images, "
        "finished tiles) is kept; a finished job is returned unchanged."
    )

    async def run(self, ctx, args):
        j = await ctx.api.call("POST", f"/jobs/{_seg(args['job_id'])}/cancel")
        return _ok(_job(j), f"Asked the {j['type']} job to stop")


class WaitArgs(_Args):
    job_id: str
    seconds: int = Field(30, ge=1, le=60, description="Wait at most this long (1-60 s).")


class WaitForJob(Tool):
    name = "wait_for_job"
    label = "Wait for a job"
    risk = "write"
    Args = WaitArgs
    description = (
        "Wait up to `seconds` (at most 60) for a background job to finish and return its state, "
        "progress, message and result or error. Long jobs (training, big labeling runs) take "
        "far longer: call again, or tell the user it is still running and stop."
    )

    async def run(self, ctx, args):
        path = f"/jobs/{_seg(args['job_id'])}"
        deadline = time.monotonic() + args["seconds"]
        while True:
            j = await ctx.api.call("GET", path)
            finished = j["state"] not in ("queued", "running")
            left = deadline - time.monotonic()
            if finished or left <= 0:
                break
            await asyncio.sleep(min(WAIT_POLL_S, left))
        body = {**_job(j), "result": j["result"], "finished": finished}
        summary = f"{j['type'].capitalize()} job {j['state']}" + (
            "" if finished else f" ({j['progress']:.0%})"
        )
        return _ok(body, summary)


class OpenScreenArgs(_Args):
    screen: SCREENS
    image_id: str | None = Field(None, description="Required for the editor screen.")


class OpenScreen(Tool):
    name = "open_screen"
    label = "Open a screen"
    risk = "write"
    Args = OpenScreenArgs
    description = (
        "Show the user a screen of the app: home, images, label, review, datasets, models, "
        "train, detect, export, settings, or editor (with an image_id) to open one image."
    )

    async def run(self, ctx, args):
        if args["screen"] == "editor" and not args["image_id"]:
            raise ToolError("The editor screen needs an image_id.")
        image_id = args["image_id"] if args["screen"] == "editor" else None
        nav = {"screen": args["screen"], "image_id": image_id}
        return ToolOutcome(
            result=f"Opened the {args['screen']} screen.", summary=f"Opened {args['screen']}", navigate=nav
        )


# ------------------------------------------------------------ approval tools


class TrainArgs(_Args):
    name: str = Field(min_length=1, description="Name for the new model, e.g. site-v2.")
    dataset_id: str = Field(description="A dataset id from list_datasets.")
    base_model_id: str = Field(description="A model id from list_models to start from.")
    epochs: int = Field(50, ge=1, le=1000)
    imgsz: int = Field(1280, ge=320, le=4096)
    batch: int | None = Field(None, ge=1, description="Omit for automatic.")
    patience: int = Field(50, ge=0)
    augmentation: Literal["default", "aerial"] = "default"
    device: str = Field("0", description='"0" for the first GPU, "cpu" otherwise.')


class TrainModel(Tool):
    name = "train_model"
    label = "Train a model"
    risk = "approval"
    Args = TrainArgs
    description = (
        "Train a new detection model on a dataset, starting from a registered model, through a "
        "background job (can take hours and occupies the GPU). Needs the user's approval. The "
        "finished job's result.model_id is the new model."
    )

    async def prepare(self, ctx, args):
        d = await ctx.api.call("GET", f"/datasets/{_seg(args.dataset_id)}")
        m = await ctx.api.call("GET", f"/models/{_seg(args.base_model_id)}")
        return Prepared(
            title=f"Train {args.name} for {_plural(args.epochs, 'epoch')}",
            detail=f"Dataset {d['name']} · base {m['name']} · imgsz {args.imgsz}",
            estimated_cost=None,
            args=args.model_dump(mode="json"),
        )

    async def run(self, ctx, args):
        job = (await ctx.api.call("POST", "/models/train", json=args))["job"]
        return _ok({"job_id": job["id"]}, f"Started training {args['name']}", job_ids=[job["id"]])


class DeleteImagesArgs(_Args):
    selection: ImageSelector = _selection_field(required=True)


class DeleteImages(Tool):
    name = "delete_images"
    label = "Delete images"
    risk = "approval"
    Args = DeleteImagesArgs
    description = (
        "Delete the selected images and all their boxes from the project. Needs the user's "
        "approval; cannot be undone. Original files in the imported folders are not touched."
    )

    async def prepare(self, ctx, args):
        ids = await _select(ctx, args.selection)
        return Prepared(
            title=f"Delete {_plural(len(ids), 'image')}",
            detail="Removes the images and their boxes from the project; originals on disk are not touched.",
            estimated_cost=None,
            args={"image_ids": ids},
        )

    async def run(self, ctx, args):
        res = await ctx.api.call("POST", "/images/bulk-delete", json={"image_ids": args["image_ids"]})
        return _ok({"deleted": res["deleted"]}, f"Deleted {_plural(res['deleted'], 'image')}")


class DeleteBoxesArgs(_Args):
    box_ids: list[str] = Field(min_length=1, max_length=500, description="Box ids (at most 500).")


class DeleteBoxes(Tool):
    name = "delete_boxes"
    label = "Delete boxes"
    risk = "approval"
    Args = DeleteBoxesArgs
    description = (
        "Delete boxes by id (at most 500), ground truth or suggestions. Needs the user's "
        "approval; cannot be undone. To dismiss suggestions prefer review_boxes with reject."
    )

    async def prepare(self, ctx, args):
        ids = list(dict.fromkeys(args.box_ids))
        return Prepared(
            title=f"Delete {_plural(len(ids), 'box', 'boxes')}",
            detail="Removes the boxes from their images; this cannot be undone.",
            estimated_cost=None,
            args={"box_ids": ids},
        )

    async def run(self, ctx, args):
        deleted = missing = 0
        for box_id in args["box_ids"]:
            try:
                await ctx.api.call("DELETE", f"/boxes/{_seg(box_id)}")
                deleted += 1
            except ApiCallError as e:
                if e.status != 404:
                    raise
                missing += 1
        return _ok({"deleted": deleted, "not_found": missing}, f"Deleted {_plural(deleted, 'box', 'boxes')}")


class DeleteDataset(Tool):
    name = "delete_dataset"
    label = "Delete a dataset"
    risk = "approval"
    Args = DatasetIdArgs
    description = (
        "Delete a dataset and its frozen copy. Images, labels and models trained on it are "
        "kept. Needs the user's approval. Fails while a job that uses it is running."
    )

    async def prepare(self, ctx, args):
        d = await ctx.api.call("GET", f"/datasets/{_seg(args.dataset_id)}")
        return Prepared(
            title=f"Delete dataset {d['name']}",
            detail=(
                f"Removes {d['path']} ({_plural(d['image_count'], 'image')}); "
                "images, labels and models are kept."
            ),
            estimated_cost=None,
            args={"dataset_id": d["id"], "name": d["name"]},
        )

    async def run(self, ctx, args):
        await ctx.api.call("DELETE", f"/datasets/{_seg(args['dataset_id'])}")
        return _ok({"deleted": args["dataset_id"]}, f"Deleted dataset {args.get('name', '')}".strip())


class ModelIdArgs(_Args):
    model_id: str = Field(description="A model id from list_models.")


class DeleteModel(Tool):
    name = "delete_model"
    label = "Delete a model"
    risk = "approval"
    Args = ModelIdArgs
    description = (
        "Delete a registered model and its weights file. Boxes it produced keep their "
        "provenance. Needs the user's approval; cannot be undone."
    )

    async def prepare(self, ctx, args):
        m = await ctx.api.call("GET", f"/models/{_seg(args.model_id)}")
        return Prepared(
            title=f"Delete model {m['name']}",
            detail="Removes the registry entry and its weights; boxes it produced keep their provenance.",
            estimated_cost=None,
            args={"model_id": m["id"], "name": m["name"]},
        )

    async def run(self, ctx, args):
        await ctx.api.call("DELETE", f"/models/{_seg(args['model_id'])}")
        return _ok({"deleted": args["model_id"]}, f"Deleted model {args.get('name', '')}".strip())


# ------------------------------------------------------------------ registry

REGISTRY: dict[str, Tool] = {
    t.name: t
    for t in (
        GetProject(),
        ListSources(),
        FindImages(),
        GetImage(),
        ViewImage(),
        ListModels(),
        ListStarterModels(),
        ListDatasets(),
        GetDataset(),
        ListQueryRuns(),
        ListJobs(),
        GetJob(),
        EstimateLabeling(),
        UpdateClasses(),
        LabelImages(),
        AcceptSuggestions(),
        UndoAcceptSuggestions(),
        ReviewBoxes(),
        MarkImagesEmpty(),
        CreateBox(),
        UpdateBox(),
        ImportFolder(),
        AcquireStarterModel(),
        CreateDataset(),
        ExportResults(),
        ExportModel(),
        UpdateProject(),
        CancelJob(),
        WaitForJob(),
        OpenScreen(),
        TrainModel(),
        DeleteImages(),
        DeleteBoxes(),
        DeleteDataset(),
        DeleteModel(),
    )
}


def _clean_schema(schema: dict) -> dict:
    """A self-contained JSON schema: `$defs` refs inlined, titles and discriminator hints dropped."""
    defs = schema.get("$defs", {})

    def walk(node: Any, properties: bool = False) -> Any:
        if isinstance(node, list):
            return [walk(v) for v in node]
        if not isinstance(node, dict):
            return node
        if properties:  # keys are property names, never schema keywords
            return {k: walk(v) for k, v in node.items()}
        if "$ref" in node:
            target = walk(defs[node["$ref"].rsplit("/", 1)[-1]])
            rest = {k: walk(v) for k, v in node.items() if k not in ("$ref", "title")}
            return {**target, **rest}
        all_of = node.get("allOf")
        if isinstance(all_of, list) and len(all_of) == 1:
            rest = {k: v for k, v in node.items() if k != "allOf"}
            return walk({**all_of[0], **rest})
        return {
            k: walk(v, properties=(k == "properties"))
            for k, v in node.items()
            if k not in ("title", "$defs", "discriminator")
        }

    return walk(schema)


def tool_specs() -> list[ToolSpec]:
    return [
        ToolSpec(t.name, t.description, _clean_schema(t.Args.model_json_schema())) for t in REGISTRY.values()
    ]


# ------------------------------------------------------------------- running


async def _guard(name: str, step) -> ToolOutcome | Prepared:
    try:
        return await step()
    except ToolError as e:
        return _error(e.message)
    except ApiCallError as e:
        return _error(_api_error_text(e))
    except ValidationError as e:
        return _error(_validation_text(name, e))
    except Exception as e:  # a tool bug must not end the turn; log the type only, never the payload
        log.error("agent tool %s failed: %s", name, type(e).__name__)
        return _error(f"The tool {name} failed unexpectedly ({type(e).__name__}).")


def _finish(outcome: ToolOutcome | Prepared) -> ToolOutcome | Prepared:
    if isinstance(outcome, ToolOutcome):
        outcome.result = _truncate(outcome.result)
    return outcome


async def run_tool(ctx: ToolContext, name: str, raw_args: dict) -> ToolOutcome | Prepared:
    """Validate and run a tool call; approval-bound calls return their `Prepared` card instead."""
    tool = REGISTRY.get(name)
    if tool is None:
        return _error(f"There is no tool named {name!r}. Use one of the tools you were given.")
    try:
        args = tool.Args.model_validate(raw_args if isinstance(raw_args, dict) else {})
    except ValidationError as e:
        return _error(_validation_text(name, e))

    async def step():
        prepared = await tool.prepare(ctx, args)
        if prepared is not None:
            return prepared
        if tool.risk == "approval":
            raise ToolError(f"The tool {name} could not prepare its approval.")
        return await tool.run(ctx, args.model_dump(mode="json", by_alias=True))

    return _finish(await _guard(name, step))


async def execute_approved(ctx: ToolContext, name: str, prepared_args: dict) -> ToolOutcome:
    """Run an approved call with the args its `Prepared` card carried."""
    tool = REGISTRY.get(name)
    if tool is None:
        return _error(f"There is no tool named {name!r}.")
    outcome = _finish(await _guard(name, lambda: tool.run(ctx, prepared_args)))
    assert isinstance(outcome, ToolOutcome)
    return outcome


async def render_image_b64(api: ApiCaller, image_id: str) -> str | None:
    """The image as a base64 JPEG at most 1024 px on the long side, or None when it is gone."""
    try:
        data = await api.fetch_bytes(f"/images/{_seg(image_id)}/file", params={"max_side": VIEW_MAX_SIDE})
    except ApiCallError:
        return None
    return base64.b64encode(data).decode("ascii")
