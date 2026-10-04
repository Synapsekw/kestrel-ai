"""The rasterizer's framing window and markers (spec 2026-10-02-asset-findings §10, decision A9)."""

import numpy as np
import pytest
import trimesh

from app.asset_models.raster import BG, Marker, View, render

BOX = {"asset": trimesh.creation.box(extents=(2.0, 2.0, 2.0))}
LOOK = View("custom", direction=(-1.0, 0.0, 0.0))  # from +X towards the face at x = 1
RED = (255, 0, 0)


def test_a_pin_lands_on_its_point_when_framed_on_it():
    img = render(
        BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("pin", ((1.0, 0.0, 0.0),), RED)]
    )
    assert img.getpixel((128, 128)) == RED


def test_a_pin_off_centre_follows_the_projection():
    # scale = 256 * 0.88 / 4 = 56.32 px per metre; one metre up is 56 px higher on the image
    img = render(
        BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("pin", ((1.0, 1.0, 0.0),), RED)]
    )
    assert img.getpixel((128, 72)) == RED
    assert img.getpixel((128, 128)) != RED


def test_an_outline_is_drawn_through_its_points():
    square = ((1.0, -0.5, -0.5), (1.0, -0.5, 0.5), (1.0, 0.5, 0.5), (1.0, 0.5, -0.5))
    img = render(BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("outline", square, RED)])
    column = [img.getpixel((128, y)) for y in range(96, 104)]  # the top edge, y = 0.5 m, at row ~100
    assert RED in column
    assert img.getpixel((128, 128)) != RED  # the inside stays the model


def test_the_window_zooms_in():
    whole = render(BOX, LOOK, size=128)
    close = render(BOX, LOOK, size=128, window=((1.0, 0.0, 0.0), 0.5))
    assert whole.getpixel((0, 0)) == BG
    assert close.getpixel((0, 0)) != BG


def test_a_window_with_nothing_in_it_is_background_and_markers():
    img = render(
        BOX,
        LOOK,
        size=128,
        window=((50.0, 50.0, 50.0), 1.0),
        markers=[Marker("pin", ((50.0, 50.0, 50.0),), RED)],
    )
    assert img.getpixel((0, 0)) == BG and img.getpixel((64, 64)) == RED


def test_a_framed_render_is_deterministic():
    kw = dict(size=200, window=((1.0, 0.2, 0.1), 1.5), markers=[Marker("pin", ((1.0, 0.2, 0.1),), RED)])
    assert np.array_equal(np.asarray(render(BOX, LOOK, **kw)), np.asarray(render(BOX, LOOK, **kw)))


def test_a_window_on_a_huge_face_is_still_filled():
    huge = {"asset": trimesh.creation.box(extents=(2.0, 100.0, 100.0))}
    img = np.asarray(render(huge, LOOK, size=256, window=((1.0, 0.0, 0.0), 1.0)))
    assert (img != np.array(BG)).any(axis=2).mean() > 0.5


def test_a_bad_window_half_width_is_refused():
    for half in (0.0, -1.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            render(BOX, LOOK, size=128, window=((1.0, 0.0, 0.0), half))
