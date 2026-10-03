"""Environment meshes (plant model spec 2026-10-03 §5 EnvFeature, unit B3): land, sea, road, paved,
laydown, slope, revetment, in the scene frame."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import CTX, assert_golden, bounds, cowork, materials, same_geometry
from shapely.geometry import Polygon

from app.asset_models.builders import civil, environment
from app.asset_models.builders.base import BuildCtx
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import EnvFeature, SiteFrame

S = {"kind": "assumed"}
FRAME = SiteFrame.model_validate(
    {
        "crs": {"epsg": 32639},
        "origin_crs": [244338.089, 3179515.69],
        "plant_north_deg": 17.9991,
        "datum": {"label": "HPFS", "el_m": 100.0},
        "source": S,
    }
)
GRID_CTX = BuildCtx(grid=PlantGrid(FRAME))
SQUARE = [[0, 0], [200, 0], [200, 100], [0, 100]]  # E 0..200, N 0..100
U_SHAPE = [[0, 0], [90, 0], [90, 60], [60, 60], [60, 20], [30, 20], [30, 60], [0, 60]]  # area 4200


def feat(kind: str, pts, el: float = 100.0, id_: str = "f1") -> EnvFeature:
    return EnvFeature(id=id_, kind=kind, pts=pts, el=el, source=S)


def test_sea_is_a_flat_up_facing_surface_marked_for_the_water_shader():
    (node,) = environment.build_env(feat("sea", SQUARE, el=93.56), GRID_CTX)
    assert node.material == "Sea"
    assert node.extras == {"env": "sea", "id": "f1"}
    m = node.geometry
    assert np.allclose(m.vertices[:, 1], -6.44)  # EL 93.56 against datum 100
    assert (m.face_normals[:, 1] > 0.99).all()
    assert len(m.faces) == 2


def test_scene_frame_axes_without_a_grid():
    (node,) = environment.build_env(feat("sea", SQUARE, el=3.0), CTX)
    b = node.geometry.bounds
    assert b[:, 0].tolist() == pytest.approx([0, 100])  # x = plant north
    assert b[:, 2].tolist() == pytest.approx([0, 200])  # z = plant east
    assert b[:, 1].tolist() == pytest.approx([3.0, 3.0])  # no datum: y = EL


def test_land_cap_and_armour_skirt_reach_below_the_sea():
    nodes = environment.build_env(feat("land", SQUARE), GRID_CTX, sea_el=93.56)
    cap, skirt = nodes
    assert (cap.material, skirt.material) == ("Ground", "Rock_Armour")
    assert cap.extras["env"] == "land" and skirt.extras["env"] == "land"
    assert np.allclose(cap.geometry.vertices[:, 1], 0.0)
    drop = 100.0 - 93.56 + environment.SEA_TOE_M
    assert skirt.geometry.bounds[0, 1] == pytest.approx(-drop)
    run = drop * environment.ARMOUR_RUN
    assert (cap.geometry.bounds[0] - skirt.geometry.bounds[0])[[0, 2]] == pytest.approx([run, run])
    assert skirt.geometry.face_normals[:, 1].min() > 0  # every skirt face looks up and out


def test_land_without_a_sea_drops_a_fixed_depth():
    _, skirt = environment.build_env(feat("land", SQUARE), GRID_CTX)
    assert skirt.geometry.bounds[0, 1] == pytest.approx(-environment.LAND_DEPTH_M)


def test_concave_land_is_not_filled_in():
    cap, _ = environment.build_env(feat("land", U_SHAPE), GRID_CTX)
    assert cap.geometry.area == pytest.approx(4200.0)


@pytest.mark.parametrize(
    ("kind", "material"),
    [
        ("road", "Asphalt"),
        ("paved", "Paving"),
        ("laydown", "Laydown"),
        ("slope", "Slope"),
        ("revetment", "Rock_Armour"),
    ],
)
def test_surface_kinds_are_slabs_with_their_lift(kind, material):
    (node,) = environment.build_env(feat(kind, U_SHAPE, el=97.5), GRID_CTX)
    assert node.material == material and node.extras["env"] == kind
    top = -2.5 + civil.LIFT[material]
    assert node.geometry.bounds[:, 1].tolist() == pytest.approx([top - civil.SLAB_T, top])
    assert node.geometry.is_watertight


def test_degenerate_features_yield_nothing_instead_of_raising():
    # the schema needs 3 points, so a 2-point feature can only arrive unvalidated (model_construct)
    two = EnvFeature.model_construct(id="f1", kind="road", pts=[[0, 0], [10, 10]], el=100.0, source=S)
    assert environment.build_env(two, GRID_CTX) == []
    assert environment.build_env(feat("paved", [[0, 0], [0, 0], [0, 0]]), GRID_CTX) == []
    assert environment.build_env(feat("land", [[0, 0], [5, 0], [10, 0]]), GRID_CTX) == []  # collinear


def test_a_failing_feature_is_logged_by_id_and_error_type_only(monkeypatch, caplog):
    def boom(*_a, **_k):
        raise RuntimeError("secret detail 123.456")

    monkeypatch.setattr(environment, "surface", boom)
    with caplog.at_level("WARNING", logger=environment.__name__):
        assert environment.build_env(feat("sea", SQUARE, id_="sea-9"), GRID_CTX) == []
    (rec,) = [r for r in caplog.records if r.name == environment.__name__]
    assert rec.levelname == "WARNING"
    msg = rec.getMessage()
    assert "sea-9" in msg and "sea" in msg and "RuntimeError" in msg
    assert "secret" not in msg and "123.456" not in msg


def test_a_closed_ring_and_a_bow_tie_still_build():
    ring = [*SQUARE, SQUARE[0]]
    (node,) = environment.build_env(feat("paved", ring), GRID_CTX)
    assert len(node.geometry.faces) == 12
    (bow,) = environment.build_env(feat("slope", [[0, 0], [10, 10], [10, 0], [0, 10]]), GRID_CTX)
    assert bow.geometry.volume > 0


def test_build_environment_uses_the_lowest_sea_for_every_land_skirt():
    feats = [
        feat("land", SQUARE, id_="a"),
        feat("sea", SQUARE, el=95.0, id_="s1"),
        feat("sea", SQUARE, el=93.0, id_="s2"),
        feat("road", U_SHAPE, id_="r"),
    ]
    nodes = environment.build_environment(feats, GRID_CTX)
    assert [n.name for n in nodes] == ["a", "a-edge", "s1", "s2", "r"]
    assert nodes[1].geometry.bounds[0, 1] == pytest.approx(93.0 - environment.SEA_TOE_M - 100.0)


def test_al_zour_landmask_builds_land_over_its_full_outline():
    rings = cowork()["landmask"]
    feats = [
        feat("land", rings["land"][0], id_="land"),
        feat("land", rings["main"][0], el=99.2, id_="mainland"),
        feat("sea", [[-1700, 3450], [4300, 3450], [4300, -550], [-1700, -550]], el=93.56, id_="sea"),
    ]
    nodes = environment.build_environment(feats, GRID_CTX)
    by = {n.name: n for n in nodes}
    assert by["land"].geometry.area == pytest.approx(Polygon(rings["land"][0]).area, rel=1e-6)
    assert materials(nodes) == {"Ground", "Rock_Armour", "Sea"}
    assert by["sea"].extras["env"] == "sea"
    assert np.isfinite(bounds(nodes)).all()
    assert same_geometry(nodes, environment.build_environment(feats, GRID_CTX))
    assert_golden([by["land"], by["land-edge"], by["mainland"], by["mainland-edge"]], "env_land", "top")


def test_environment_kinds_are_not_registered_builders():
    from app.asset_models.builders.base import REGISTRY

    assert not {"land", "sea", "slope"} & set(REGISTRY)
