"""`/brands` (spec 2026-10-02-asset-findings §8; plan D2 Tasks 4 and 5). App level, not per project:
every operation needs the catalogue (503 `catalogue_unavailable` without it)."""

from fastapi import APIRouter, Depends, Response

from app.brands import store
from app.brands.schemas import BrandCreate, BrandList, BrandOut, BrandPatch
from app.catalogue.handle import CatalogueHandle, get_catalogue

router = APIRouter(prefix="/brands", tags=["brands"])


@router.get("", response_model=BrandList)
def list_brands(cat: CatalogueHandle = Depends(get_catalogue)) -> BrandList:
    return BrandList(items=store.list_brands(cat))


@router.post("", response_model=BrandOut, status_code=201)
def create_brand(body: BrandCreate, cat: CatalogueHandle = Depends(get_catalogue)) -> BrandOut:
    return store.create_brand(cat, body)


@router.patch("/{brandId}", response_model=BrandOut)
def patch_brand(
    brandId: str,  # noqa: N803
    body: BrandPatch,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> BrandOut:
    return store.patch_brand(cat, brandId, body)


@router.delete("/{brandId}", status_code=204)
def delete_brand(brandId: str, cat: CatalogueHandle = Depends(get_catalogue)) -> Response:  # noqa: N803
    store.delete_brand(cat, brandId)
    return Response(status_code=204)
