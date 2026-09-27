"""Per-image annotation aggregates (image inspection spec §7.1, decision I-D2).

`touch(s, image_id)` recomputes one image's `image_summary` row from its boxes, inside the caller's
transaction (an upsert). Every box write, review action and the `infer` job's write calls it (units
I-BA and I-BP). I-C0 ships it as a no-op so callers can land before unit I-BX implements it, with
the semantics migration 0011 seeded:
- annotation_count: boxes with review_state in ('accepted', 'edited') and shape <> 'point'
- pending_count: boxes with review_state = 'unreviewed'
- max_pending_conf: the highest confidence among those unreviewed boxes, null when there is none
"""

from __future__ import annotations

from sqlalchemy.orm import Session


def touch(s: Session, image_id: str) -> None:
    """Recompute `image_summary` for `image_id` in `s`'s transaction. A no-op until I-BX lands."""
    return None
