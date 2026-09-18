"""The JSON schema cloud providers must answer with, and the parser that trusts nothing (spec 8).

Coordinates come back normalised to the tile so the model never has to reason about pixel sizes;
everything downstream works in full-image pixels.
"""

from __future__ import annotations

import json

from app.providers.base import Detection, ProviderError, Tile
from app.providers.tiling import to_full_image

FIELDS = ("x", "y", "w", "h", "confidence")


def box_list_schema(class_names: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "boxes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "enum": list(class_names)},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "w": {"type": "number"},
                        "h": {"type": "number"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["label", "x", "y", "w", "h", "confidence"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["boxes"],
        "additionalProperties": False,
    }


def prompt_for(query: str, class_names: list[str]) -> str:
    classes = ", ".join(class_names)
    return (
        "This is a tile cut from a nadir (straight-down) aerial photograph of a construction site.\n"
        f"Find every object in it that matches this description: {query}\n"
        f"Label each one with exactly one of these class names: {classes}. "
        "Ignore anything that does not fit one of them.\n"
        "Give one box per object, never one box around a group. Coordinates are normalised to this "
        "tile: x and y are the top-left corner and w and h the size, each between 0 and 1, with the "
        "origin at the top-left of the tile. confidence is between 0 and 1.\n"
        'Return {"boxes": []} when nothing in the tile matches.'
    )


def _unit(value) -> float:
    return min(1.0, max(0.0, float(value)))


def _number(item: dict, key: str) -> float:
    value = item[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{key} is not a number")
    return float(value)


def parse_boxes(payload: dict, tile: Tile, class_names: list[str], raw_ref: str) -> list[Detection]:
    """Validate a provider payload and map it to full-image pixels. Bad shape is permanent."""
    try:
        boxes = payload["boxes"]
        if not isinstance(boxes, list):
            raise TypeError("boxes is not a list")
        parsed = [
            (str(item["label"]), {k: _number(item, k) for k in FIELDS})
            for item in boxes
            if isinstance(item, dict)
        ]
        if len(parsed) != len(boxes):
            raise TypeError("a box is not an object")
    except (AttributeError, KeyError, TypeError, ValueError) as e:
        raise ProviderError(f"unusable provider payload: {e}", retryable=False) from e

    allowed = set(class_names)
    out: list[Detection] = []
    for label, v in parsed:
        if label not in allowed:
            continue
        in_tile = Detection(
            label=label,
            x=_unit(v["x"]) * tile.w,
            y=_unit(v["y"]) * tile.h,
            w=(_unit(v["x"] + v["w"]) - _unit(v["x"])) * tile.w,
            h=(_unit(v["y"] + v["h"]) - _unit(v["y"])) * tile.h,
            confidence=_unit(v["confidence"]),
            raw_ref=raw_ref,
        )
        if in_tile.w > 0 and in_tile.h > 0:
            out.append(to_full_image(in_tile, tile))
    return out


def parse_text(text: str, tile: Tile, class_names: list[str], raw_ref: str) -> list[Detection]:
    """Structured output is JSON text; a non-JSON answer is a permanent failure for this tile."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as e:
        raise ProviderError(f"provider did not return JSON: {e}", retryable=False) from e
    return parse_boxes(payload, tile, class_names, raw_ref)
