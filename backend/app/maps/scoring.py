"""A run scored against ground truth inside evaluation zones (spec section 8).

Only boxes whose centre lies inside a zone count: a zone is the operator's promise that every
machine in it is labelled. Matching is greedy per class, highest confidence first, each detection
taking the unmatched label it overlaps most (IoU at least the threshold). Unmatched detections are
false positives, unmatched labels are misses.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ScoreBox:
    id: str
    class_id: str
    x: float
    y: float
    w: float
    h: float
    confidence: float | None = None


@dataclass(frozen=True)
class Zone:
    id: str
    polygon: list[tuple[float, float]]


def point_in_polygon(x: float, y: float, polygon) -> bool:
    """Ray casting; a point exactly on the right or bottom edge is outside."""
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def zone_of(box: ScoreBox, zones: list[Zone]) -> str | None:
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    return next((z.id for z in zones if point_in_polygon(cx, cy, z.polygon)), None)


def _iou(a: ScoreBox, b: ScoreBox) -> float:
    ix = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    iy = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    return inter / (a.w * a.h + b.w * b.h - inter)


def _row(tp: int, fp: int, fn: int, class_id: str | None = None) -> dict:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision and recall
        else (0.0 if precision == 0 or recall == 0 else None)
    )
    predicted, actual = tp + fp, tp + fn
    return {
        "class_id": class_id,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "predicted": predicted,
        "actual": actual,
        "count_error": predicted - actual,
        "count_error_pct": (predicted - actual) / actual * 100 if actual else None,
    }


def score(
    detections: list[ScoreBox], labels: list[ScoreBox], zones: list[Zone], iou_threshold: float
) -> dict:
    dets = [(b, z) for b in detections if (z := zone_of(b, zones))]
    labs = [(b, z) for b in labels if (z := zone_of(b, zones))]
    matches: list[dict] = []
    taken: set[str] = set()
    for det, zone in sorted(dets, key=lambda p: -(p[0].confidence or 0.0)):
        best, best_iou = None, iou_threshold
        for lab, _ in labs:
            if lab.class_id != det.class_id or lab.id in taken:
                continue
            v = _iou(det, lab)
            if v >= best_iou:
                best, best_iou = lab, v
        if best is not None:
            taken.add(best.id)
        matches.append(
            {
                "kind": "detection",
                "id": det.id,
                "match": "tp" if best else "fp",
                "zone_id": zone,
                "class_id": det.class_id,
                "x": det.x,
                "y": det.y,
                "w": det.w,
                "h": det.h,
            }
        )
    for lab, zone in labs:
        matches.append(
            {
                "kind": "label",
                "id": lab.id,
                "match": "tp" if lab.id in taken else "fn",
                "zone_id": zone,
                "class_id": lab.class_id,
                "x": lab.x,
                "y": lab.y,
                "w": lab.w,
                "h": lab.h,
            }
        )

    def tally(pred) -> tuple[int, int, int]:
        sel = [m for m in matches if pred(m)]
        tp = sum(1 for m in sel if m["kind"] == "detection" and m["match"] == "tp")
        return tp, sum(1 for m in sel if m["match"] == "fp"), sum(1 for m in sel if m["match"] == "fn")

    classes = sorted({m["class_id"] for m in matches})
    return {
        "iou": iou_threshold,
        "has_zones": bool(zones),
        "overall": _row(*tally(lambda m: True)),
        "per_class": [_row(*tally(lambda m, c=c: m["class_id"] == c), class_id=c) for c in classes],
        "per_zone": [{**_row(*tally(lambda m, z=z: m["zone_id"] == z.id)), "zone_id": z.id} for z in zones],
        "matches": [
            {k: m[k] for k in ("kind", "id", "match", "zone_id", "class_id", "x", "y", "w", "h")}
            for m in matches
        ],
    }
