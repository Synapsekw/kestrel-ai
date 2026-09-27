"""Camera distance and ground sample distance for one image (image inspection spec §9.3).

I-C0 ships `scale` answering None — "no distance rule applies: pixels only", spec §9.3 rule 4 — so
unit I-BA's image measurements can land before unit I-BK, which implements the four rules here
(and the rest of the camera module) without changing this signature.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.db.models import Image

DistanceSource = Literal["manual", "lrf", "rel_alt"]


@dataclass(frozen=True)
class Scale:
    distance_m: float
    distance_sigma_m: float
    distance_source: DistanceSource
    gsd_mm: float  # millimetres per stored-image pixel


def scale(image: Image) -> Scale | None:
    """The first distance rule that applies to `image`, and its GSD; None means pixels only."""
    return None
