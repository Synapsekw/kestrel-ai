"""YOLO label lines for detect, obb and segment, and which images a task can express
(image spec 2026-09-26 §11.1, I-D10). Pure: no session, no file.

Used by F's library dataset build and export (`app.library.datasets`) and by the project results
export (`app.exports.yolo_out`). `detect_boxes` and `label_text` are today's
`datasets.materialise.detect_boxes` / `_label_text`, moved here verbatim.

A label is a frozen dataset label: `{type_id, shape?, x, y, w, h, angle?, points?}` in stored-image
px. Polygons keep `x, y, w, h` as their envelope with `angle = 0` (spec §8.1); `points` is one ring,
no closing vertex. A label without `shape` was frozen before shapes existed (R-BT2).
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from types import SimpleNamespace
from typing import Any, Literal

import shapely
from shapely.geometry import Polygon

from app.geometry import aabb_of, corners_of
from app.imagery.shapes import outline

LabelTask = Literal["detect", "obb", "segment"]
TASKS: tuple[LabelTask, ...] = ("detect", "obb", "segment")


def shape_of(label: Mapping[str, Any]) -> str:
    """The label's shape; a pre-shape label is `rbox` when rotated, else `box` (R-BT2)."""
    shape = label.get("shape")
    if shape:
        return str(shape)
    return "rbox" if label.get("angle") else "box"


def unexpressible_shapes(task: str, *, boxes_as_polygons: bool = False) -> tuple[str, ...]:
    """Shapes a task cannot write (I-D10). Points never; boxes in `segment` only as polygons."""
    if task == "segment" and not boxes_as_polygons:
        return ("point", "box", "rbox")
    return ("point",)


def expressible(
    task: LabelTask,
    labels: Sequence[Mapping[str, Any]],
    type_ids: Collection[str],
    *,
    boxes_as_polygons: bool = False,
) -> bool:
    """True when every label of a type in `type_ids` can be written in `task`: only then does the
    image enter (I-D10). Labels of other types do not matter (they are not written at all)."""
    bad = unexpressible_shapes(task, boxes_as_polygons=boxes_as_polygons)
    wanted = set(type_ids)
    return not any(label.get("type_id") in wanted and shape_of(label) in bad for label in labels)


def clip01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def detect_boxes(boxes: list[dict]) -> list[dict]:
    """Flatten each box to its axis-aligned envelope, which is what a 5-number label can say.

    The envelope is the honest projection: a loose label that still contains the object. Writing
    the *unrotated* x/y/w/h instead would write a rectangle that does not.
    """
    out = []
    for b in boxes:
        x, y, w, h = aabb_of(b["x"], b["y"], b["w"], b["h"], b.get("angle", 0.0))
        out.append({"class_id": b["class_id"], "x": x, "y": y, "w": w, "h": h})
    return out


def label_text(boxes: list[dict], class_index: dict[str, int], width: int, height: int) -> str:
    """One `index cx cy w h` line per box, normalised and clipped to the frame.

    The clip is per *edge*, not per number: ultralytics' label verifier discards a whole file when
    one value is over 1, so the edges are clipped first and the centre and sides derived from them.
    """
    lines = []
    for b in boxes:
        index = class_index.get(b["class_id"])
        if index is None:  # the class was removed after the freeze
            continue
        left, right = clip01(b["x"] / width), clip01((b["x"] + b["w"]) / width)
        top, bottom = clip01(b["y"] / height), clip01((b["y"] + b["h"]) / height)
        cx, cy = (left + right) / 2, (top + bottom) / 2
        lines.append(f"{index} {cx:.6f} {cy:.6f} {right - left:.6f} {bottom - top:.6f}")
    return "\n".join(lines) + ("\n" if lines else "")


def _line(index: int, points: Iterable[tuple[float, float]], width: int, height: int) -> str:
    coords = " ".join(f"{clip01(px / width):.6f} {clip01(py / height):.6f}" for px, py in points)
    return f"{index} {coords}"


def _as_row(label: Mapping[str, Any]) -> SimpleNamespace:
    """What `shapes.outline` reads (attribute access), from a label dict."""
    return SimpleNamespace(
        shape=shape_of(label),
        x=float(label["x"]),
        y=float(label["y"]),
        w=float(label["w"]),
        h=float(label["h"]),
        angle=float(label.get("angle") or 0.0),
        points=label.get("points"),
    )


def _obb_corners(label: Mapping[str, Any]) -> list[tuple[float, float]]:
    if shape_of(label) != "polygon":
        return corners_of(label["x"], label["y"], label["w"], label["h"], label.get("angle") or 0.0)
    rect = Polygon(label["points"]).minimum_rotated_rectangle
    if not isinstance(rect, Polygon) or rect.is_empty:  # degenerate (collinear) ring: the envelope
        return corners_of(label["x"], label["y"], label["w"], label["h"], 0.0)
    return [(float(x), float(y)) for x, y in list(rect.exterior.coords)[:4]]


def _segment_rings(label: Mapping[str, Any], width: int, height: int) -> Iterator[list[tuple[float, float]]]:
    ring = outline(_as_row(label))
    if not ring or len(ring) < 3:
        return
    clipped = shapely.clip_by_rect(Polygon(ring), 0.0, 0.0, float(width), float(height))
    for part in shapely.get_parts(clipped):
        if not isinstance(part, Polygon) or part.is_empty:
            continue  # a clip can leave lines or points on the frame edge
        coords = [(float(x), float(y)) for x, y in list(part.exterior.coords)[:-1]]
        if len(coords) >= 3:
            yield coords


def write_labels(
    task: LabelTask,
    labels: Sequence[Mapping[str, Any]],
    class_index: Mapping[str, int],
    width: int,
    height: int,
    *,
    boxes_as_polygons: bool = False,
) -> str:
    """One YOLO label file's text for one image (spec §11.1). Unknown types and shapes the task
    cannot express are left out (R-BT1): callers decide inclusion with `expressible` first."""
    bad = unexpressible_shapes(task, boxes_as_polygons=boxes_as_polygons)
    kept = [lb for lb in labels if lb["type_id"] in class_index and shape_of(lb) not in bad]
    if task == "detect":
        flat = detect_boxes(
            [
                {
                    "class_id": lb["type_id"],
                    "x": lb["x"],
                    "y": lb["y"],
                    "w": lb["w"],
                    "h": lb["h"],
                    "angle": lb.get("angle") or 0.0,
                }
                for lb in kept
            ]
        )
        return label_text(flat, dict(class_index), width, height)
    lines: list[str] = []
    for lb in kept:
        index = class_index[lb["type_id"]]
        if task == "obb":
            lines.append(_line(index, _obb_corners(lb), width, height))
        else:
            lines += [_line(index, ring, width, height) for ring in _segment_rings(lb, width, height)]
    return "\n".join(lines) + ("\n" if lines else "")
