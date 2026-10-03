"""The plant builder catalogue (spec 2026-10-03-plant-model-generator §10; plan pm-f0 Task 10).

Not project-scoped: the catalogue is the app's registered builders, whatever project is open. It
grows as the builder units (B1 to B3) land, with no contract change (spec §15).
"""

from fastapi import APIRouter

from app.asset_models.builders.base import catalogue
from app.asset_models.schemas_plant import AssetModelCatalogueOut

router = APIRouter(tags=["assetmodels"])


@router.get("/asset-models/catalogue", response_model=AssetModelCatalogueOut)
def get_asset_model_catalogue():
    return AssetModelCatalogueOut.model_validate({"types": catalogue()})
