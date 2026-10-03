# Asset findings D2: report brands: catalogue 0004, brands API, bundled fonts, theme overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report can carry a brand. `catalogue.db` gains a `brand` table seeded with two read-only-for-delete built-ins (e& and White label), the app-level `/api/v1/brands` API lists, creates, edits and deletes brands and stores their three logos, the e& and White label fonts (Nunito Sans, Poppins, Inter; SIL OFL 1.1) ship with their licences, and `app.reports.theme.with_brand(theme, brand)` turns a brand into a print theme that R1 applies to the PDF. The theme fixture gains a `brand` overlay block, and a shared vector file pins the Python and TypeScript overlays to the same output.

**Architecture:**
- **Catalogue revision `0004`** (`backend/app/catalogue/migrations/versions/0004_brands.py`) creates `brand` and seeds the two built-ins from a **frozen copy** of `backend/app/brands/builtins.py`, exactly as 0002 and 0003 seed their built-ins. The ORM class `Brand` lives in `backend/app/catalogue/db.py` (the module the catalogue's Alembic env imports).
- **Package `backend/app/brands/`:**
  - `builtins.py` (the two built-ins as plain dicts, and the default colours of a new brand);
  - `fonts.py` (the bundled families, their files and sha256, and a lazy reportlab registration for R1);
  - `schemas.py` (pydantic);
  - `store.py` (rows, rules, logos; `get_brand`, `logo_path`, `confidentiality_line` for R1);
  - `router.py` (`/api/v1/brands`, app level, catalogue dependency: 503 without it).
- **Logos** are app-level files, not project report assets: a brand outlives any one project. `store.set_logo` reuses the report-asset checks and encoding (`app.reports.assets.prepare_logo`, a new public wrapper) and writes `<catalogue root>/brand-assets/logo-<sha16>.png`. The brand row holds the id `logo-<sha16>`.
- **Fonts** live in `backend/app/brands/fonts/`, cut and checked by `backend/scripts/fetch_brand_fonts.py` from the Google Fonts repository at the commit the report fonts already use, and bundled through one new `datas` line in `backend/kestrel_backend.spec`.
- **Theme overlay.** `THEME["brand"]` (and the fixture, and `PRINT_THEME`) says which theme colour takes which brand colour. `with_brand` in Python and `withBrand` in `frontend/src/reports/printTheme.ts` both read that block, and `contract/fixtures/report-brand-overlay.json` holds input and expected output vectors both implementations must meet.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic (catalogue history), pydantic v2, Pillow, fontTools (already in the venv; it cut the report fonts), reportlab (lazy import only), pytest; OpenAPI 3.1, Spectral, openapi-typescript; Vitest.

**Spec sections covered:** §5.8 (`brand`, built-ins, OFL licences, logos not committed, `ReportConfig.brand_id`, the fixture brand block and parity), §8 (`GET`, `POST`, `PATCH`, `DELETE /brands`), §10 "Brand" (the overlay R1 applies), §12 (parity test).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** C0 merged (the `/brands` operations, the `Brand` schemas, `ReportConfig.brand_id`, and the 501 stubs in `backend/app/brands/stubs.py`). Nothing else. U6 and R1 need this unit.

**Worktree:** `scripts\start-task.ps1 -Name af-d2`

**Budget:** No background job: every brand operation touches one row, and a logo import is one image of at most 20 MB, decoded draft-reduced and down-scaled to at most 1,200 px a side (the report-asset bounds, reused as they are). The list is capped at 200 rows. Nothing reads an image set.

**Execution DAG (inside the unit):**
- Independent: Task 1 (contract), Task 2 (fonts), Task 6 (theme overlay).
- Task 3 (migration) needs Task 2 (`FAMILIES` names are what the seed stores; the migration does not import them, but the seed test checks them).
- Task 4 (store and CRUD routes) needs Tasks 1 and 3.
- Task 5 (logos) needs Task 4.
- Task 7 (gate and frozen build) needs all.
- Critical path: Task 2, Task 3, Task 4, Task 5, Task 7. Run Tasks 1 and 6 alongside Tasks 2 and 3 when two subagents are free; they touch disjoint files.

---

### Task 1: Contract: align the brand schemas and add the three logo operations

C0 owns `contract/openapi.yaml` for this phase and wrote the four brand operations. The index names no logo operations, but the spec (§5.8) has three logos per brand that are not project assets, so the editor needs a way to put a logo on a brand and to show it. This task adds them in its own commit, per the index rule "a later unit that finds a contract gap adds to it in its own commit".

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Test: `backend/tests/test_brands_contract.py` (new)

**Interfaces:**
- Consumes (C0): `listBrands` GET `/api/v1/brands` → `BrandList`; `createBrand` POST `/api/v1/brands` `BrandCreate` → 201 `Brand`; `patchBrand` PATCH `/api/v1/brands/{brandId}` `BrandPatch` → `Brand`; `deleteBrand` DELETE `/api/v1/brands/{brandId}` → 204.
- Produces, over HTTP:

| Method | Path | operationId | Success | Refusals |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/brands/{brandId}/logos/{slot}` | `getBrandLogo` | 200 `image/png` | 404 |
| PUT | `/api/v1/brands/{brandId}/logos/{slot}` | `setBrandLogo` | 200 `Brand` | 404, 422 `asset_invalid`, 503 |
| DELETE | `/api/v1/brands/{brandId}/logos/{slot}` | `clearBrandLogo` | 200 `Brand` | 404, 503 |

- Schemas the rest of D2, U6 and R1 rely on: `Brand`, `BrandColors`, `BrandList`, `BrandCreate`, `BrandPatch`, `BrandLogoSlot` (`on_light | on_dark | flat`), `BrandLogoImport {path}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brands_contract.py`:

```python
"""The brand contract (spec 2026-10-02-asset-findings §5.8, §8; plan D2 Task 1): the shape U6 and R1
build against, and the three logo operations D2 adds."""

from pathlib import Path

import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"


def _doc() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def test_brand_schema_has_the_spec_columns():
    s = _doc()["components"]["schemas"]
    brand = s["Brand"]
    assert set(brand["required"]) == {
        "id",
        "name",
        "colors",
        "font_text",
        "font_numerals",
        "logo_on_light",
        "logo_on_dark",
        "logo_flat",
        "website",
        "owner",
        "confidentiality",
        "pdf_author",
        "builtin",
        "created_at",
        "updated_at",
    }
    assert set(s["BrandColors"]["required"]) == {"accent", "accent_dark", "navy", "ink", "pale", "line"}
    assert s["BrandLogoSlot"]["enum"] == ["on_light", "on_dark", "flat"]
    assert s["BrandLogoImport"]["required"] == ["path"]


def test_the_logo_operations_exist():
    path = _doc()["paths"]["/api/v1/brands/{brandId}/logos/{slot}"]
    assert path["get"]["operationId"] == "getBrandLogo"
    assert "image/png" in path["get"]["responses"]["200"]["content"]
    assert path["put"]["operationId"] == "setBrandLogo"
    assert path["delete"]["operationId"] == "clearBrandLogo"
    assert {"404", "422", "503"} <= set(path["put"]["responses"])


def test_the_brand_operations_declare_their_refusals():
    paths = _doc()["paths"]
    assert {"409", "422", "503"} <= set(paths["/api/v1/brands"]["post"]["responses"])
    one = paths["/api/v1/brands/{brandId}"]
    assert {"404", "409", "422", "503"} <= set(one["patch"]["responses"])
    assert {"404", "409", "503"} <= set(one["delete"]["responses"])
```

- [ ] **Step 2: Run it to see it fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brands_contract.py -q`
Expected: FAIL, `KeyError: '/api/v1/brands/{brandId}/logos/{slot}'` (and possibly `BrandLogoSlot`).

- [ ] **Step 3: Align the brand schemas with this shape**

Open `contract/openapi.yaml`, search `Brand:` under `components/schemas`. C0's schemas must read as below. Edit any field that differs (C0 is the owner of the names; these are the names in the index and spec §5.8, so a difference is a C0 slip, not a design change). Add `BrandLogoSlot` and `BrandLogoImport` next to them.

```yaml
    BrandColors:
      type: object
      additionalProperties: false
      required: [accent, accent_dark, navy, ink, pale, line]
      description: Hex colours (`#RRGGBB`). Stored upper case.
      properties:
        accent: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        accent_dark: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        navy: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        ink: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        pale: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
        line: { type: string, pattern: "^#[0-9A-Fa-f]{6}$" }
    Brand:
      type: object
      required: [id, name, colors, font_text, font_numerals, logo_on_light, logo_on_dark, logo_flat, website, owner, confidentiality, pdf_author, builtin, created_at, updated_at]
      properties:
        id: { type: string }
        name: { type: string }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text:
          type: [string, "null"]
          description: A bundled font family (`Nunito Sans`, `Poppins`, `Inter`); null prints in the report theme's font.
        font_numerals:
          type: [string, "null"]
          description: The family for numbers and headings; null falls back to `font_text`.
        logo_on_light: { type: [string, "null"], description: "A brand logo id (`logo-<16 hex>`); read it with getBrandLogo." }
        logo_on_dark: { type: [string, "null"] }
        logo_flat: { type: [string, "null"] }
        website: { type: string }
        owner: { type: string }
        confidentiality:
          type: string
          description: The footer line. `{year}` and `{customer}` are filled in when the report renders.
        pdf_author: { type: string }
        builtin: { type: boolean, description: Seeded by the app; editable, never deleted. }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
    BrandList:
      type: object
      required: [items]
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Brand" } }
    BrandCreate:
      type: object
      additionalProperties: false
      required: [name]
      properties:
        name: { type: string, minLength: 1, maxLength: 80 }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text: { type: [string, "null"], maxLength: 80 }
        font_numerals: { type: [string, "null"], maxLength: 80 }
        website: { type: string, maxLength: 200 }
        owner: { type: string, maxLength: 120 }
        confidentiality: { type: string, maxLength: 1000 }
        pdf_author: { type: string, maxLength: 120 }
    BrandPatch:
      type: object
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 80 }
        colors: { $ref: "#/components/schemas/BrandColors" }
        font_text: { type: [string, "null"], maxLength: 80 }
        font_numerals: { type: [string, "null"], maxLength: 80 }
        website: { type: string, maxLength: 200 }
        owner: { type: string, maxLength: 120 }
        confidentiality: { type: string, maxLength: 1000 }
        pdf_author: { type: string, maxLength: 120 }
    BrandLogoSlot:
      type: string
      enum: [on_light, on_dark, flat]
      description: "`on_light` for white bars, `on_dark` for the cover band, `flat` (no alpha) for the PDF running header."
    BrandLogoImport:
      type: object
      additionalProperties: false
      required: [path]
      properties:
        path: { type: string, minLength: 1, maxLength: 1024, description: An absolute path to a PNG, JPEG or WebP of at most 20 MB. }
```

- [ ] **Step 4: Make the brand operations declare their refusals**

In the `/api/v1/brands` and `/api/v1/brands/{brandId}` path items C0 wrote, make the responses include exactly these (add what is missing; keep C0's success responses):

```yaml
    # on post createBrand
        "409":
          description: "the name is taken after normalising (`code` is `brand_name_taken`, details `{brand_id}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: "the name normalises to nothing (`invalid_brand`, details `{errors: [{path, message}]}`) or a font is not bundled (`unknown_font`, details `{path, fonts}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
    # on patch patchBrand: the same 409 and 422 as createBrand, plus
        "404": { $ref: "#/components/responses/NotFound" }
    # on delete deleteBrand
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: "a built-in brand is never deleted (`code` is `brand_builtin`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
    # on get listBrands
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
```

- [ ] **Step 5: Add the logo path**

Under `components/parameters`, next to C0's `brandId` (add `brandId` too if C0 declared the path parameter inline):

```yaml
    brandId:
      name: brandId
      in: path
      required: true
      schema: { type: string }
    brandLogoSlot:
      name: slot
      in: path
      required: true
      schema: { $ref: "#/components/schemas/BrandLogoSlot" }
```

Directly after the `/api/v1/brands/{brandId}` path item:

```yaml
  /api/v1/brands/{brandId}/logos/{slot}:
    parameters:
      - $ref: "#/components/parameters/brandId"
      - $ref: "#/components/parameters/brandLogoSlot"
    get:
      tags: [brands]
      operationId: getBrandLogo
      summary: "The brand's logo for this slot as a PNG. Callers add `?v=<logo id>`, so the answer is cached as immutable."
      responses:
        "200":
          description: the logo
          content:
            image/png:
              schema: { type: string, format: binary }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
    put:
      tags: [brands]
      operationId: setBrandLogo
      summary: "Import a local PNG, JPEG or WebP (at most 20 MB) as this slot's logo. A copy, at most 1200 px a side, is kept in the app data folder, never in a project."
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BrandLogoImport" }
      responses:
        "200":
          description: the brand with the new logo id
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422":
          description: "the file is missing, too large or not an image (`code` is `asset_invalid`, details `{reason}`)"
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
    delete:
      tags: [brands]
      operationId: clearBrandLogo
      summary: Remove this slot's logo from the brand. The file stays (another brand may use it).
      responses:
        "200":
          description: the brand without that logo
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Brand" }
        "404": { $ref: "#/components/responses/NotFound" }
        "503": { $ref: "#/components/responses/CatalogueUnavailable" }
        default: { $ref: "#/components/responses/Error" }
```

If C0 has no `brands` tag in the top-level `tags` list, use the tag C0 used on `listBrands`.

- [ ] **Step 6: Regenerate and lint**

Run: `pnpm -C contract generate` then `pnpm -C contract lint`
Expected: `schema.d.ts` changes; lint reports no errors (an unused-component error means a schema above is not referenced: `BrandLogoSlot` is referenced by the parameter, `BrandLogoImport` by the PUT).

- [ ] **Step 7: Route the three operations as 501 stubs for now**

The contract test needs every operation routed. Add to C0's `backend/app/brands/stubs.py` `STUBS` list (C0 wrote it with `add_stubs(router, STUBS, project_scoped=False)`):

```python
    ("GET", "/brands/{brandId}/logos/{slot}", "getBrandLogo"),
    ("PUT", "/brands/{brandId}/logos/{slot}", "setBrandLogo"),
    ("DELETE", "/brands/{brandId}/logos/{slot}", "clearBrandLogo"),
```

Run: `git grep -n "brands" backend/tests/test_contract.py` and confirm the `EXPECTED_STUBS` line C0 added derives its names from `STUBS` (a set comprehension over `app.brands.stubs.STUBS`). If C0 listed the four names literally instead, add the three new names to that literal set.

- [ ] **Step 8: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brands_contract.py tests/test_contract.py -q -k "brand or stub or routed"`
Expected: PASS.

Run: `pnpm -C contract check`
Expected: PASS (lint clean, `schema.d.ts` committed state equals the generated one once staged).

- [ ] **Step 9: Commit**

```
git add contract/openapi.yaml contract/client/schema.d.ts backend/app/brands/stubs.py backend/tests/test_brands_contract.py backend/tests/test_contract.py
git commit -m "contract: brand logo operations and brand refusals (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Stage `backend/tests/test_contract.py` only if Step 7 changed it.)

---

### Task 2: Bundle the brand fonts with their OFL licences

**Files:**
- Create: `backend/scripts/fetch_brand_fonts.py`
- Create (generated by the script, committed): `backend/app/brands/fonts/NunitoSans-Regular.ttf`, `NunitoSans-Bold.ttf`, `Poppins-SemiBold.ttf`, `Poppins-Bold.ttf`, `Inter-Regular.ttf`, `Inter-Bold.ttf`, `OFL-NunitoSans.txt`, `OFL-Poppins.txt`, `OFL-Inter.txt`
- Create: `backend/app/brands/fonts.py`
- Modify: `backend/kestrel_backend.spec` (one `datas` line)
- Test: `backend/tests/test_brand_fonts.py` (new)

**Interfaces:**
- Produces:
  - `app.brands.fonts.FONT_DIR: Path`
  - `app.brands.fonts.FAMILIES: dict[str, BrandFontFiles]` with keys `"Nunito Sans"`, `"Poppins"`, `"Inter"`
  - `BrandFontFiles(regular: str, bold: str, licence: str)` (frozen dataclass, file names in `FONT_DIR`)
  - `app.brands.fonts.FONT_SHA256: dict[str, str]`
  - `app.brands.fonts.font_files(family: str | None, font_dir: Path | None = None) -> tuple[Path, Path] | None` (regular, bold; None for an unknown family, for `None`, or when a file is missing)
  - `app.brands.fonts.register_family(family: str | None, font_dir: Path | None = None) -> tuple[str, str] | None` (the reportlab face names `("Brand-<Family>", "Brand-<Family>-Bold")`; None on any failure, logged; cached; imports reportlab lazily) for R1
  - `app.brands.fonts.verify_fonts(font_dir: Path | None = None) -> int`

The hashes below were produced on 2026-10-03 with this venv's fontTools from google/fonts commit `00a38a53f92aef923b9353f40128e8f4552ddae4`, the commit `fetch_report_fonts.py` pins. Variable fonts are instanced with every axis pinned to its default except `wght` (reportlab cannot read a variable font). Poppins ships static weights and is copied as it is: 600 (SemiBold) and 700 (Bold), the two weights the kit's `brand.yaml` names for numerals.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brand_fonts.py`:

```python
"""Brand fonts (spec 2026-10-02-asset-findings §5.8: Nunito Sans, Poppins and Inter, SIL OFL 1.1,
licence files shipped; plan D2 Task 2)."""

import hashlib
import logging
from pathlib import Path

from app.brands import fonts

SPEC_FILE = Path(__file__).resolve().parents[1] / "kestrel_backend.spec"


def test_committed_brand_fonts_match_their_recorded_sha256():
    for name, sha in fonts.FONT_SHA256.items():
        assert hashlib.sha256((fonts.FONT_DIR / name).read_bytes()).hexdigest() == sha, name
    assert fonts.verify_fonts() == 6


def test_every_family_ships_its_ofl_licence():
    assert set(fonts.FAMILIES) == {"Nunito Sans", "Poppins", "Inter"}
    for family in fonts.FAMILIES.values():
        text = (fonts.FONT_DIR / family.licence).read_text("utf-8")
        assert "SIL Open Font License" in text
        assert family.regular in fonts.FONT_SHA256 and family.bold in fonts.FONT_SHA256


def test_font_files_resolves_a_family_and_refuses_the_rest(tmp_path):
    regular, bold = fonts.font_files("Poppins")
    assert (regular.name, bold.name) == ("Poppins-SemiBold.ttf", "Poppins-Bold.ttf")
    assert fonts.font_files(None) is None
    assert fonts.font_files("Space Grotesk") is None  # the theme's own font, not a brand font
    assert fonts.font_files("Comic Sans") is None
    assert fonts.font_files("Inter", font_dir=tmp_path) is None  # files missing


def test_register_family_embeds_regular_and_bold():
    from reportlab.pdfbase import pdfmetrics

    fonts._registered.clear()
    names = fonts.register_family("Nunito Sans")
    assert names == ("Brand-NunitoSans", "Brand-NunitoSans-Bold")
    for name in names:
        assert pdfmetrics.getFont(name).fontName == name
    assert fonts.register_family("Nunito Sans") is names  # cached


def test_register_family_returns_none_for_a_theme_font_or_a_broken_file(tmp_path, caplog):
    assert fonts.register_family(None) is None
    assert fonts.register_family("Space Grotesk") is None
    family = fonts.FAMILIES["Inter"]
    (tmp_path / family.regular).write_bytes(b"not a font")
    (tmp_path / family.bold).write_bytes(b"not a font")
    with caplog.at_level(logging.WARNING, logger="app.brands.fonts"):
        assert fonts.register_family("Inter", font_dir=tmp_path) is None
    assert "Inter" in caplog.text


def test_the_frozen_bundle_carries_the_brand_fonts():
    text = SPEC_FILE.read_text("utf-8")
    assert '(str(Path(SPECPATH) / "app" / "brands" / "fonts"), "app/brands/fonts")' in text
```

- [ ] **Step 2: Run it to see it fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brand_fonts.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.brands.fonts'` (C0 created the `app.brands` package with `__init__.py`; if it did not, the error names `app.brands`, and Step 3 creates `backend/app/brands/__init__.py` with the docstring `"""Report brands (spec 2026-10-02-asset-findings §5.8)."""`).

- [ ] **Step 3: Write `app/brands/fonts.py`**

```python
"""Brand fonts (spec 2026-10-02-asset-findings §5.8): Nunito Sans, Poppins and Inter, SIL OFL 1.1,
cut from the Google Fonts repository by scripts/fetch_brand_fonts.py and committed with their
licences, like the report fonts (app/reports/pdf/fonts.py).

A brand stores a family name (`Brand.font_text`, `Brand.font_numerals`). R1 calls `register_family`
when it prints with a brand; a missing or corrupt file costs that brand its typography (the theme
font prints instead), never the report. No reportlab import at module scope: the brands router
imports this module.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent / "fonts"


@dataclass(frozen=True)
class BrandFontFiles:
    regular: str
    bold: str
    licence: str


FAMILIES: dict[str, BrandFontFiles] = {
    "Nunito Sans": BrandFontFiles("NunitoSans-Regular.ttf", "NunitoSans-Bold.ttf", "OFL-NunitoSans.txt"),
    # The kit's numerals weights are 600 and 700: SemiBold is this family's "regular".
    "Poppins": BrandFontFiles("Poppins-SemiBold.ttf", "Poppins-Bold.ttf", "OFL-Poppins.txt"),
    "Inter": BrandFontFiles("Inter-Regular.ttf", "Inter-Bold.ttf", "OFL-Inter.txt"),
}
FONT_SHA256: dict[str, str] = {
    "NunitoSans-Regular.ttf": "6dcfd135eb447ccfc6ec0367d7a6a72a7214903c47b7fdd6c06fada407b88ee7",
    "NunitoSans-Bold.ttf": "5ee407544cd6e9da1480f83fd94ee28f1626d3ae0c1ac6e11ca72a7e0f78756a",
    "Poppins-SemiBold.ttf": "d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286",
    "Poppins-Bold.ttf": "983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c",
    "Inter-Regular.ttf": "0b59f6b6fc9e8a9ad8032802d1797c4237d9288a3e7b7661517070627b577060",
    "Inter-Bold.ttf": "202f240469f916722233188ec316107f6cecaf13b801e9b3939b82b9f7a816d6",
}
_registered: dict[tuple[Path, str], tuple[str, str] | None] = {}


def font_files(family: str | None, font_dir: Path | None = None) -> tuple[Path, Path] | None:
    """The regular and bold TTF of a bundled family, or None (no family, not bundled, file missing)."""
    files = FAMILIES.get(family or "")
    if files is None:
        return None
    folder = Path(font_dir or FONT_DIR)
    regular, bold = folder / files.regular, folder / files.bold
    return (regular, bold) if regular.is_file() and bold.is_file() else None


def _face(family: str) -> str:
    return "Brand-" + family.replace(" ", "")


def register_family(family: str | None, font_dir: Path | None = None) -> tuple[str, str] | None:
    """Register a bundled family with reportlab once; its (regular, bold) face names, or None."""
    if family not in FAMILIES:
        return None
    folder = Path(font_dir or FONT_DIR).resolve()
    key = (folder, family)
    if key in _registered:
        return _registered[key]
    result: tuple[str, str] | None = None
    paths = font_files(family, folder)
    if paths is None:
        log.warning("brand font %s is missing from %s; printing in the theme font", family, folder)
    else:
        try:
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont

            regular, bold = _face(family), _face(family) + "-Bold"
            pdfmetrics.registerFont(TTFont(regular, str(paths[0])))
            pdfmetrics.registerFont(TTFont(bold, str(paths[1])))
            pdfmetrics.registerFontFamily(regular, normal=regular, bold=bold, italic=regular, boldItalic=bold)
            result = (regular, bold)
        except Exception as exc:  # a corrupt file costs the brand typography, never the report
            log.warning("brand font %s could not be registered from %s (%s)", family, folder, exc)
    _registered[key] = result
    return result


def verify_fonts(font_dir: Path | None = None) -> int:
    """How many of the committed TTFs are present with their recorded sha256."""
    folder = Path(font_dir or FONT_DIR)
    ok = 0
    for name, sha in FONT_SHA256.items():
        try:
            ok += hashlib.sha256((folder / name).read_bytes()).hexdigest() == sha
        except OSError:
            continue
    return ok
```

- [ ] **Step 4: Write the fetch script**

Create `backend/scripts/fetch_brand_fonts.py`:

```python
"""Fetch the brand fonts once (spec 2026-10-02-asset-findings §5.8; plan D2 Task 2).

Downloads Nunito Sans and Inter (variable TTFs) and Poppins SemiBold and Bold (static TTFs), all SIL
OFL 1.1, from the Google Fonts repository at the commit fetch_report_fonts.py pins, checks their
sha256, cuts static Regular and Bold instances of the variable fonts with fontTools (every other axis
at its default; reportlab cannot pick a variable-font weight) and writes them, with the OFL texts, to
app/brands/fonts/. The outputs are committed; run this only to reproduce or update them:

    <backend>\\.venv\\Scripts\\python.exe scripts\\fetch_brand_fonts.py
"""

from __future__ import annotations

import hashlib
import sys
import tempfile
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.varLib import instancer  # noqa: E402

from app.brands.fonts import FONT_DIR, FONT_SHA256  # noqa: E402

COMMIT = "00a38a53f92aef923b9353f40128e8f4552ddae4"
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
SOURCES = {
    "NunitoSans[YTLC,opsz,wdth,wght].ttf": (
        "nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf",
        "f934d7142fb4784bf828da485b7dcbd90c0c80d514e9d49a5da0ed3a1ae2491d",
    ),
    "Inter[opsz,wght].ttf": (
        "inter/Inter%5Bopsz%2Cwght%5D.ttf",
        "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
    ),
    "Poppins-SemiBold.ttf": (
        "poppins/Poppins-SemiBold.ttf",
        "d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286",
    ),
    "Poppins-Bold.ttf": (
        "poppins/Poppins-Bold.ttf",
        "983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c",
    ),
    "OFL-NunitoSans.txt": (
        "nunitosans/OFL.txt",
        "efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b",
    ),
    "OFL-Poppins.txt": (
        "poppins/OFL.txt",
        "6be04893d770899a015649c7aa3b582f871b272f8747a92b78b17c3e5c8b2573",
    ),
    "OFL-Inter.txt": (
        "inter/OFL.txt",
        "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
    ),
}
COPIED = ("Poppins-SemiBold.ttf", "Poppins-Bold.ttf", "OFL-NunitoSans.txt", "OFL-Poppins.txt", "OFL-Inter.txt")
INSTANCES = [
    ("NunitoSans[YTLC,opsz,wdth,wght].ttf", "NunitoSans-Regular.ttf", 400),
    ("NunitoSans[YTLC,opsz,wdth,wght].ttf", "NunitoSans-Bold.ttf", 700),
    ("Inter[opsz,wght].ttf", "Inter-Regular.ttf", 400),
    ("Inter[opsz,wght].ttf", "Inter-Bold.ttf", 700),
]


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kestrel-brand-fonts-") as tmp:
        work = Path(tmp)
        for name, (rel, sha) in SOURCES.items():
            dest = work / name
            urllib.request.urlretrieve(f"{BASE}/{rel}", dest)
            if _sha(dest) != sha:
                print(f"{name}: sha256 {_sha(dest)} != {sha}", file=sys.stderr)
                return 1
            if name in COPIED:
                (FONT_DIR / name).write_bytes(dest.read_bytes())
        for src, out, weight in INSTANCES:
            font = TTFont(work / src, recalcTimestamp=False)
            limits = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
            limits["wght"] = weight
            inst = instancer.instantiateVariableFont(font, limits, updateFontNames=True)
            inst.save(FONT_DIR / out)
        for name, sha in FONT_SHA256.items():
            got = _sha(FONT_DIR / name)
            if got != sha:
                print(f"{name}: sha256 {got} != recorded {sha}", file=sys.stderr)
                return 1
            print(f"{name} {got}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run the script to produce the files**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe scripts\fetch_brand_fonts.py`
Expected: six lines `<file> <sha256>` matching `FONT_SHA256`, exit code 0, and nine files in `backend/app/brands/fonts/`. A sha mismatch on an output (exit 1) means this venv's fontTools differs from the one that recorded the hashes: stop and report the printed hashes; do not edit `FONT_SHA256` to match without a ruling.

- [ ] **Step 6: Bundle the folder in the frozen build**

In `backend/kestrel_backend.spec`, directly after the report-fonts line (`+ [(str(Path(SPECPATH) / "app" / "reports" / "fonts"), "app/reports/fonts")]`), add:

```python
    # Brand fonts (spec 2026-10-02-asset-findings §5.8): Nunito Sans, Poppins, Inter TTFs and their OFL
    # texts, read from disk by app/brands/fonts.py (Path(__file__)-relative, like the report fonts).
    + [(str(Path(SPECPATH) / "app" / "brands" / "fonts"), "app/brands/fonts")]
```

- [ ] **Step 7: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brand_fonts.py tests/test_packaging_spec.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```
git add backend/app/brands/fonts.py backend/scripts/fetch_brand_fonts.py backend/app/brands/fonts/NunitoSans-Regular.ttf backend/app/brands/fonts/NunitoSans-Bold.ttf backend/app/brands/fonts/Poppins-SemiBold.ttf backend/app/brands/fonts/Poppins-Bold.ttf backend/app/brands/fonts/Inter-Regular.ttf backend/app/brands/fonts/Inter-Bold.ttf backend/app/brands/fonts/OFL-NunitoSans.txt backend/app/brands/fonts/OFL-Poppins.txt backend/app/brands/fonts/OFL-Inter.txt backend/kestrel_backend.spec backend/tests/test_brand_fonts.py
git commit -m "brands: bundle Nunito Sans, Poppins and Inter with their OFL licences (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Catalogue migration 0004 and the built-in brands

**Files:**
- Create: `backend/app/brands/builtins.py`
- Create: `backend/app/catalogue/migrations/versions/0004_brands.py`
- Modify: `backend/app/catalogue/db.py` (class `Brand`; module docstring)
- Modify: `backend/tests/test_catalogue_migration_0003.py` (line 344: the head is no longer 0003)
- Test: `backend/tests/test_catalogue_migration_0004.py` (new)

**Interfaces:**
- Produces:
  - ORM `app.catalogue.db.Brand` (table `brand`): `id: str(64) PK`, `name: str(80)`, `name_key: str(80)` unique, `colors: dict` (JSON), `font_text`, `font_numerals: str(80) | None`, `logo_on_light`, `logo_on_dark`, `logo_flat: str(64) | None`, `website: str(200)`, `owner: str(120)`, `confidentiality: text`, `pdf_author: str(120)`, `builtin: bool`, `created_at`, `updated_at`.
  - `app.brands.builtins`: `BUILTIN_EAND = "builtin-eand"`, `BUILTIN_WHITE_LABEL = "builtin-white-label"`, `BUILTIN_IDS`, `SEEDED_AT = datetime(2026, 10, 3)`, `DEFAULT_COLORS: dict[str, str]` (White label), `BUILTIN_BRANDS: list[dict]`.

`name_key` is not in spec §5.8's column list. It is here for the same reason `catalogue_type.name_key` and `project_template.name_key` exist: a unique index needs a stored key, so "E&" and "e&" collide in the database, not only in Python.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_catalogue_migration_0004.py`:

```python
"""Catalogue revision 0004 (spec 2026-10-02-asset-findings §5.8; plan D2 Task 3): `brand`, seeded with
the e& and White label built-ins from a frozen copy of app/brands/builtins.py. An existing 0003
catalogue upgrades with its types and templates intact, and 0004 downgrades."""

import importlib.util
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.brands import fonts
from app.brands.builtins import BUILTIN_BRANDS, BUILTIN_EAND, BUILTIN_IDS, SEEDED_AT
from app.catalogue.db import Brand, CatalogueBase, ProjectTemplate
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.names import normalise_name
from app.catalogue.paths import catalogue_root

PATH = MIGRATIONS / "versions" / "0004_brands.py"
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}
T0 = "2026-09-01 00:00:00.000000"


def _module():
    spec = importlib.util.spec_from_file_location("cat_0004", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _cfg(url: str) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def _run(data_dir: Path, fn) -> None:
    root = catalogue_root(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{(root / 'catalogue.db').as_posix()}"
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            cfg = _cfg(url)
            cfg.attributes["connection"] = conn
            fn(cfg, conn)
    finally:
        engine.dispose()


def _at_0003_with_a_type(data_dir: Path) -> None:
    def go(cfg, conn):
        command.upgrade(cfg, "0003")
        conn.exec_driver_sql(
            "INSERT INTO catalogue_type (id, name, name_key, colour, kind, default_severity, hotkey,"
            ' "group", archived, origin, created_at, updated_at, severity_rules)'
            " VALUES ('t1', 'Crack', 'crack', '#ff0000', 'defect', 2, 'c', NULL, 0, 'user', ?, ?, '[]')",
            (T0, T0),
        )

    _run(data_dir, go)


def _types(data_dir: Path) -> list[tuple]:
    con = sqlite3.connect(catalogue_root(data_dir) / "catalogue.db")
    try:
        return con.execute("SELECT id, name, hotkey FROM catalogue_type ORDER BY id").fetchall()
    finally:
        con.close()


def test_0004_is_on_the_single_catalogue_head():
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert "0004" in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert script.get_revision("0004").down_revision == "0003"


def test_a_0003_catalogue_upgrades_keeps_its_rows_and_gains_the_brands(tmp_path):
    data = tmp_path / "appdata"
    _at_0003_with_a_type(data)
    before = _types(data)
    cat = open_catalogue(data)
    try:
        with cat.session() as s:
            assert sorted(s.execute(select(Brand.id)).scalars()) == sorted(BUILTIN_IDS)
            assert s.execute(select(func.count()).select_from(ProjectTemplate)).scalar_one() == 3
    finally:
        cat.engine.dispose()
    assert _types(data) == before


def test_the_seeded_rows_are_the_code_built_ins(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.session() as s:
            for brand in BUILTIN_BRANDS:
                row = s.get(Brand, brand["id"])
                got = {k: getattr(row, k) for k in brand}
                assert got == brand
                assert row.builtin is True
                assert row.name_key == normalise_name(row.name)
                assert (row.logo_on_light, row.logo_on_dark, row.logo_flat) == (None, None, None)
                assert row.created_at.replace(tzinfo=None) == row.updated_at.replace(tzinfo=None) == SEEDED_AT
    finally:
        cat.engine.dispose()


def test_the_e_and_brand_carries_the_kit_values():
    """Kit brands/eand/brand.yaml: colours, Nunito Sans text, Poppins numerals; no logo (A10)."""
    eand = next(b for b in BUILTIN_BRANDS if b["id"] == BUILTIN_EAND)
    assert eand["name"] == "e&"
    assert eand["colors"] == {
        "accent": "#BC0000",
        "accent_dark": "#9E0000",
        "navy": "#141D2D",
        "ink": "#1A1A1A",
        "pale": "#FFE5E5",
        "line": "#E7E4DE",
    }
    assert (eand["font_text"], eand["font_numerals"]) == ("Nunito Sans", "Poppins")
    assert (eand["website"], eand["owner"], eand["pdf_author"]) == ("www.eand.com", "e&", "e& Drones, Robotics & AI")
    assert eand["confidentiality"].startswith("© {year} e&. All rights reserved.")
    assert "logo_on_light" not in eand


def test_every_built_in_names_bundled_fonts_and_has_no_dashes():
    for brand in BUILTIN_BRANDS:
        assert brand["font_text"] in fonts.FAMILIES and brand["font_numerals"] in fonts.FAMILIES
        text = " ".join(str(v) for v in brand.values())
        assert "\u2014" not in text and "\u2013" not in text


def test_the_built_ins_are_seeded_once(tmp_path):
    data = tmp_path / "appdata"
    first = open_catalogue(data)
    with first.session() as s:
        s.get(Brand, BUILTIN_EAND).website = "www.example.com"
    first.engine.dispose()
    again = open_catalogue(data)
    try:
        with again.session() as s:
            assert s.execute(select(func.count()).select_from(Brand)).scalar_one() == 2
            assert s.get(Brand, BUILTIN_EAND).website == "www.example.com"
    finally:
        again.engine.dispose()


def test_brand_names_are_unique_by_name_key(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(Brand(name="E&", name_key="e&", colors={}))
            s.flush()
    finally:
        cat.engine.dispose()


def test_the_migration_carries_a_frozen_copy():
    """A later edit of builtins.py must not rewrite 0004's history, and the two must agree today."""
    text = PATH.read_text(encoding="utf-8")
    assert "from app" not in text and "import app" not in text
    module = _module()
    frozen = [{k: v for k, v in row.items() if k != "name_key"} for row in module.BUILTIN_ROWS]
    assert frozen == BUILTIN_BRANDS
    assert [row["name_key"] for row in module.BUILTIN_ROWS] == [normalise_name(b["name"]) for b in BUILTIN_BRANDS]
    assert module.SEEDED_AT == SEEDED_AT


def test_the_orm_and_the_migration_describe_the_same_table(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.engine.connect() as conn:
            diffs = compare_metadata(MigrationContext.configure(conn), CatalogueBase.metadata)
    finally:
        cat.engine.dispose()

    def table(d):
        kind = d[0]
        if kind in ("add_table", "remove_table"):
            return d[1].name
        if kind in ("add_column", "remove_column"):
            return d[2]
        return d[1].table.name if kind in ("add_index", "remove_index") else ""

    structural = [d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and table(d) == "brand"]
    assert structural == []


def test_0004_downgrades_to_0003_and_keeps_every_type(tmp_path):
    data = tmp_path / "appdata"
    _at_0003_with_a_type(data)
    before = _types(data)
    open_catalogue(data).engine.dispose()

    def go(cfg, conn):
        command.downgrade(cfg, "0003")
        assert "brand" not in inspect(conn).get_table_names()
        assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0003"

    _run(data, go)
    assert _types(data) == before
```

- [ ] **Step 2: Run it to see it fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_catalogue_migration_0004.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.brands.builtins'`.

- [ ] **Step 3: Write `app/brands/builtins.py`**

```python
"""The two built-in report brands (spec 2026-10-02-asset-findings §5.8).

Seeded once into `catalogue.db` by catalogue migration 0004, which carries a frozen copy of this list
(tests/test_catalogue_migration_0004.py pins that the two agree). An edit here after 0004 has shipped
changes nothing in an existing catalogue: it needs a new catalogue migration that updates the rows.

e& takes its colours, fonts and text from the asset-inspection kit's brands/eand/brand.yaml (DRA
tokens v1.0). Its logos are customer-supplied and never committed (spec A10): the operator imports
them once in the brand editor. White label takes the kit's brands/whitelabel/brand.yaml colours and
Inter. Plain dicts, not pydantic models, so the migration's copy compares as JSON.
"""

from datetime import datetime

BUILTIN_EAND = "builtin-eand"
BUILTIN_WHITE_LABEL = "builtin-white-label"
BUILTIN_IDS = (BUILTIN_EAND, BUILTIN_WHITE_LABEL)
SEEDED_AT = datetime(2026, 10, 3)  # naive UTC, as UTCDateTime stores it

# A new brand starts from White label's colours (kit brands/whitelabel/brand.yaml).
DEFAULT_COLORS: dict[str, str] = {
    "accent": "#1F4FD1",
    "accent_dark": "#173DA6",
    "navy": "#131A26",
    "ink": "#141821",
    "pale": "#E8EEFF",
    "line": "#E3E6EC",
}

BUILTIN_BRANDS: list[dict] = [
    {
        "id": BUILTIN_EAND,
        "name": "e&",
        "colors": {
            "accent": "#BC0000",
            "accent_dark": "#9E0000",
            "navy": "#141D2D",
            "ink": "#1A1A1A",
            "pale": "#FFE5E5",
            "line": "#E7E4DE",
        },
        "font_text": "Nunito Sans",
        "font_numerals": "Poppins",
        "website": "www.eand.com",
        "owner": "e&",
        "confidentiality": "© {year} e&. All rights reserved. This report contains information owned by e&"
        " and is intended only for the recipient and approved partners. Any copying, sharing, or"
        " disclosure without written consent is not allowed.",
        "pdf_author": "e& Drones, Robotics & AI",
    },
    {
        "id": BUILTIN_WHITE_LABEL,
        "name": "White label",
        "colors": dict(DEFAULT_COLORS),
        "font_text": "Inter",
        "font_numerals": "Inter",
        "website": "",
        "owner": "",
        "confidentiality": "Confidential. Prepared for {customer}. Do not distribute without written consent.",
        "pdf_author": "",
    },
]
```

- [ ] **Step 4: Add the ORM class**

In `backend/app/catalogue/db.py`, extend the module docstring's first sentence to end "... report templates (revision 0002), project templates (revision 0003) and report brands (revision 0004)." and append:

```python
class Brand(CatalogueBase):
    """A report brand (spec 2026-10-02-asset-findings §5.8, catalogue revision 0004): colours, fonts,
    three logos and the footer text a report prints with when `ReportConfig.brand_id` names it.

    The two built-ins (`builtin=True`, fixed ids from app/brands/builtins.py) are seeded by the
    migration; they can be edited (the operator adds e&'s logos here) but never deleted. `colors` is
    `{accent, accent_dark, navy, ink, pale, line}`, upper-case hex. `font_text` and `font_numerals` are
    bundled family names (app/brands/fonts.py). A logo column holds a brand logo id (`logo-<16 hex>`,
    a PNG under `<catalogue root>/brand-assets/`). `name_key` is `normalise_name(name)`, unique."""

    __tablename__ = "brand"
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(80))
    name_key: Mapped[str] = mapped_column(String(80))
    colors: Mapped[dict] = mapped_column(JSON)
    font_text: Mapped[str | None] = mapped_column(String(80), nullable=True)
    font_numerals: Mapped[str | None] = mapped_column(String(80), nullable=True)
    logo_on_light: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logo_on_dark: Mapped[str | None] = mapped_column(String(64), nullable=True)
    logo_flat: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str] = mapped_column(String(200), default="", server_default="")
    owner: Mapped[str] = mapped_column(String(120), default="", server_default="")
    confidentiality: Mapped[str] = mapped_column(Text, default="", server_default="")
    pdf_author: Mapped[str] = mapped_column(String(120), default="", server_default="")
    builtin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ux_brand_name_key", "name_key", unique=True),)
```

(All names it uses are already imported at the top of `db.py`.)

- [ ] **Step 5: Write the migration**

Create `backend/app/catalogue/migrations/versions/0004_brands.py`:

```python
"""catalogue: brand, seeded with the e& and White label report brands

Spec 2026-10-02-asset-findings section 5.8 (plan 2026-10-03-asset-findings-d2). The seed is a frozen
copy of app/brands/builtins.py on 2026-10-03, never imported, so a later edit there cannot rewrite
this revision; tests/test_catalogue_migration_0004.py pins that the two agree. Logos are never seeded:
e&'s are customer-supplied and the operator imports them in the brand editor.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-03
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SEEDED_AT = datetime(2026, 10, 3)  # naive UTC, as UTCDateTime stores it

BUILTIN_ROWS = [
    {
        "id": "builtin-eand",
        "name": "e&",
        "name_key": "e&",
        "colors": {
            "accent": "#BC0000",
            "accent_dark": "#9E0000",
            "navy": "#141D2D",
            "ink": "#1A1A1A",
            "pale": "#FFE5E5",
            "line": "#E7E4DE",
        },
        "font_text": "Nunito Sans",
        "font_numerals": "Poppins",
        "website": "www.eand.com",
        "owner": "e&",
        "confidentiality": "© {year} e&. All rights reserved. This report contains information owned by e&"
        " and is intended only for the recipient and approved partners. Any copying, sharing, or"
        " disclosure without written consent is not allowed.",
        "pdf_author": "e& Drones, Robotics & AI",
    },
    {
        "id": "builtin-white-label",
        "name": "White label",
        "name_key": "white label",
        "colors": {
            "accent": "#1F4FD1",
            "accent_dark": "#173DA6",
            "navy": "#131A26",
            "ink": "#141821",
            "pale": "#E8EEFF",
            "line": "#E3E6EC",
        },
        "font_text": "Inter",
        "font_numerals": "Inter",
        "website": "",
        "owner": "",
        "confidentiality": "Confidential. Prepared for {customer}. Do not distribute without written consent.",
        "pdf_author": "",
    },
]


def upgrade() -> None:
    table = op.create_table(
        "brand",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("name_key", sa.String(80), nullable=False),
        sa.Column("colors", sa.JSON(), nullable=False),
        sa.Column("font_text", sa.String(80), nullable=True),
        sa.Column("font_numerals", sa.String(80), nullable=True),
        sa.Column("logo_on_light", sa.String(64), nullable=True),
        sa.Column("logo_on_dark", sa.String(64), nullable=True),
        sa.Column("logo_flat", sa.String(64), nullable=True),
        sa.Column("website", sa.String(200), nullable=False, server_default=""),
        sa.Column("owner", sa.String(120), nullable=False, server_default=""),
        sa.Column("confidentiality", sa.Text(), nullable=False, server_default=""),
        sa.Column("pdf_author", sa.String(120), nullable=False, server_default=""),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ux_brand_name_key", "brand", ["name_key"], unique=True)
    op.bulk_insert(
        table,
        [
            {
                **row,
                "logo_on_light": None,
                "logo_on_dark": None,
                "logo_flat": None,
                "builtin": True,
                "created_at": SEEDED_AT,
                "updated_at": SEEDED_AT,
            }
            for row in BUILTIN_ROWS
        ],
    )


def downgrade() -> None:
    op.drop_index("ux_brand_name_key", table_name="brand")
    op.drop_table("brand")
```

- [ ] **Step 6: Fix the 0003 test that pinned the head**

`tests/test_catalogue_migration_0003.py::test_a_failure_after_the_rebuild_rolls_back_and_the_next_open_recovers` asserts the head is exactly `"0003"` after a full open (line 344). With 0004 the open reaches 0004. Change that line to:

```python
            assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() >= "0003"
```

- [ ] **Step 7: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_catalogue_migration_0004.py tests/test_catalogue_migration_0003.py tests/test_catalogue_migration_0002.py tests/test_catalogue_db.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```
git add backend/app/brands/builtins.py backend/app/catalogue/migrations/versions/0004_brands.py backend/app/catalogue/db.py backend/tests/test_catalogue_migration_0004.py backend/tests/test_catalogue_migration_0003.py
git commit -m "catalogue: revision 0004 adds brand with the e& and White label built-ins (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Brand store and the CRUD routes; remove the CRUD stubs

**Files:**
- Create: `backend/app/brands/schemas.py`
- Create: `backend/app/brands/store.py`
- Create: `backend/app/brands/router.py`
- Modify: `backend/app/brands/stubs.py` (only the three logo stubs remain, until Task 5)
- Modify: `backend/app/api.py` (a guarded include of `app.brands.router`, Step 6)
- Modify: `backend/tests/test_contract.py` (`REFUSES_VALID_DATA`)
- Test: `backend/tests/test_brands_api.py` (new)

**Interfaces:**
- Consumes: `app.catalogue.db.Brand`; `app.catalogue.handle.CatalogueHandle`, `get_catalogue`; `app.catalogue.names.normalise_name`; `app.brands.fonts.FAMILIES`; `app.brands.builtins.DEFAULT_COLORS`.
- Produces:
  - `app.brands.schemas`: `BrandColors`, `BrandOut`, `BrandList`, `BrandCreate`, `BrandPatch`, `BrandLogoImport`, `LogoSlot = Literal["on_light", "on_dark", "flat"]`, `SLOTS`.
  - `app.brands.store.BrandRow` (frozen dataclass: `id, name, colors: dict[str, str], font_text, font_numerals, logo_on_light, logo_on_dark, logo_flat, website, owner, confidentiality, pdf_author, builtin`).
  - `app.brands.store.list_brands(cat: CatalogueHandle) -> list[BrandOut]`
  - `app.brands.store.get_brand(cat: CatalogueHandle | None, brand_id: str | None) -> BrandRow | None` (for R1; None when the catalogue is down, the id is null, or the brand was deleted)
  - `app.brands.store.create_brand(cat, body: BrandCreate) -> BrandOut`, `patch_brand(cat, brand_id: str, body: BrandPatch) -> BrandOut`, `delete_brand(cat, brand_id: str) -> None`
  - `app.brands.store.confidentiality_line(brand: BrandRow, year: int, customer: str | None) -> str` (for R1)
  - HTTP: `listBrands`, `createBrand`, `patchBrand`, `deleteBrand` real; errors `brand_name_taken` 409 (details `{brand_id}`), `brand_builtin` 409, `invalid_brand` 422 (details `{errors: [{path, message}]}`), `unknown_font` 422 (details `{path, fonts}`), 404, 503 `catalogue_unavailable`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brands_api.py`:

```python
"""Report brands (spec 2026-10-02-asset-findings §5.8, §8; plan D2 Task 4): the app-level CRUD over
catalogue.db, the built-ins, and the helpers R1 prints with."""

from app.brands import store
from app.brands.builtins import BUILTIN_EAND, BUILTIN_WHITE_LABEL, DEFAULT_COLORS
from app.reports.schemas import ReportConfig

BRANDS = "/api/v1/brands"
RED = {
    "accent": "#aa0000",
    "accent_dark": "#880000",
    "navy": "#101820",
    "ink": "#111111",
    "pale": "#ffeeee",
    "line": "#dddddd",
}


def _post(client, name="Partner", **body):
    return client.post(BRANDS, json={"name": name, **body})


def _items(client) -> list[dict]:
    r = client.get(BRANDS)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _error(r) -> dict:
    return r.json()["error"]


def test_the_list_has_the_two_built_ins_first_then_by_name(client):
    for name in ("Zain", "Orbit Aerials"):
        assert _post(client, name).status_code == 201
    items = _items(client)
    assert [b["id"] for b in items[:2]] == [BUILTIN_EAND, BUILTIN_WHITE_LABEL]
    assert [b["name"] for b in items[2:]] == ["Orbit Aerials", "Zain"]
    eand = items[0]
    assert eand["builtin"] is True and eand["logo_on_dark"] is None
    assert eand["colors"]["accent"] == "#BC0000"


def test_create_starts_from_white_label_colours_and_the_theme_fonts(client):
    r = _post(client, "  Orbit   Aerials ")
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["name"] == "Orbit Aerials"
    assert b["colors"] == DEFAULT_COLORS
    assert (b["font_text"], b["font_numerals"]) == (None, None)
    assert (b["website"], b["owner"], b["confidentiality"], b["pdf_author"]) == ("", "", "", "")
    assert b["builtin"] is False
    assert next(i for i in _items(client) if i["id"] == b["id"]) == b


def test_colours_are_stored_upper_case(client):
    b = _post(client, colors=RED, font_text="Inter", font_numerals="Poppins").json()
    assert b["colors"] == {k: v.upper() for k, v in RED.items()}
    assert (b["font_text"], b["font_numerals"]) == ("Inter", "Poppins")


def test_a_name_is_unique_by_normalised_name_including_built_ins(client):
    first = _post(client, "Orbit Aerials").json()
    r = _post(client, "orbit_aerials")
    assert r.status_code == 409 and _error(r)["code"] == "brand_name_taken"
    assert _error(r)["details"]["brand_id"] == first["id"]
    r = _post(client, "E&")
    assert r.status_code == 409 and _error(r)["details"]["brand_id"] == BUILTIN_EAND


def test_a_name_that_normalises_to_nothing_is_422(client):
    r = _post(client, " _-_ ")
    assert r.status_code == 422 and _error(r)["code"] == "invalid_brand"
    assert _error(r)["details"]["errors"][0]["path"] == "name"


def test_an_unknown_font_is_422(client):
    r = _post(client, font_text="Comic Sans")
    assert r.status_code == 422 and _error(r)["code"] == "unknown_font"
    assert _error(r)["details"] == {"path": "font_text", "fonts": ["Nunito Sans", "Poppins", "Inter"]}
    b = _post(client).json()
    r = client.patch(f"{BRANDS}/{b['id']}", json={"font_numerals": "Space Grotesk"})
    assert r.status_code == 422 and _error(r)["details"]["path"] == "font_numerals"


def test_patch_edits_a_built_in_and_null_clears_a_font(client):
    r = client.patch(f"{BRANDS}/{BUILTIN_EAND}", json={"website": "www.eand.com/drones", "font_numerals": None})
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["website"], b["font_numerals"], b["font_text"]) == ("www.eand.com/drones", None, "Nunito Sans")
    assert b["builtin"] is True


def test_patch_renames_and_refuses_a_taken_name(client):
    a = _post(client, "Zain").json()
    r = client.patch(f"{BRANDS}/{a['id']}", json={"name": "ZAIN"})  # its own name, recased
    assert r.status_code == 200 and r.json()["name"] == "ZAIN"
    r = client.patch(f"{BRANDS}/{a['id']}", json={"name": "White label"})
    assert r.status_code == 409 and _error(r)["code"] == "brand_name_taken"


def test_delete_removes_a_custom_brand_and_refuses_a_built_in(client):
    b = _post(client).json()
    assert client.delete(f"{BRANDS}/{b['id']}").status_code == 204
    assert all(i["id"] != b["id"] for i in _items(client))
    r = client.delete(f"{BRANDS}/{BUILTIN_WHITE_LABEL}")
    assert r.status_code == 409 and _error(r)["code"] == "brand_builtin"


def test_an_unknown_brand_is_404(client):
    assert client.patch(f"{BRANDS}/nope", json={"website": ""}).status_code == 404
    assert client.delete(f"{BRANDS}/nope").status_code == 404


def test_brands_answer_503_without_the_catalogue(client):
    client.app.state.catalogue = None
    r = client.get(BRANDS)
    assert r.status_code == 503 and _error(r)["code"] == "catalogue_unavailable"


def test_get_brand_is_a_session_free_snapshot_or_none(client):
    cat = client.app.state.catalogue
    row = store.get_brand(cat, BUILTIN_EAND)
    assert row is not None and row.colors["navy"] == "#141D2D" and row.font_text == "Nunito Sans"
    assert store.get_brand(cat, None) is None
    assert store.get_brand(cat, "deleted-brand") is None
    assert store.get_brand(None, BUILTIN_EAND) is None


def test_confidentiality_line_fills_year_and_customer(client):
    cat = client.app.state.catalogue
    eand = store.get_brand(cat, BUILTIN_EAND)
    assert store.confidentiality_line(eand, 2026, "DAMAC").startswith("© 2026 e&. All rights reserved.")
    white = store.get_brand(cat, BUILTIN_WHITE_LABEL)
    assert store.confidentiality_line(white, 2026, "DAMAC") == (
        "Confidential. Prepared for DAMAC. Do not distribute without written consent."
    )
    assert "Prepared for the client." in store.confidentiality_line(white, 2026, None)
    assert "Prepared for the client." in store.confidentiality_line(white, 2026, "   ")


def test_report_config_carries_a_nullable_brand_id():
    assert ReportConfig().brand_id is None
    assert ReportConfig.model_validate({"brand_id": BUILTIN_EAND}).brand_id == BUILTIN_EAND
```

- [ ] **Step 2: Run it to see it fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brands_api.py -q`
Expected: FAIL, `ImportError: cannot import name 'store' from 'app.brands'`.

- [ ] **Step 3: Write the schemas**

Create `backend/app/brands/schemas.py`:

```python
"""Brand request and response models (contract `Brand`, `BrandCreate`, `BrandPatch`,
`BrandLogoImport`; spec 2026-10-02-asset-findings §5.8)."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Hex = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
LogoSlot = Literal["on_light", "on_dark", "flat"]
SLOTS: tuple[LogoSlot, ...] = ("on_light", "on_dark", "flat")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrandColors(_Strict):
    accent: Hex
    accent_dark: Hex
    navy: Hex
    ink: Hex
    pale: Hex
    line: Hex


class BrandOut(BaseModel):
    id: str
    name: str
    colors: BrandColors
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
    created_at: datetime
    updated_at: datetime


class BrandList(BaseModel):
    items: list[BrandOut]


class BrandCreate(_Strict):
    name: str = Field(min_length=1, max_length=80)
    colors: BrandColors | None = None
    font_text: str | None = Field(None, max_length=80)
    font_numerals: str | None = Field(None, max_length=80)
    website: str = Field("", max_length=200)
    owner: str = Field("", max_length=120)
    confidentiality: str = Field("", max_length=1000)
    pdf_author: str = Field("", max_length=120)


class BrandPatch(_Strict):
    name: str | None = Field(None, min_length=1, max_length=80)
    colors: BrandColors | None = None
    font_text: str | None = Field(None, max_length=80)
    font_numerals: str | None = Field(None, max_length=80)
    website: str | None = Field(None, max_length=200)
    owner: str | None = Field(None, max_length=120)
    confidentiality: str | None = Field(None, max_length=1000)
    pdf_author: str | None = Field(None, max_length=120)


class BrandLogoImport(_Strict):
    path: str = Field(min_length=1, max_length=1024)
```

- [ ] **Step 4: Write the store**

Create `backend/app/brands/store.py`:

```python
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
            "brand_name_taken", f"There is already a brand called {holder.name}.", 409, {"brand_id": holder.id}
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
```

- [ ] **Step 5: Write the router**

Create `backend/app/brands/router.py`:

```python
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
```

- [ ] **Step 6: Swap the stubs for the router**

1. In `backend/app/brands/stubs.py`, delete the four tuples for `listBrands`, `createBrand`, `patchBrand` and `deleteBrand`; keep the three logo tuples from Task 1. C0's include of `app.brands.stubs` in `app/api.py` stays for now: it serves only the logo stubs until Task 5 deletes it.
2. Run `git grep -n "brands" backend/app/api.py` to find C0's include. Add this guarded block directly before it (the real router first, so its routes win any path both could match):

```python
# Report brands (spec 2026-10-02-asset-findings §5.8, plan D2): app level, in catalogue.db. Guarded
# like Reports: a broken import (Pillow for logos, say) costs the brand endpoints, never the app.
try:
    from app.brands.router import router as brands_router

    api_router.include_router(brands_router)
except Exception:
    log.exception("brands router failed to load; brand endpoints will be unavailable")
```

- [ ] **Step 7: Allow the deliberate refusals in the contract test**

In `backend/tests/test_contract.py`, add to `REFUSES_VALID_DATA` (after the `patchProjectTemplate` entry):

```python
    # D2: a generated brand name can already be taken (`brand_name_taken`, 409), normalise to nothing
    # (`invalid_brand`) or a generated font name is not bundled (`unknown_font`, 422).
    "createBrand": {409, 422},
    "patchBrand": {409, 422},
```

- [ ] **Step 8: Add `brand_id` to the backend report config if C0 did not**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brands_api.py::test_report_config_carries_a_nullable_brand_id -q`
If it fails with `AttributeError: 'ReportConfig' object has no attribute 'brand_id'`, add to `class ReportConfig(_Strict)` in `backend/app/reports/schemas.py`, after `sections`:

```python
    # Spec 2026-10-02-asset-findings §5.8: the brand the report prints with; null is the Kestrel theme.
    brand_id: str | None = Field(None, max_length=64)
```

- [ ] **Step 9: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brands_api.py tests/test_contract.py -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```
git add backend/app/brands/schemas.py backend/app/brands/store.py backend/app/brands/router.py backend/app/brands/stubs.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_brands_api.py
git commit -m "brands: store and CRUD routes over catalogue.db (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `backend/app/reports/schemas.py` only if Step 8 changed it.)

---

### Task 5: Brand logos; remove the last stubs

**Files:**
- Modify: `backend/app/reports/assets.py` (two public wrappers; no behaviour change)
- Modify: `backend/app/brands/store.py` (`set_logo`, `clear_logo`, `logo_path`)
- Modify: `backend/app/brands/router.py` (three routes; drop the stubs include)
- Delete: `backend/app/brands/stubs.py`
- Modify: `backend/app/api.py` (drop C0's include of `app.brands.stubs`)
- Modify: `backend/tests/test_contract.py` (drop the brands `EXPECTED_STUBS` line; `REFUSES_VALID_DATA` += `setBrandLogo`)
- Test: `backend/tests/test_brand_logos.py` (new)

**Interfaces:**
- Consumes: `app.reports.assets.prepare_logo(source: str) -> tuple[bytes, int, int]` and `write_atomic(dest: Path, data: bytes) -> None` (added here).
- Produces:
  - `app.brands.store.LOGO_DIR = "brand-assets"`
  - `app.brands.store.set_logo(cat, brand_id: str, slot: LogoSlot, source: str) -> BrandOut`
  - `app.brands.store.clear_logo(cat, brand_id: str, slot: LogoSlot) -> BrandOut`
  - `app.brands.store.logo_path(cat: CatalogueHandle | None, logo_id: str | None) -> Path | None` (for R1 and the GET route; None for a malformed id or a vanished file)
  - HTTP `getBrandLogo`, `setBrandLogo`, `clearBrandLogo` real.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_brand_logos.py`:

```python
"""Brand logos (spec 2026-10-02-asset-findings §5.8: three logos per brand, customer-supplied, never
committed; plan D2 Task 5). App-level files beside catalogue.db, never in a project."""

import re

from PIL import Image

from app.brands import store
from app.brands.builtins import BUILTIN_EAND

BRANDS = "/api/v1/brands"
LOGO_ID = re.compile(r"^logo-[0-9a-f]{16}$")


def _png(path, size=(600, 200), colour="#bc0000"):
    Image.new("RGBA", size, colour).save(path)
    return path


def _put(client, slot, path, brand=BUILTIN_EAND):
    return client.put(f"{BRANDS}/{brand}/logos/{slot}", json={"path": str(path)})


def test_set_logo_stores_an_app_level_png_and_records_its_id(client, tmp_path):
    r = _put(client, "on_dark", _png(tmp_path / "eand white.png"))
    assert r.status_code == 200, r.text
    logo = r.json()["logo_on_dark"]
    assert LOGO_ID.match(logo)
    cat = client.app.state.catalogue
    on_disk = cat.folder / store.LOGO_DIR / f"{logo}.png"
    assert on_disk.is_file()
    with Image.open(on_disk) as im:
        assert (im.format, im.mode, im.size) == ("PNG", "RGBA", (600, 200))
    assert store.logo_path(cat, logo) == on_disk


def test_get_logo_serves_the_png_with_an_immutable_cache(client, tmp_path):
    logo = _put(client, "flat", _png(tmp_path / "flat.png")).json()["logo_flat"]
    r = client.get(f"{BRANDS}/{BUILTIN_EAND}/logos/flat?v={logo}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "immutable" in r.headers["cache-control"]
    assert r.content.startswith(b"\x89PNG")


def test_a_big_logo_is_scaled_to_1200_px(client, tmp_path):
    logo = _put(client, "on_light", _png(tmp_path / "big.png", (3000, 1000))).json()["logo_on_light"]
    path = store.logo_path(client.app.state.catalogue, logo)
    with Image.open(path) as im:
        assert im.size == (1200, 400)


def test_the_same_image_twice_is_one_file(client, tmp_path):
    a = _put(client, "on_light", _png(tmp_path / "a.png")).json()["logo_on_light"]
    b = _put(client, "on_dark", _png(tmp_path / "b.png")).json()["logo_on_dark"]
    assert a == b
    files = list((client.app.state.catalogue.folder / store.LOGO_DIR).glob("logo-*.png"))
    assert len(files) == 1


def test_clear_logo_removes_it_from_the_brand_and_get_is_404(client, tmp_path):
    _put(client, "on_dark", _png(tmp_path / "x.png"))
    r = client.delete(f"{BRANDS}/{BUILTIN_EAND}/logos/on_dark")
    assert r.status_code == 200 and r.json()["logo_on_dark"] is None
    assert client.get(f"{BRANDS}/{BUILTIN_EAND}/logos/on_dark").status_code == 404


def test_an_unreadable_file_is_422_asset_invalid(client, tmp_path):
    bad = tmp_path / "not.png"
    bad.write_bytes(b"not an image")
    r = _put(client, "on_light", bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "asset_invalid"
    r = _put(client, "on_light", "relative/logo.png")
    assert r.status_code == 422 and r.json()["error"]["details"]["reason"] == "not_absolute"


def test_an_unknown_brand_is_404_before_any_file_is_read(client, tmp_path):
    r = _put(client, "on_light", tmp_path / "missing.png", brand="nope")
    assert r.status_code == 404


def test_a_bad_slot_is_a_validation_error(client, tmp_path):
    r = _put(client, "sideways", _png(tmp_path / "x.png"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_logo_path_refuses_malformed_ids_and_vanished_files(client, tmp_path):
    cat = client.app.state.catalogue
    assert store.logo_path(cat, None) is None
    assert store.logo_path(cat, "../../catalogue.db") is None
    assert store.logo_path(cat, "logo-0123456789abcdef") is None  # well formed, no file
    assert store.logo_path(None, "logo-0123456789abcdef") is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brand_logos.py -q`
Expected: FAIL; the PUT answers 501 `not_implemented` (the stub), so the first assertion fails on `r.status_code == 200`.

- [ ] **Step 3: Add the two public wrappers to `app/reports/assets.py`**

Append (R1 owns this module; these wrappers change nothing for project logos):

```python
def prepare_logo(source: str) -> tuple[bytes, int, int]:
    """The checks and encoding `import_logo` applies, with no project: a PNG of at most MAX_SIDE a
    side and its size, or 422 `asset_invalid`. Brand logos (app/brands/store.py) reuse it."""
    src = Path(source)
    _check(src)
    return _encode(src)


def write_atomic(dest: Path, data: bytes) -> None:
    """`_write` for callers outside this module: a temp name, then a rename."""
    _write(dest, data)
```

- [ ] **Step 4: Add the logo functions to the store**

In `backend/app/brands/store.py`, add imports at the top:

```python
import hashlib
import re
from pathlib import Path

from app.brands.schemas import LogoSlot
from app.reports import assets
```

and append:

```python
LOGO_DIR = "brand-assets"
LOGO_ID = re.compile(r"^logo-[0-9a-f]{16}$")


def set_logo(cat: CatalogueHandle, brand_id: str, slot: LogoSlot, source: str) -> BrandOut:
    """Import a PNG, JPEG or WebP as one of the brand's logos (spec §5.8). Bounded like a report logo:
    at most 20 MB, decoded draft-reduced, at most 1200 px a side. Same bytes, same file."""
    with cat.session() as s:
        _row(s, brand_id)  # 404 before any file is read
    data, _width, _height = assets.prepare_logo(source)
    logo_id = f"logo-{hashlib.sha256(data).hexdigest()[:16]}"
    dest = cat.folder / LOGO_DIR / f"{logo_id}.png"
    if not dest.is_file():  # an existing file is never rewritten (a reader may hold it open)
        assets.write_atomic(dest, data)
    with cat.session() as s:
        row = _row(s, brand_id)
        setattr(row, f"logo_{slot}", logo_id)
        s.flush()
        return to_out(row)


def clear_logo(cat: CatalogueHandle, brand_id: str, slot: LogoSlot) -> BrandOut:
    """The file stays: another brand, or this brand's other slot, may use the same image."""
    with cat.session() as s:
        row = _row(s, brand_id)
        setattr(row, f"logo_{slot}", None)
        s.flush()
        return to_out(row)


def logo_path(cat: CatalogueHandle | None, logo_id: str | None) -> Path | None:
    """The PNG for a logo id, or None (no catalogue, no id, a malformed id, a vanished file)."""
    if cat is None or not logo_id or not LOGO_ID.match(logo_id):
        return None
    path = cat.folder / LOGO_DIR / f"{logo_id}.png"
    return path if path.is_file() else None
```

- [ ] **Step 5: Add the routes and drop the stubs**

In `backend/app/brands/router.py`, change the imports to

```python
from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse

from app.brands import store
from app.brands.schemas import BrandCreate, BrandList, BrandLogoImport, BrandOut, BrandPatch, LogoSlot
from app.catalogue.handle import CatalogueHandle, get_catalogue
from app.errors import not_found
```

and append:

```python
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
```

Delete `backend/app/brands/stubs.py`. In `backend/app/api.py`, delete C0's include of `app.brands.stubs` (`git grep -n "brands.stubs" backend/app/api.py` finds it); the guarded `app.brands.router` block from Task 4 stays. Run `git grep -n "brands" backend/tests/test_contract.py` and delete the `EXPECTED_STUBS` line that reads the brands stubs. Add to `REFUSES_VALID_DATA`:

```python
    # D2: a generated path is never a readable logo (`asset_invalid`, details {reason}).
    "setBrandLogo": {422},
```

- [ ] **Step 6: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_brand_logos.py tests/test_brands_api.py tests/test_report_assets.py tests/test_contract.py -q`
Expected: PASS. `git grep -n "brands.stubs\|brands/stubs" backend` prints nothing.

- [ ] **Step 7: Commit**

```
git add backend/app/reports/assets.py backend/app/brands/store.py backend/app/brands/router.py backend/app/brands/stubs.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_brand_logos.py
git commit -m "brands: app-level logos, last brand stubs removed (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add` of the deleted `stubs.py` stages its deletion.)

---

### Task 6: The theme brand overlay, in Python and TypeScript, pinned by shared vectors

**Files:**
- Modify: `backend/app/reports/theme.py` (`THEME["brand"]`, `with_brand`)
- Modify: `contract/fixtures/report-theme.json` (the `brand` block)
- Create: `contract/fixtures/report-brand-overlay.json`
- Modify: `frontend/src/reports/printTheme.ts` (`PRINT_THEME.brand`, `withBrand`, types)
- Modify: `backend/tests/test_reports_theme.py`
- Create: `frontend/src/reports/printTheme.brand.test.ts`

**Interfaces:**
- Produces:
  - `THEME["brand"] = {"colours": {"ink": "ink", "rule": "line", "head_fill": "pale", "violet": "accent", "violet_print": "accent_dark"}, "cover_gradient": ["navy", "navy", "accent_dark"], "chart_lead": "accent"}`: which theme value takes which brand colour.
  - `app.reports.theme.with_brand(theme: dict, brand: BrandRow | None) -> dict`: a deep copy. With a brand, it sets each mapped colour (upper case), `cover.gradient`, `chart.palette[0]`, and `fonts = {sans: font_text or theme sans, mono: theme mono, numerals: font_numerals or that sans}`. With `None`, it returns an equal copy. It never mutates `theme`. The type annotation reads `BrandRow`; it uses only `.colors`, `.font_text` and `.font_numerals`.
  - TypeScript `frontend/src/reports/printTheme.ts`:
    - `BrandColourKey`;
    - `BrandOverlayInput {colors: Record<BrandColourKey, string>; font_text: string | null; font_numerals: string | null}` (a contract `Brand` satisfies it);
    - `PrintThemeData`;
    - `BrandedTheme`;
    - `withBrand(theme: PrintThemeData, brand: BrandOverlayInput | null): BrandedTheme`.
  - `contract/fixtures/report-brand-overlay.json`: `{cases: [{name, brand: BrandOverlayInput | null, expected: {colours, cover_gradient, chart_palette, fonts} | null}]}`.

- [ ] **Step 1: Write the shared vectors**

Create `contract/fixtures/report-brand-overlay.json`:

```json
{
  "cases": [
    {
      "name": "e& with its fonts, accent_dark in lower case",
      "brand": {
        "colors": {
          "accent": "#BC0000",
          "accent_dark": "#9e0000",
          "navy": "#141D2D",
          "ink": "#1A1A1A",
          "pale": "#FFE5E5",
          "line": "#E7E4DE"
        },
        "font_text": "Nunito Sans",
        "font_numerals": "Poppins"
      },
      "expected": {
        "colours": {
          "ink": "#1A1A1A",
          "muted": "#5E5C7A",
          "rule": "#E7E4DE",
          "head_fill": "#FFE5E5",
          "paper": "#FFFFFF",
          "violet": "#BC0000",
          "violet_print": "#9E0000",
          "teal": "#0F8F76",
          "teal_print": "#5FE3C0",
          "placeholder_fill": "#EEEDF5",
          "ungraded": "#9A98B0",
          "tone_neutral": "#5E5C7A",
          "tone_good": "#0F8F76",
          "tone_bad": "#B3261E",
          "tone_warn": "#8A5A00"
        },
        "cover_gradient": ["#141D2D", "#141D2D", "#9E0000"],
        "chart_palette": ["#BC0000", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
        "fonts": { "sans": "Nunito Sans", "mono": "JetBrains Mono", "numerals": "Poppins" }
      }
    },
    {
      "name": "White label in lower case hex, Inter for both",
      "brand": {
        "colors": {
          "accent": "#1f4fd1",
          "accent_dark": "#173da6",
          "navy": "#131a26",
          "ink": "#141821",
          "pale": "#e8eeff",
          "line": "#e3e6ec"
        },
        "font_text": "Inter",
        "font_numerals": "Inter"
      },
      "expected": {
        "colours": {
          "ink": "#141821",
          "muted": "#5E5C7A",
          "rule": "#E3E6EC",
          "head_fill": "#E8EEFF",
          "paper": "#FFFFFF",
          "violet": "#1F4FD1",
          "violet_print": "#173DA6",
          "teal": "#0F8F76",
          "teal_print": "#5FE3C0",
          "placeholder_fill": "#EEEDF5",
          "ungraded": "#9A98B0",
          "tone_neutral": "#5E5C7A",
          "tone_good": "#0F8F76",
          "tone_bad": "#B3261E",
          "tone_warn": "#8A5A00"
        },
        "cover_gradient": ["#131A26", "#131A26", "#173DA6"],
        "chart_palette": ["#1F4FD1", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
        "fonts": { "sans": "Inter", "mono": "JetBrains Mono", "numerals": "Inter" }
      }
    },
    {
      "name": "a brand without fonts keeps Space Grotesk",
      "brand": {
        "colors": {
          "accent": "#BC0000",
          "accent_dark": "#9E0000",
          "navy": "#141D2D",
          "ink": "#1A1A1A",
          "pale": "#FFE5E5",
          "line": "#E7E4DE"
        },
        "font_text": null,
        "font_numerals": null
      },
      "expected": {
        "colours": {
          "ink": "#1A1A1A",
          "muted": "#5E5C7A",
          "rule": "#E7E4DE",
          "head_fill": "#FFE5E5",
          "paper": "#FFFFFF",
          "violet": "#BC0000",
          "violet_print": "#9E0000",
          "teal": "#0F8F76",
          "teal_print": "#5FE3C0",
          "placeholder_fill": "#EEEDF5",
          "ungraded": "#9A98B0",
          "tone_neutral": "#5E5C7A",
          "tone_good": "#0F8F76",
          "tone_bad": "#B3261E",
          "tone_warn": "#8A5A00"
        },
        "cover_gradient": ["#141D2D", "#141D2D", "#9E0000"],
        "chart_palette": ["#BC0000", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
        "fonts": { "sans": "Space Grotesk", "mono": "JetBrains Mono", "numerals": "Space Grotesk" }
      }
    },
    {
      "name": "a text font alone is also the numerals font",
      "brand": {
        "colors": {
          "accent": "#BC0000",
          "accent_dark": "#9E0000",
          "navy": "#141D2D",
          "ink": "#1A1A1A",
          "pale": "#FFE5E5",
          "line": "#E7E4DE"
        },
        "font_text": "Nunito Sans",
        "font_numerals": null
      },
      "expected": {
        "colours": {
          "ink": "#1A1A1A",
          "muted": "#5E5C7A",
          "rule": "#E7E4DE",
          "head_fill": "#FFE5E5",
          "paper": "#FFFFFF",
          "violet": "#BC0000",
          "violet_print": "#9E0000",
          "teal": "#0F8F76",
          "teal_print": "#5FE3C0",
          "placeholder_fill": "#EEEDF5",
          "ungraded": "#9A98B0",
          "tone_neutral": "#5E5C7A",
          "tone_good": "#0F8F76",
          "tone_bad": "#B3261E",
          "tone_warn": "#8A5A00"
        },
        "cover_gradient": ["#141D2D", "#141D2D", "#9E0000"],
        "chart_palette": ["#BC0000", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
        "fonts": { "sans": "Nunito Sans", "mono": "JetBrains Mono", "numerals": "Nunito Sans" }
      }
    },
    {
      "name": "no brand keeps the Kestrel theme",
      "brand": null,
      "expected": null
    }
  ]
}
```

- [ ] **Step 2: Write the failing Python tests**

Append to `backend/tests/test_reports_theme.py`:

```python
import copy

import pytest

from app.brands.store import BrandRow

VECTORS = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "report-brand-overlay.json"
CASES = json.loads(VECTORS.read_text("utf-8"))["cases"]


def _row(brand: dict) -> BrandRow:
    return BrandRow(
        id="vector",
        name="vector",
        colors=brand["colors"],
        font_text=brand["font_text"],
        font_numerals=brand["font_numerals"],
        logo_on_light=None,
        logo_on_dark=None,
        logo_flat=None,
        website="",
        owner="",
        confidentiality="",
        pdf_author="",
        builtin=False,
    )


def test_the_theme_carries_the_brand_overlay_rules():
    assert theme.THEME["brand"] == {
        "colours": {
            "ink": "ink",
            "rule": "line",
            "head_fill": "pale",
            "violet": "accent",
            "violet_print": "accent_dark",
        },
        "cover_gradient": ["navy", "navy", "accent_dark"],
        "chart_lead": "accent",
    }


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_with_brand_meets_the_shared_vectors(case):
    before = copy.deepcopy(theme.THEME)
    out = theme.with_brand(theme.THEME, _row(case["brand"]) if case["brand"] else None)
    assert theme.THEME == before  # never mutated
    if case["expected"] is None:
        assert out == theme.THEME and out is not theme.THEME
        return
    got = {
        "colours": out["colours"],
        "cover_gradient": out["cover"]["gradient"],
        "chart_palette": out["chart"]["palette"],
        "fonts": out["fonts"],
    }
    assert got == case["expected"]
    assert {k: v for k, v in out.items() if k not in ("colours", "cover", "chart", "fonts")} == {
        k: v for k, v in theme.THEME.items() if k not in ("colours", "cover", "chart", "fonts")
    }
```

(`json` and `Path` are already imported at the top of the file.)

- [ ] **Step 3: Write the failing TypeScript test**

Create `frontend/src/reports/printTheme.brand.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINT_THEME, withBrand, type BrandOverlayInput } from "./printTheme";

interface Expected {
  colours: Record<string, string>;
  cover_gradient: string[];
  chart_palette: string[];
  fonts: Record<string, string>;
}
interface Case {
  name: string;
  brand: BrandOverlayInput | null;
  expected: Expected | null;
}

const VECTORS = resolve(__dirname, "../../../contract/fixtures/report-brand-overlay.json");
const CASES = (JSON.parse(readFileSync(VECTORS, "utf8")) as { cases: Case[] }).cases;
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("withBrand (spec 2026-10-02-asset-findings §5.8, the Python with_brand's twin)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const before = plain(PRINT_THEME);
    const out = withBrand(PRINT_THEME, c.brand);
    expect(plain(PRINT_THEME)).toEqual(before);
    if (c.expected === null) {
      expect(out).toEqual(before);
      return;
    }
    expect({
      colours: out.colours,
      cover_gradient: out.cover.gradient,
      chart_palette: out.chart.palette,
      fonts: out.fonts,
    }).toEqual(c.expected);
    expect(out.type).toEqual(before.type);
    expect(out.brand).toEqual(before.brand);
  });
});
```

- [ ] **Step 4: Run both to see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_theme.py -q`
Expected: FAIL, `KeyError: 'brand'` and `AttributeError: module 'app.reports.theme' has no attribute 'with_brand'`.

Run: `pnpm -C frontend exec vitest run src/reports/printTheme.brand.test.ts`
Expected: FAIL, `withBrand is not a function` (or a TypeScript import error for `withBrand`).

- [ ] **Step 5: Add the overlay to the Python theme**

In `backend/app/reports/theme.py`, replace the module docstring's last sentence with "No PDF-library import here, so routers may import this module; the brand overlay (`THEME["brand"]`, `with_brand`) is owned by plan 2026-10-03-asset-findings-d2." Add at the top, after the docstring:

```python
from __future__ import annotations

import copy
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.brands.store import BrandRow
```

Add this entry to `THEME`, after `"chart"`:

```python
    # Which theme value takes which brand colour (spec 2026-10-02-asset-findings §5.8). with_brand here
    # and withBrand in printTheme.ts both read this block; contract/fixtures/report-brand-overlay.json
    # pins their output.
    "brand": {
        "colours": {
            "ink": "ink",
            "rule": "line",
            "head_fill": "pale",
            "violet": "accent",
            "violet_print": "accent_dark",
        },
        "cover_gradient": ["navy", "navy", "accent_dark"],
        "chart_lead": "accent",
    },
```

Append after `THEME_VERSION`:

```python
def with_brand(theme: dict, brand: BrandRow | None) -> dict:
    """`theme` with a brand's colours and fonts laid over it, as a new dict; `theme` is never changed.

    No brand: an equal copy (today's Kestrel theme). Fonts: `sans` is the brand's text font or the
    theme's, `numerals` is the brand's numerals font or that `sans`; R1 maps a family to embedded
    faces through app.brands.fonts.register_family."""
    out = copy.deepcopy(theme)
    if brand is None:
        return out
    rules = theme["brand"]
    colors = {key: value.upper() for key, value in brand.colors.items()}
    for key, source in rules["colours"].items():
        out["colours"][key] = colors[source]
    out["cover"]["gradient"] = [colors[key] for key in rules["cover_gradient"]]
    out["chart"]["palette"] = [colors[rules["chart_lead"]], *theme["chart"]["palette"][1:]]
    sans = brand.font_text or theme["fonts"]["sans"]
    out["fonts"] = {**theme["fonts"], "sans": sans, "numerals": brand.font_numerals or sans}
    return out
```

- [ ] **Step 6: Add the same block to the fixture**

In `contract/fixtures/report-theme.json`, after the `"chart"` object (add a comma after its closing brace):

```json
  "brand": {
    "colours": {
      "ink": "ink",
      "rule": "line",
      "head_fill": "pale",
      "violet": "accent",
      "violet_print": "accent_dark"
    },
    "cover_gradient": ["navy", "navy", "accent_dark"],
    "chart_lead": "accent"
  }
```

- [ ] **Step 7: Add the block and `withBrand` to `printTheme.ts`**

In `frontend/src/reports/printTheme.ts`, add inside `PRINT_THEME` after `chart`:

```ts
  brand: {
    colours: {
      ink: "ink",
      rule: "line",
      head_fill: "pale",
      violet: "accent",
      violet_print: "accent_dark",
    },
    cover_gradient: ["navy", "navy", "accent_dark"],
    chart_lead: "accent",
  },
```

and append after `findingLabel`:

```ts
/** The six brand colours (contract `BrandColors`). */
export type BrandColourKey = "accent" | "accent_dark" | "navy" | "ink" | "pale" | "line";

/** What the overlay reads from a brand; the contract's `Brand` satisfies it. */
export interface BrandOverlayInput {
  colors: Record<BrandColourKey, string>;
  font_text: string | null;
  font_numerals: string | null;
}

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { -readonly [K in keyof T]: Widen<T[K]> };

/** PRINT_THEME's shape with its literals widened, so a branded copy type-checks. */
export type PrintThemeData = Widen<typeof PRINT_THEME>;

export type BrandedTheme = PrintThemeData & {
  fonts: PrintThemeData["fonts"] & { numerals?: string };
};

/**
 * The print theme with a brand laid over it (spec 2026-10-02-asset-findings §5.8): the twin of
 * backend `app.reports.theme.with_brand`, pinned to it by contract/fixtures/report-brand-overlay.json.
 * Returns a new object; `theme` is never changed. No brand: an equal copy.
 */
export function withBrand(theme: PrintThemeData, brand: BrandOverlayInput | null): BrandedTheme {
  const out = JSON.parse(JSON.stringify(theme)) as BrandedTheme;
  if (!brand) return out;
  const rules = theme.brand;
  const hex = (key: string) => brand.colors[key as BrandColourKey].toUpperCase();
  const colours = out.colours as Record<string, string>;
  for (const [key, source] of Object.entries(rules.colours)) colours[key] = hex(source);
  out.cover.gradient = rules.cover_gradient.map((k) => hex(k));
  out.chart.palette = [hex(rules.chart_lead), ...theme.chart.palette.slice(1)];
  const sans = brand.font_text ?? theme.fonts.sans;
  out.fonts = { ...theme.fonts, sans, numerals: brand.font_numerals ?? sans };
  return out;
}
```

- [ ] **Step 8: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_theme.py -q`
Expected: PASS (the existing `test_theme_equals_the_contract_fixture` passes because THEME and the fixture both gained the block).

Run: `pnpm -C frontend exec vitest run src/reports/printTheme.brand.test.ts src/reports/printTheme.parity.test.ts src/reports/printTheme.test.ts`
Expected: PASS.

Run: `pnpm -C frontend exec tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 9: Commit**

```
git add backend/app/reports/theme.py backend/tests/test_reports_theme.py contract/fixtures/report-theme.json contract/fixtures/report-brand-overlay.json frontend/src/reports/printTheme.ts frontend/src/reports/printTheme.brand.test.ts
git commit -m "reports: brand overlay on the print theme, Python and TS pinned by shared vectors (asset findings D2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gate, frozen build and merge

**Files:** none new.

- [ ] **Step 1: Run the full gate**

From the worktree root:

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: every command passes. `pnpm -C frontend e2e` runs on free ports through `scripts\finish-task.ps1`; on PS 5.1 where that script fails (memory: nested unit controllers), set `E2E_WEB_PORT` and `E2E_MOCK_PORT` to free ports and run `pnpm -C frontend e2e` directly.

- [ ] **Step 2: Packaging check (the spec gained a `datas` line)**

Run: `backend\scripts\build.ps1` then `backend\scripts\smoke_frozen.ps1`
Expected: both pass. Then confirm the fonts are in the bundle: `Get-ChildItem backend\dist\kestrel-backend\_internal\app\brands\fonts` lists the six TTFs and three OFL texts. (The `cargo test` gate line runs only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists.)

- [ ] **Step 3: Merge**

Merge `task/af-d2` into `main` (manual merge per the working agreement), re-run `pnpm -C contract check` and `pytest` on `main`, remove the worktree (links as links, then `git worktree remove`), delete the branch.

- [ ] **Step 4: Operator walkthrough**

Write in the merge report:

1. Start the app (`scripts\dev.ps1`).
2. In a browser at the backend's docs page or with a REST client, `GET /api/v1/brands`: two brands, e& first, then White label, no logos.
3. `PUT /api/v1/brands/builtin-eand/logos/on_dark` with `{"path": "C:\\Users\\D\\Claude_Workspace\\outputs\\Kestrel AI Reference Pack\\asset-inspection-kit\\brands\\eand\\logo-on-dark.png"}`: the answer has `logo_on_dark: "logo-..."`, and the file sits in `%APPDATA%\kestrel-ai\library\brand-assets\`, not in any project or the repo.
4. `DELETE /api/v1/brands/builtin-eand`: 409 `brand_builtin`.

The brand is not yet visible in the PDF (R1) or the UI (U6).

---

## Self-review

**Spec coverage (D2's share):**
- §5.8 table: every column, plus `name_key` for the unique index (Task 3).
- Built-ins seeded by 0004: e& from the kit `brand.yaml` (colours, Nunito Sans, Poppins, website, owner, confidentiality, PDF author) and White label (Inter) (Task 3).
- OFL licence files shipped, with fonts bundled and hashed (Task 2).
- e& logos not committed: logos are imported at run time into app data (Task 5); the seed has none (Task 3 test).
- `ReportConfig.brand_id` nullable, pinned (Task 4 Step 8).
- The theme fixture gains a `brand` overlay block, and the parity test covers it: the existing parity tests cover the block, and the shared vectors cover the overlay's behaviour in both languages (Task 6).
- §8 `GET`, `POST`, `PATCH`, `DELETE /brands` real, stubs removed (Tasks 4 and 5). The R1 entry points are `get_brand`, `logo_path`, `confidentiality_line`, `with_brand`, `fonts.register_family` and `fonts.font_files`.

**Review Focus:** the index assigns no Review Focus test to D2.

**Placeholders:** none. The two conditional steps (Task 1 Step 3 and Task 4 Step 8) depend on what C0 wrote; each carries the exact end state.

## Index notes

1. **`get_brand` takes the catalogue handle.** The index lists `app.brands.store.get_brand(brand_id: str) -> BrandRow | None`. Brands live in `catalogue.db`, and the code reaches it only through a `CatalogueHandle` (the report context reads `handle.catalogue`). The signature is `get_brand(cat: CatalogueHandle | None, brand_id: str | None) -> BrandRow | None`. The name and return type are unchanged, and it answers None when `cat` is None, so R1 can pass `getattr(handle, "catalogue", None)` straight in.
2. **Logo operations added to the contract** (`getBrandLogo`, `setBrandLogo`, `clearBrandLogo` on `/api/v1/brands/{brandId}/logos/{slot}`, plus `BrandLogoSlot` and `BrandLogoImport`). Spec §5.8 calls the logo columns "report-asset ids". But report assets belong to one project (`project.db`, `reports/assets/` in the project folder), and a brand is app-wide. So a brand logo is an app-level file with an id of the same kind (`logo-<sha16>`), stored beside `catalogue.db` and imported with the report-asset rules. R1 resolves it with `store.logo_path(cat, logo_id)`.
3. **Fonts are bundled families, not free paths.** Spec §5.8 says `font_text` and `font_numerals` are "paths to bundled or imported OFL TTFs". This unit stores a bundled family name (`Nunito Sans`, `Poppins`, `Inter`) and refuses any other with 422 `unknown_font`. Importing an arbitrary TTF is not built in this phase; see the spec gap below.
4. **R1's helpers.** R1 applies the overlay. It should read `theme["fonts"].get("numerals", theme["fonts"]["sans"])`, because an unbranded theme has no `numerals` key. It maps a family through `app.brands.fonts.register_family`, and `"Space Grotesk"` stays on `KestrelSans`.

**Spec gap found:** §5.8 allows "imported" OFL TTFs, but no unit owns a font import (no operation in §8, no job, no editor control in §9). D2 ships the three bundled families only. A later unit can add `POST /brands/fonts` and widen the `unknown_font` rule.
