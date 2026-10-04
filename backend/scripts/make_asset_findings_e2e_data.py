"""The synthetic telecom tower for the real-backend asset findings flow (plan
2026-10-03-asset-findings, close-out X): its 32 photos, its GLB, its frame and the truth findings,
generated at run time by `tests/fixtures/synthetic_tower.py`. Nothing binary is committed.

Usage: python scripts/make_asset_findings_e2e_data.py <out-dir>
Prints one JSON line: {"photos": <dir>, "glb": <path>, "frame": {...}, "profile_id": ...,
"image_size": [w, h], "truth": [{"id", "cls", "zone", "side", "sightings": [{"image_name", "box"}]}]}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(BACKEND), str(BACKEND / "tests")]

from fixtures.synthetic_tower import make_tower  # noqa: E402


def main(out: Path) -> dict:
    tower = make_tower(out, photos=True)
    return {
        "photos": str(tower.photos_dir),
        "glb": str(tower.glb_path),
        "frame": tower.frame.model_dump(mode="json"),
        "profile_id": tower.profile_id,
        "image_size": list(tower.image_size),
        "truth": [
            {
                "id": t.id,
                "cls": t.cls,
                "zone": t.zone,
                "side": t.side,
                "sightings": [{"image_name": s.image_name, "box": list(s.box)} for s in t.sightings],
            }
            for t in tower.truth
        ],
    }


if __name__ == "__main__":
    print(json.dumps(main(Path(sys.argv[1]))))
