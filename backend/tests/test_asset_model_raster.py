"""Software rasterizer (spec §7.4): deterministic, bounded, readable."""

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.asset_models.build import build_meshes
from app.asset_models.raster import MAX_SIZE, View, grid, render
from app.asset_models.spec import AssetSpec

GOLDEN = Path(__file__).parent / "data" / "asset_models"
SPEC = AssetSpec.model_validate(
    {
        "parts": [
            {
                "id": "shell",
                "name": "Shell",
                "group": "Shell",
                "shape": "cylinder",
                "params": {"id": 4000, "thickness": 8, "height": 8000},
                "source": {"kind": "assumed"},
            },
            {
                "id": "roof",
                "name": "Roof",
                "group": "Head",
                "shape": "head_torispherical",
                "params": {"id": 4000, "thickness": 8, "crown_r": 4000, "knuckle_r": 400},
                "placement": {"origin_mm": [0, 8000, 0]},
                "source": {"kind": "assumed"},
            },
            {
                "id": "N7",
                "name": "N7",
                "group": "Nozzle",
                "shape": "nozzle",
                "params": {"dn": 300, "od": 323.9, "projection": 400, "flange_od": 485, "flange_t": 40},
                "placement": {"host": "shell", "bearing_deg": 90, "elevation_mm": 4000},
                "source": {"kind": "assumed"},
            },
        ]
    }
)
GROUPS = {p.id: p.group for p in SPEC.parts}


@pytest.fixture(scope="module")
def meshes():
    return build_meshes(SPEC)


def arr(img):
    return np.asarray(img, dtype=np.int16)


def test_render_is_deterministic(meshes):
    a = render(meshes, View("iso"), size=256, groups=GROUPS)
    b = render(meshes, View("iso"), size=256, groups=GROUPS)
    assert a.size == (256, 256) and a.mode == "RGB"
    assert np.array_equal(arr(a), arr(b))


def test_size_is_capped(meshes):
    assert render(meshes, View("top"), size=5000, groups=GROUPS).size == (MAX_SIZE, MAX_SIZE)


def test_front_view_is_taller_than_wide(meshes):
    img = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    bg = img[0, 0]
    fg = np.any(img != bg, axis=2)
    rows, cols = np.where(fg)
    assert (rows.max() - rows.min()) > 1.5 * (cols.max() - cols.min())


def test_nozzle_at_bearing_90_shows_on_the_right_in_front_view(meshes):
    # looking north, east (+Z) is to the right
    with_n = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    without = arr(
        render({k: v for k, v in meshes.items() if k != "N7"}, View("front"), size=256, groups=GROUPS)
    )
    diff_cols = np.where(np.any(with_n != without, axis=2))[1]
    assert diff_cols.mean() > 128


def test_section_removes_the_near_half(meshes):
    full = arr(render(meshes, View("front"), size=256, groups=GROUPS))
    cut = arr(render(meshes, View("section", bearing_deg=0), size=256, groups=GROUPS))
    assert not np.array_equal(full, cut)


def test_labels_change_pixels(meshes):
    plain = arr(render(meshes, View("iso"), size=256, groups=GROUPS))
    labelled = arr(render(meshes, View("iso"), size=256, groups=GROUPS, labels=True))
    assert np.any(plain != labelled)


@pytest.mark.parametrize("kind", ["iso", "front", "top"])
def test_matches_golden(meshes, kind):
    img = render(meshes, View(kind), size=256, groups=GROUPS)
    golden = Image.open(GOLDEN / f"tank_{kind}.png").convert("RGB")
    diff = np.abs(arr(img) - arr(golden))
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly


def test_grid_contact_sheet(meshes):
    imgs = [render(meshes, View(k), size=512, groups=GROUPS) for k in ("iso", "front", "side", "top")]
    sheet = grid(imgs, ["iso", "front", "side", "top"])
    assert max(sheet.size) <= 1600
