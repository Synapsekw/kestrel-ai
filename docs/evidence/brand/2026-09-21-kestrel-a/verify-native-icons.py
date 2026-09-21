"""Verify the icon resources extracted from the actual installed app and setup executables."""
import sys
from pathlib import Path

from PIL import Image

folder = Path(sys.argv[1])
for variant, side in (("small", 16), ("large", 32)):
    pixels = []
    for executable in ("installed-app", "installer"):
        path = folder / f"{executable}-{variant}.png"
        with Image.open(path) as image:
            rgba = image.convert("RGBA")
            assert rgba.size == (side, side), f"{path.name}: unexpected dimensions {rgba.size}"
            colors = {color: count for count, color in rgba.getcolors(side * side)}
            assert colors.get((229, 175, 100, 255), 0) > side * side * 0.35, f"{path.name}: Contour amber missing"
            assert colors.get((29, 35, 34, 255), 0) > side * side * 0.03, f"{path.name}: charcoal mark missing"
            assert rgba.getpixel((0, 0))[3] == 0, f"{path.name}: rounded transparent corner missing"
            pixels.append(rgba.tobytes())
    assert pixels[0] == pixels[1], f"{variant}: app and installer icon resources differ"
    print(f"PASS native {side}px app/setup resources match, with amber tile, charcoal mark and transparency")
