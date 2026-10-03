"""Report brands (spec 2026-10-02-asset-findings §5.8; plan D2 Tasks 4 and 5).

Stored in `catalogue.db` beside the Catalogue and the templates. The two built-ins are seeded by
catalogue migration 0004; they can be edited but never deleted (409 `brand_builtin`). A report names
a brand by `ReportConfig.brand_id`; R1 reads it through `get_brand`, which answers None for a deleted
brand, so that report prints with the Kestrel theme rather than failing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.brands.builtins import DEFAULT_COLORS
from app.brands.fonts import FAMILIES
from app.brands.schemas import BrandColors, BrandCreate, BrandOut, BrandPatch
from app.catalogue.db import Brand
from app.catalogue.handle import CatalogueHandle
from app.catalogue.names import normalise_name
from app.db.base import new_id
from app.errors import AppError, not_found

LIST_CAP = 200  # BrandList has no cursor; an operator keeps a handful of brands
TEXT_FIELDS = ("website", "owner", "confidentiality", "pdf_author")
log = logging.getLogger(__name__)


@dataclass(frozen=True)
class BrandRow:
    """A brand as R1 prints it: plain values, readable after the session closed."""

    id: str
    name: str
    colors: dict[str, str]
    font_text: str | None
    font_numerals: str | None
    logo_on_light: str | None
    logo_on_dark: str | None
    logo_flat: str | None
    website: str
    owner: str
    confidentiality: str
    pdf_author: str
    builtin: bool


def _snapshot(row: Brand) -> BrandRow:
    return BrandRow(
        id=row.id,
        name=row.name,
        colors=dict(row.colors),
        font_text=row.font_text,
        font_numerals=row.font_numerals,
        logo_on_light=row.logo_on_light,
        logo_on_dark=row.logo_on_dark,
        logo_flat=row.logo_flat,
        website=row.website or "",
        owner=row.owner or "",
        confidentiality=row.confidentiality or "",
        pdf_author=row.pdf_author or "",
        builtin=bool(row.builtin),
    )


def to_out(row: Brand) -> BrandOut:
    return BrandOut(
        id=row.id,
        name=row.name,
        colors=BrandColors.model_validate(row.colors),
        font_text=row.font_text,
        font_numerals=row.font_numerals,
        logo_on_light=row.logo_on_light,
        logo_on_dark=row.logo_on_dark,
        logo_flat=row.logo_flat,
        website=row.website or "",
        owner=row.owner or "",
        confidentiality=row.confidentiality or "",
        pdf_author=row.pdf_author or "",
        builtin=bool(row.builtin),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _invalid(path: str, message: str) -> AppError:
    return AppError("invalid_brand", message, 422, {"errors": [{"path": path, "message": message}]})


def _clean_name(name: str) -> tuple[str, str]:
    clean = " ".join(name.split())
    key = normalise_name(clean)
    if not key:
        raise _invalid("name", "A brand name cannot be blank.")
    return clean, key


def _check_font(path: str, family: str | None) -> None:
    if family is not None and family not in FAMILIES:
        fonts = list(FAMILIES)
        raise AppError(
            "unknown_font",
            f"{family} is not a bundled font; use {', '.join(fonts)}, or none for the report's own font.",
            422,
            {"path": path, "fonts": fonts},
        )


def _colors(colors: BrandColors) -> dict[str, str]:
    return {k: v.upper() for k, v in colors.model_dump().items()}


def _refuse_taken(s, key: str, exclude: str | None = None) -> None:
    q = select(Brand).where(Brand.name_key == key)
    if exclude:
        q = q.where(Brand.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "brand_name_taken",
            f"There is already a brand called {holder.name}.",
            409,
            {"brand_id": holder.id},
        )


def _row(s, brand_id: str) -> Brand:
    row = s.get(Brand, brand_id)
    if row is None:
        raise not_found("brand", brand_id)
    return row


def list_brands(cat: CatalogueHandle) -> list[BrandOut]:
    """Built-ins first, then by name. A row this version cannot read is left out and logged."""
    with cat.session() as s:
        rows = (
            s.execute(select(Brand).order_by(Brand.builtin.desc(), Brand.name_key, Brand.id).limit(LIST_CAP))
            .scalars()
            .all()
        )
        out: list[BrandOut] = []
        for row in rows:
            try:
                out.append(to_out(row))
            except ValidationError:
                log.warning("brand %s has colours this version cannot read; left out", row.id)
        return out


def get_brand(cat: CatalogueHandle | None, brand_id: str | None) -> BrandRow | None:
    """The brand a report names, or None: no catalogue, no id, or a brand deleted since."""
    if cat is None or not brand_id:
        return None
    with cat.session() as s:
        row = s.get(Brand, brand_id)
        return _snapshot(row) if row is not None else None


def create_brand(cat: CatalogueHandle, body: BrandCreate) -> BrandOut:
    name, key = _clean_name(body.name)
    _check_font("font_text", body.font_text)
    _check_font("font_numerals", body.font_numerals)
    try:
        with cat.session() as s:
            _refuse_taken(s, key)
            row = Brand(
                id=new_id(),
                name=name,
                name_key=key,
                colors=_colors(body.colors) if body.colors is not None else dict(DEFAULT_COLORS),
                font_text=body.font_text,
                font_numerals=body.font_numerals,
                website=body.website.strip(),
                owner=body.owner.strip(),
                confidentiality=body.confidentiality.strip(),
                pdf_author=body.pdf_author.strip(),
                builtin=False,
            )
            s.add(row)
            s.flush()
            return to_out(row)
    except IntegrityError as e:  # a concurrent save of the same name won the race
        raise AppError("brand_name_taken", f"There is already a brand called {name}.", 409) from e


def patch_brand(cat: CatalogueHandle, brand_id: str, body: BrandPatch) -> BrandOut:
    fields = body.model_dump(exclude_unset=True)
    for path in ("font_text", "font_numerals"):
        if path in fields:
            _check_font(path, fields[path])
    try:
        with cat.session() as s:
            row = _row(s, brand_id)
            if fields.get("name") is not None:
                name, key = _clean_name(fields["name"])
                _refuse_taken(s, key, exclude=row.id)
                row.name, row.name_key = name, key
            if body.colors is not None:
                row.colors = _colors(body.colors)
            for path in ("font_text", "font_numerals"):
                if path in fields:
                    setattr(row, path, fields[path])
            for path in TEXT_FIELDS:
                if fields.get(path) is not None:
                    setattr(row, path, fields[path].strip())
            s.flush()
            return to_out(row)
    except IntegrityError as e:
        raise AppError("brand_name_taken", "There is already a brand with that name.", 409) from e


def delete_brand(cat: CatalogueHandle, brand_id: str) -> None:
    """Reports that name it print with the Kestrel theme from then on (get_brand answers None)."""
    with cat.session() as s:
        row = _row(s, brand_id)
        if row.builtin:
            raise AppError(
                "brand_builtin", f"{row.name} is a built-in brand; it can be edited but not deleted.", 409
            )
        s.delete(row)


def confidentiality_line(brand: BrandRow, year: int, customer: str | None) -> str:
    """The footer line with `{year}` and `{customer}` filled in; no customer reads "the client"."""
    who = (customer or "").strip() or "the client"
    return brand.confidentiality.replace("{year}", str(year)).replace("{customer}", who)
