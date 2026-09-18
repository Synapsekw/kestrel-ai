"""Train/val assignment (spec section 5).

Frames from one flight overlap heavily, so a group must never straddle the split: otherwise the
validation score measures memorisation. `by_group` and `by_tile` therefore move whole groups,
smallest first, until the validation fraction is reached; the largest groups stay in train.
"""

from __future__ import annotations

import random

TRAIN, VAL = "train", "val"


def assign_splits(
    images: list[tuple[str, str]], method: str, val_fraction: float, seed: int
) -> dict[str, str]:
    """`images` are (image_id, group key); for `by_tile` the caller passes tile keys."""
    if not images:
        return {}
    ids = [image_id for image_id, _ in images]
    n = len(ids)
    target = round(val_fraction * n)
    groups: dict[str, list[str]] = {}
    for image_id, key in images:
        groups.setdefault(key, []).append(image_id)

    if method == "random" or len(groups) < 2:  # one group cannot be split by group
        shuffled = list(ids)
        random.Random(seed).shuffle(shuffled)
        val = set(shuffled[: min(target, n - 1) if n >= 2 else target])
    else:
        order = list(groups)
        random.Random(seed).shuffle(order)  # seeded tie-break between equally sized groups
        order.sort(key=lambda k: len(groups[k]))
        val, count = set(), 0
        for key in order:
            if count >= target or (n >= 2 and count + len(groups[key]) >= n):
                break  # at least one image always stays in train
            val.update(groups[key])
            count += len(groups[key])
    return {image_id: (VAL if image_id in val else TRAIN) for image_id in ids}
