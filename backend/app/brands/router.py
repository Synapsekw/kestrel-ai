"""`/brands` (spec 2026-10-02-asset-findings §8; plan D2 Tasks 4 and 5). App level, not per project:
every operation needs the catalogue (503 `catalogue_unavailable` without it)."""

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse

from app.brands import store
from app.brands.schemas import BrandCreate, BrandList, BrandLogoImport, BrandOut, BrandPatch, LogoSlot
from app.catalogue.handle import CatalogueHandle, get_catalogue
from app.errors import not_found

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


CACHE_CONTROL = "private, max-age=31536000, immutable"  # callers add ?v=<logo id>


@router.get("/{brandId}/logos/{slot}", response_class=FileResponse)
def get_brand_logo(
    brandId: str,  # noqa: N803
    slot: LogoSlot,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> FileResponse:
    brand = store.get_brand(cat, brandId)
    if brand is None:
        raise not_found("brand", brandId)
    path = store.logo_path(cat, getattr(brand, f"logo_{slot}"))
    if path is None:
        raise not_found("brand logo", f"{brandId}/{slot}")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": CACHE_CONTROL})


@router.put("/{brandId}/logos/{slot}", response_model=BrandOut)
def set_brand_logo(
    brandId: str,  # noqa: N803
    slot: LogoSlot,
    body: BrandLogoImport,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> BrandOut:
    return store.set_logo(cat, brandId, slot, body.path)


@router.delete("/{brandId}/logos/{slot}", response_model=BrandOut)
def clear_brand_logo(
    brandId: str,  # noqa: N803
    slot: LogoSlot,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> BrandOut:
    return store.clear_logo(cat, brandId, slot)
