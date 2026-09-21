"""Prepare private capture fixtures at the same bounds/quality as the existing image API."""
import sys
from pathlib import Path

from PIL import Image

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
for side in (256, 1024):
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((side, side), Image.Resampling.LANCZOS)
        image.save(output / f"{side}.jpg", "JPEG", quality=85, optimize=True)
