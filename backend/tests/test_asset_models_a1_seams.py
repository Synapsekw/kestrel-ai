# backend/tests/test_asset_models_a1_seams.py
"""A1's seams with F0 and P1 (plan 2026-10-03-plant-model-a1, task 1). Each assertion is a name or a
convention the assembler relies on; when F0 differs, A1's code is adapted, not these meanings."""

import inspect

import numpy as np
import pytest

from app.asset_models.builders import geom
from app.asset_models.builders.base import REGISTRY, BuildCtx, Instanced, MeshNode, build_item, load_all
from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref  # noqa: F401 - the name must exist
from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, PolygonFootprint  # noqa: F401
from app.db.models import AssetItem

KIPIC_SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
COWORK_MATERIALS = [
    "Concrete_Tank", "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark", "Grating", "Handrail",
    "Equipment_White", "Equipment_Grey", "Insulation_Clad", "Pump_Blue", "Machine_Green", "Aluminium_Panel",
    "Pipe", "Pipe_Insulated", "Building_Wall", "Building_Roof", "Shelter_Roof", "Glass", "Ground",
    "Ground_Mainland", "Asphalt", "Paving", "Laydown", "Rock_Armour", "Slope", "Water_Pit", "Sea", "Fence",
    "Safety_Red", "Ship_Hull", "Ship_Bottom", "Ship_Deck", "Zone_Line",
]  # fmt: skip


def test_fallback_builders_are_registered():
    load_all()
    assert {"other", "composite"} <= set(REGISTRY)
    assert REGISTRY["other"].default_height_m > 0


def test_build_item_and_ctx_shapes():
    assert list(inspect.signature(build_item).parameters) == ["item", "ctx"]
    ctx = BuildCtx(grid=None, lod=0.5)
    assert ctx.lod == 0.5
    item = Item.model_validate(
        {
            "id": "a",
            "name": "A",
            "type": "other",
            "footprint": {"kind": "rect", "center": [10.0, 20.0], "size": [4.0, 2.0]},
            "base_el": 100.0,
            "source": {"kind": "assumed"},
        }
    )
    base, top, defaulted = ctx.height(item, 6.0)
    assert (base, top, defaulted) == (100.0, 106.0, True)
    nodes, flags = build_item(item, ctx)
    assert nodes and all(isinstance(n, MeshNode) for n in nodes) and isinstance(flags, list)
    assert Instanced.__dataclass_fields__.keys() >= {"mesh", "transforms"}
    assert ItemFlag(code="builder_fallback", note="x").code == "builder_fallback"


def test_palette_is_coworks_34():
    assert sorted(PALETTE) == sorted(COWORK_MATERIALS)
    rgba, metallic, roughness = PALETTE["Concrete_Tank"]
    assert len(rgba) == 4 and 0 <= metallic <= 1 and 0 <= roughness <= 1


def test_extrude_is_local_x_z_with_y_up():
    mesh = geom.extrude(np.array([[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]]), 3.0)
    np.testing.assert_allclose(mesh.bounds, [[0, 0, 0], [2, 3, 1]], atol=1e-9)


def test_convergence_is_the_true_bearing_of_grid_north():
    from app.asset_models.spec import SiteFrame

    grid = PlantGrid(SiteFrame.model_validate(KIPIC_SITE))
    assert grid.convergence_deg() == pytest.approx(-1.2583, abs=0.01)


def test_asset_item_table():
    assert AssetItem.__tablename__ == "asset_item"
    cols = {c.name for c in AssetItem.__table__.columns}
    assert cols >= {
        "id", "model_id", "version", "node", "tag", "name", "type", "area", "plant_e", "plant_n", "site_x",
        "site_y", "lon", "lat", "base_el", "top_el", "height_source", "confidence", "flags", "source_sheet",
        "has_geometry",
    }  # fmt: skip


def test_a1_stubs_exist_until_a1_lands():
    from app.asset_models import stubs_plant

    ids = {op for _m, _p, op in stubs_plant.A1_STUBS}
    assert ids == {"listAssetModelItems", "getAssetModelItem", "getAssetModelCsv"}
