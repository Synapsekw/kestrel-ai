"""YOLO label writers for detect, obb and segment datasets (image inspection spec §11.1, I-D10).

Used by the library dataset export (`app/library/datasets/export.py`) and the results export
(`app/exports/yolo_out.py`). A label is one `dataset_item.labels` entry:
`{type_id, shape, x, y, w, h, angle, points}` in stored-image pixels. I-C0 fixes the signatures;
unit I-BT implements them.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from typing import Any, Literal

LabelTask = Literal["detect", "obb", "segment"]


def write_labels(
    task: LabelTask,
    labels: Sequence[Mapping[str, Any]],
    class_index: Mapping[str, int],
    width: int,
    height: int,
    *,
    boxes_as_polygons: bool = False,
) -> str:
    """The label-file text for one image (one line per label, coordinates normalised to [0, 1];
    "" when there is none). Labels whose `type_id` is not in `class_index` are skipped."""
    raise NotImplementedError("imagery.labels.write_labels lands with unit I-BT")


def expressible(
    task: LabelTask,
    labels: Sequence[Mapping[str, Any]],
    type_ids: Collection[str],
    *,
    boxes_as_polygons: bool = False,
) -> bool:
    """Whether every label of a selected type can be written in `task`; an image that fails is
    skipped and counted, never written with a label dropped (decision I-D10)."""
    raise NotImplementedError("imagery.labels.expressible lands with unit I-BT")
