"""Measure smart-polygon latency on this machine (spec 2026-09-26-image-inspection §10 targets, §21 risk 2).

    python scripts/measure_sam_latency.py --weights E:/Dev/Yolo/models/sam2.1_t.pt [--frame x.jpg] [--runs 5]

Runs from `backend/`. For each device (CPU always, CUDA when present) it encodes `--runs` fresh crops
(1024 and 2048 px of source, both resized to 1024) and decodes three clicks per crop, through the real
SegmentService, and prints median ms after one warm-up. Targets: GPU encode <= 150 ms, decode <= 40 ms;
CPU encode <= 3.5 s, decode <= 300 ms.
"""

import argparse
import os
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assist.geometry import quantise_crop  # noqa: E402
from app.assist.service import SegmentService  # noqa: E402

DEFAULT_FRAMES = Path(os.environ.get("KESTREL_FRAMES_DIR", "E:/Dev/Yolo/data/raw/ahmadia"))


def measure(device: str, weights: Path, frame: Path, runs: int, side: int) -> tuple[float, float]:
    from PIL import Image

    with Image.open(frame) as im:
        w, h = im.size
    svc = SegmentService(cuda_available=lambda: device == "cuda")
    encodes, decodes = [], []
    for i in range(runs + 1):  # the first run is the warm-up
        svc.clear_embeddings()
        x = (w - side) / 2 + (i % 3 - 1) * 128
        crop = quantise_crop(x, (h - side) / 2, side, side, w, h)
        cx, cy = crop.x + crop.w / 2, crop.y + crop.h / 2
        prepared = svc.prepare(("m", "m"), frame, crop, weights)
        clicks = [
            svc.segment(("m", "m"), frame, crop, weights, [(cx + d, cy + d)], [1]) for d in (0, 40, -40)
        ]
        if i:
            encodes.append(prepared.encode_ms)
            decodes.extend(c.decode_ms for c in clicks)
    svc.unload()
    return statistics.median(encodes), statistics.median(decodes)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--frame", type=Path, default=None)
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    frame = args.frame or sorted(DEFAULT_FRAMES.glob("*.jpg"))[0]
    import torch

    devices = ["cpu"] + (["cuda"] if torch.cuda.is_available() else [])
    print(f"cpu_count={os.cpu_count()} frame={frame.name}")
    for device in devices:
        for side in (1024, 2048):
            enc, dec = measure(device, args.weights, frame, args.runs, side)
            print(
                f"{device} crop={side} threads={torch.get_num_threads()} "
                f"encode_ms={enc:.0f} decode_ms={dec:.0f}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
