"""R1 builds on these F0 names (plan 2026-10-03-plant-model-r1, Task 1). A rename in F0 fails here first."""

import inspect


def test_spec_models_exist():
    from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, SiteFrame

    assert {"site", "items", "environment"} <= set(AssetSpec.model_fields)
    assert {
        "id",
        "tag",
        "type",
        "footprint",
        "base_el",
        "top_el",
        "height_source",
        "source",
        "flags",
        "parts",
    } <= set(Item.model_fields)
    assert {"code", "value", "note"} <= set(ItemFlag.model_fields)
    assert {"id", "kind", "pts", "el", "source"} <= set(EnvFeature.model_fields)
    assert {"crs", "origin_crs", "plant_north_deg", "datum", "cloud_z_to_el", "source"} <= set(
        SiteFrame.model_fields
    )


def test_siteframe_functions_exist():
    from app.asset_models import siteframe

    for name in ("PlantGrid", "fit_plant_grid", "footprint_ref", "footprint_polygon", "GridError"):
        assert hasattr(siteframe, name), name
    assert list(inspect.signature(siteframe.fit_plant_grid).parameters) == ["pairs"]


def test_builders_registry_exists():
    from app.asset_models.builders import base as builders  # F0 keeps builders/__init__ import-free

    for name in ("REGISTRY", "BuildCtx", "MeshNode", "Instanced", "build_item", "catalogue", "load_all"):
        assert hasattr(builders, name), name
    builders.load_all()
    assert "other" in builders.REGISTRY and "composite" in builders.REGISTRY


def test_package_table_and_model_kind_exist():
    from app.db.models import AssetModel, SiteModelPackage

    cols = set(SiteModelPackage.__table__.columns.keys())
    assert {
        "id",
        "run_id",
        "n",
        "label",
        "drawing_id",
        "region",
        "area",
        "state",
        "usage",
        "item_count",
        "summary",
        "started_at",
        "ended_at",
    } <= cols
    assert "kind" in AssetModel.__table__.columns.keys()


def test_plant_modes():
    from app.asset_models.agent.plant import PLANT_MODES

    assert PLANT_MODES == ("plant", "plant_package")
