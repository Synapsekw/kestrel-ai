# Asset findings P1: Review profiles, frame, derivation and findings map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pure building blocks every later asset-findings unit stands on:
- the asset frame model (`Frame`) and its bearing helpers;
- the five review profiles, ported from the kit, and `resolve()`, which turns a profile and an asset height into the `asset_model.review` copy;
- the derivation rules: height, bearing, side (compass, faces by azimuth, faces by normal) and zone;
- the findings map geometry in Python and its TypeScript twin, pinned by one shared fixture;
- the shared test generator `backend/tests/fixtures/synthetic_tower.py` (the kit's synthetic tower: GLB, 32 geotagged photos, truth findings with their sightings).

Nothing here touches the database, a route or a job.

**Architecture:**
- New modules in `backend/app/asset_review/` (the package C0 created for its stubs):
  - `frame.py`: pydantic `Frame`, `Origin`, `Preset`; `norm_deg`, `plant_bearing`, `true_bearing`, `true_to_plant`.
  - `profiles.py`: pydantic `Profile`, `ReviewConfig` and their parts; `PROFILES`; `resolve()`; `profile_id_for_kit()`.
  - `derive.py`: `derive()`, `side_of()`, `zone_of()`, `bearing_of()`, `component_name()`.
  - `findings_map.py`: `MapDot`, `geometry()`, `r2()`, `nice_step()`.
- `frontend/src/assetmodels/findingsMap/geometry.ts`: the statement-for-statement twin of `findings_map.py`.
- `contract/fixtures/asset-findings-map.json`: three cases (inputs and expected output) read by both test suites.
- `backend/tests/fixtures/synthetic_tower.py`: `make_tower(tmp_path) -> Tower`, generated at test time, no customer data.
- The contract's `AssetFrame` and `AssetReviewConfig` schemas (C0) are aligned field for field with `Frame` and `ReviewConfig`, and a test keeps them aligned.

**Tech Stack:** Python 3.11, pydantic v2, numpy, trimesh 4.12 (scene export only, no ray engine), Pillow, piexif, pytest; TypeScript, Vitest.

**Spec sections covered:** §5.1 (`frame`, `review` shapes), §7 (review profiles and rules), §9 (asset findings map geometry and shared fixture), §12 (synthetic tower, findings map parity). Index and Global Constraints: `docs/superpowers/plans/2026-10-03-asset-findings.md`.

**Needs:** C0 merged (the `backend/app/asset_review/` package and the `AssetFrame` and `AssetReviewConfig` contract schemas). Nothing else. **Worktree:** `scripts\start-task.ps1 -Name af-p1`.

**Budget:**
- Background jobs: none. Every function here is pure and runs in microseconds per call, except the test generator.
- Bounded reads: `geometry()` is linear in the dots it is given; the caller pages them (U5 and R1 pass at most one page of findings). The generator builds one 253-node GLB (about 200 KB) and writes 32 JPEGs of 1600 x 1067, one at a time; the first call in a test process takes about 1.2 s, later calls reuse the cached model and take about 0.15 s.

**Execution DAG:**

```
T1 frame ──> T2 profiles ──┬──> T3 derive ──────> T7 synthetic tower ──┐
                           ├──> T4 findings map (py + fixture) ──> T5 TS twin ──┤
                           └──> T6 contract alignment ──────────────────────────┴──> T8 gate and land
```

- Independent after T2: T3, T4 and T6 (three parallel tracks). T5 needs T4's fixture; T7 needs T3 (its test checks truth zones with `derive`).
- Critical path: T1, T2, T4, T5, T8.
- Commit order on the branch is the task order; parallel subagents each commit only their own files.

**Shared commands** (PowerShell, from the worktree root):

```powershell
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
```

Backend commands run from `backend/` in the worktree.

---

### Task 1: The asset frame

**Files:**
- Create (only if C0 did not): `backend/app/asset_review/__init__.py` with the single line `"""Findings on the asset (spec 2026-10-02-asset-findings)."""`
- Create: `backend/app/asset_review/frame.py`
- Test: `backend/tests/test_asset_review_frame.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `app.asset_review.frame.Frame` (pydantic, `extra="forbid"`): `origin: Origin | None = None`, `north_offset_deg: float = 0.0` (wrapped to [0, 360)), `height_m: float` (> 0), `datum_label: str = "Ground"`, `datum_note: str = ""`, `line_azimuth_deg: float | None = None` (wrapped), `silhouette: list[tuple[float, float]] = []` (sorted by y, radii >= 0), `levels: list[float] = []` (sorted), `presets: list[Preset] = []`.
  - `Origin(lat: float, lon: float, ground_alt_m: float)`; `Preset(id: str, label: str, target: tuple[float, float, float], camera: tuple[float, float, float])`.
  - `norm_deg(deg: float) -> float` in [0, 360), never -0.0.
  - `plant_bearing(x: float, z: float) -> float`: `atan2(z, x)` in degrees, normalised.
  - `true_bearing(plant_deg: float, frame: Frame) -> float`: plant bearing plus `frame.north_offset_deg`.
  - `true_to_plant(north_m: float, east_m: float, north_offset_deg: float) -> tuple[float, float]`: a true north/east offset as plant `(x, z)`. J2 uses it for the GPS offset.
- Definition this task fixes (the spec named the field but not its sense): `north_offset_deg` is the **true bearing of plant north**; `line_azimuth_deg` is a true bearing. With the default 0, plant and true bearings coincide, as in every kit job.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_review_frame.py
"""The asset frame model and bearing helpers (spec 2026-10-02-asset-findings §5.1, A7)."""

import json
import math

import pytest
from pydantic import ValidationError

from app.asset_review.frame import Frame, Origin, Preset, norm_deg, plant_bearing, true_bearing, true_to_plant


def test_a_frame_needs_only_a_height():
    f = Frame(height_m=42.0)
    assert f.origin is None
    assert (f.north_offset_deg, f.datum_label, f.datum_note, f.line_azimuth_deg) == (0.0, "Ground", "", None)
    assert (f.silhouette, f.levels, f.presets) == ([], [], [])


def test_angles_are_wrapped_into_0_360():
    f = Frame(height_m=10.0, north_offset_deg=-10.0, line_azimuth_deg=370.0)
    assert (f.north_offset_deg, f.line_azimuth_deg) == (350.0, 10.0)


def test_silhouette_and_levels_are_sorted_by_height():
    f = Frame(height_m=10.0, silhouette=[(8.0, 1.0), (0.0, 2.0)], levels=[6.0, 1.5, 3.0])
    assert f.silhouette == [(0.0, 2.0), (8.0, 1.0)]
    assert f.levels == [1.5, 3.0, 6.0]


@pytest.mark.parametrize(
    "bad",
    [
        {"height_m": 0.0},
        {"height_m": -1.0},
        {"height_m": 5.0, "silhouette": [(1.0, -0.1)]},
        {"height_m": 5.0, "origin": {"lat": 91.0, "lon": 0.0, "ground_alt_m": 0.0}},
        {"height_m": 5.0, "presets": [{"id": "", "label": "x", "target": [0, 0, 0], "camera": [1, 1, 1]}]},
        {"height_m": 5.0, "unknown": 1},
    ],
)
def test_invalid_frames_are_rejected(bad):
    with pytest.raises(ValidationError):
        Frame.model_validate(bad)


def test_a_frame_round_trips_through_json():
    f = Frame(
        origin=Origin(lat=24.4539, lon=54.3773, ground_alt_m=5.0),
        north_offset_deg=12.5,
        height_m=42.0,
        datum_label="Slab",
        datum_note="Top of the foundation slab",
        line_azimuth_deg=340.0,
        silhouette=[(0.0, 4.243), (36.0, 1.273)],
        levels=[30.0, 36.0],
        presets=[Preset(id="top", label="Top", target=(0.0, 39.2, 0.0), camera=(8.0, 42.0, 8.0))],
    )
    raw = json.loads(json.dumps(f.model_dump(mode="json")))
    assert raw["silhouette"] == [[0.0, 4.243], [36.0, 1.273]]
    assert raw["presets"][0]["target"] == [0.0, 39.2, 0.0]
    assert Frame.model_validate(raw) == f


@pytest.mark.parametrize(
    ("deg", "want"),
    [(0.0, 0.0), (-10.0, 350.0), (360.0, 0.0), (725.0, 5.0), (-360.0, 0.0), (359.5, 359.5), (-1e-14, 0.0)],
)
def test_norm_deg(deg, want):
    got = norm_deg(deg)
    assert got == pytest.approx(want, abs=1e-9) and 0.0 <= got < 360.0
    assert math.copysign(1.0, got) == 1.0  # never -0.0


@pytest.mark.parametrize(
    ("x", "z", "want"),
    [
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 90.0),
        (-1.0, 0.0, 180.0),
        (0.0, -1.0, 270.0),
        (1.0, 1.0, 45.0),
        (1.0, -0.0, 0.0),
    ],
)
def test_plant_bearing_is_clockwise_from_plant_north(x, z, want):
    assert plant_bearing(x, z) == pytest.approx(want, abs=1e-12)


def test_true_bearing_adds_the_north_offset():
    assert true_bearing(350.0, Frame(height_m=1.0, north_offset_deg=20.0)) == pytest.approx(10.0)
    assert true_bearing(45.0, Frame(height_m=1.0)) == 45.0


def test_true_to_plant_rotates_by_the_north_offset():
    assert true_to_plant(3.0, 4.0, 0.0) == pytest.approx((3.0, 4.0))
    # plant +X points true east: a true-north offset is plant -Z, a true-east offset is plant +X
    assert true_to_plant(1.0, 0.0, 90.0) == pytest.approx((0.0, -1.0), abs=1e-12)
    assert true_to_plant(0.0, 1.0, 90.0) == pytest.approx((1.0, 0.0), abs=1e-12)
    x, z = true_to_plant(10.0, 0.0, 30.0)
    assert plant_bearing(x, z) == pytest.approx(330.0)  # true 0 is plant -30
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_review_frame.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_review.frame'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/frame.py
"""The asset frame (spec 2026-10-02-asset-findings §5.1 and decision A7).

Metres, Y up, X plant north, Z plant east, origin at the base centre on the ground datum. A plant
bearing is atan2(z, x) in degrees, clockwise from plant north, in [0, 360). `north_offset_deg` is the
true bearing of plant north, so a true bearing is the plant bearing plus the offset.
`line_azimuth_deg` is a true bearing too.
"""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, field_validator

Vec3 = tuple[float, float, float]


def norm_deg(deg: float) -> float:
    """Wrap to [0, 360). `+ 0.0` turns -0.0 into 0.0 so JSON never carries a negative zero."""
    out = math.fmod(deg, 360.0)
    if out < 0:
        out += 360.0
    if out >= 360.0:
        out = 0.0
    return out + 0.0


def plant_bearing(x: float, z: float) -> float:
    """Bearing of (x, z) clockwise from plant north (+X) towards plant east (+Z)."""
    return norm_deg(math.degrees(math.atan2(z, x)))


def true_to_plant(north_m: float, east_m: float, north_offset_deg: float) -> tuple[float, float]:
    """A true north/east offset in metres as plant (x, z); plant +X points at true `north_offset_deg`."""
    a = math.radians(north_offset_deg)
    return (north_m * math.cos(a) + east_m * math.sin(a), east_m * math.cos(a) - north_m * math.sin(a))


class Origin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    ground_alt_m: float


class Preset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    target: Vec3
    camera: Vec3


class Frame(BaseModel):
    """`asset_model.frame` (spec §5.1). Every field but `height_m` has a default."""

    model_config = ConfigDict(extra="forbid")
    origin: Origin | None = None
    north_offset_deg: float = 0.0
    height_m: float = Field(gt=0)
    datum_label: str = "Ground"
    datum_note: str = ""
    line_azimuth_deg: float | None = None
    silhouette: list[tuple[float, float]] = Field(default_factory=list)  # [(y, r)], ascending y
    levels: list[float] = Field(default_factory=list)
    presets: list[Preset] = Field(default_factory=list)

    @field_validator("north_offset_deg")
    @classmethod
    def _wrap_offset(cls, v: float) -> float:
        return norm_deg(v)

    @field_validator("line_azimuth_deg")
    @classmethod
    def _wrap_line(cls, v: float | None) -> float | None:
        return None if v is None else norm_deg(v)

    @field_validator("silhouette")
    @classmethod
    def _silhouette(cls, v: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if any(r < 0 for _, r in v):
            raise ValueError("a silhouette radius is negative")
        return sorted(v, key=lambda p: p[0])

    @field_validator("levels")
    @classmethod
    def _levels(cls, v: list[float]) -> list[float]:
        return sorted(v)


def true_bearing(plant_deg: float, frame: Frame) -> float:
    return norm_deg(plant_deg + frame.north_offset_deg)
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_review_frame.py -q`
Expected: `25 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/frame.py tests/test_asset_review_frame.py
& $PY -m ruff format --check app/asset_review/frame.py tests/test_asset_review_frame.py
git add backend/app/asset_review/frame.py backend/tests/test_asset_review_frame.py
# and backend/app/asset_review/__init__.py if this task created it
git commit -m "feat(asset-review): the asset frame model and bearing helpers (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Review profiles and `resolve`

**Files:**
- Create: `backend/app/asset_review/profiles.py`
- Test: `backend/tests/test_asset_review_profiles.py`

**Interfaces:**
- Consumes: nothing from Task 1 (profiles do not need the frame).
- Produces:
  - `app.asset_review.profiles.PROFILES: dict[str, Profile]`, keys in this order: `stack`, `building_facade`, `tank`, `telecom_tower`, `ohtl_tower`.
  - `resolve(profile_id: str, height_m: float, overrides: dict | None = None) -> ReviewConfig`. Raises `UnknownProfile` (a `ValueError`) for an unknown id, `ValueError` for `height_m <= 0`, and pydantic `ValidationError` for a bad override.
  - `ReviewConfig` (pydantic, frozen, `extra="forbid"`), the `asset_model.review` copy: `profile_id, name, asset_noun, finding_noun, assessment_title, finding_unit ("photo" | "region"), placement ("patch" | "point" | "mixed"), patch_grid: int, cluster_m: float, zones: list[ReviewZone], sides: Sides, focus: Focus, report: ReportOptions, component_map: list[ComponentRule], facts: list[str], limits: list[Limit], breakdowns: list[str], footer_disclaimer: str`.
  - `ReviewZone(id, label, min_m: float | None, max_m: float | None)` (None = open end; zones are kept top first); `Sides(type: "compass" | "faces", labels: list[str], basis: "position" | "normal", title: str, noun: str)` (compass labels are always `COMPASS`); `Focus(frustum: tuple[float, float], oblique_deg: float)`; `ReportOptions(pages: "finding" | "defect", min_severity: 1..3)`; `ComponentRule(match: str, label: str)`; `Limit(title: str, text: str)`.
  - `COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")`; `profile_id_for_kit(name: str) -> str` (`"building-facade"` to `"building_facade"`), used by J5.
- Port rules (kit `profiles/*.yaml`, `config.deep_merge`, `records.resolve_zones`):
  - Classes and severity tables are **not** ported: catalogue types stay the source of classes (spec A6).
  - Zone fractions become metres: `from <= 0` is open below, `to >= 1` is open above, otherwise `fraction * H` rounded to 1 mm.
  - `cluster_m` is the profile's value, else `max(0.75, 0.02 * H)` (kit `records.build`); `patch_grid` defaults to 48 (kit `project.run`); `focus.frustum` defaults to `(0.05, 0.125)` (kit `engine.js`).
  - `overrides` deep-merges over the profile; `overrides["zones"]` replaces the zones and accepts `min_m`/`max_m` or the kit's `job.asset.zones` `min`/`max`.
  - The kit's upper-case axis titles become sentence case (`"Side of the stack (approximate bearing)"`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_review_profiles.py
"""Review profiles and `resolve` (spec 2026-10-02-asset-findings §7, §5.1 `review`)."""

import json
import re

import pytest
from pydantic import ValidationError

from app.asset_review.profiles import (
    COMPASS,
    PROFILES,
    ReviewConfig,
    UnknownProfile,
    profile_id_for_kit,
    resolve,
)

DASHES = re.compile("[\u2013\u2014]")


def _zones(cfg: ReviewConfig) -> list[tuple]:
    return [(z.id, z.min_m, z.max_m) for z in cfg.zones]


def test_the_five_built_in_profiles():
    assert list(PROFILES) == ["stack", "building_facade", "tank", "telecom_tower", "ohtl_tower"]
    units = {k: (p.finding_unit, p.placement, p.sides.type) for k, p in PROFILES.items()}
    assert units == {
        "stack": ("photo", "patch", "compass"),
        "building_facade": ("region", "mixed", "faces"),
        "tank": ("region", "patch", "compass"),
        "telecom_tower": ("region", "point", "compass"),
        "ohtl_tower": ("region", "point", "faces"),
    }


def test_resolve_stack_turns_fractions_into_metres_top_first():
    cfg = resolve("stack", 80.0)
    assert _zones(cfg) == [("head", 73.6, None), ("shaft", 15.2, 73.6), ("base", None, 15.2)]
    assert cfg.profile_id == "stack" and cfg.finding_unit == "photo" and cfg.placement == "patch"
    assert cfg.cluster_m == 1.6  # max(0.75, 0.02 H)
    assert cfg.patch_grid == 48
    assert cfg.sides.labels == list(COMPASS) and cfg.sides.basis == "position"
    assert (cfg.report.pages, cfg.report.min_severity) == ("finding", 1)
    assert cfg.focus.frustum == (0.05, 0.125) and cfg.focus.oblique_deg == 0.0
    assert cfg.facts[:3] == ["severity", "height", "zone"]
    assert [lim.title for lim in cfg.limits] == ["Visual only", "Draft, unvalidated", "Approximate positions"]


def test_resolve_building_facade_keeps_its_own_settings():
    cfg = resolve("building_facade", 74.4)
    assert _zones(cfg) == [
        ("roof", 65.472, None),
        ("upper", 40.92, 65.472),
        ("middle", 22.32, 40.92),
        ("lower", 11.904, 22.32),
        ("podium", None, 11.904),
    ]
    assert (cfg.cluster_m, cfg.patch_grid, cfg.placement) == (1.5, 14, "mixed")
    assert (cfg.sides.type, cfg.sides.basis) == ("faces", "normal")
    assert cfg.sides.labels == ["North elevation", "East elevation", "South elevation", "West elevation"]
    assert cfg.focus.frustum == (0.14, 0.26) and cfg.focus.oblique_deg == 28.0
    assert (cfg.report.pages, cfg.report.min_severity) == ("defect", 2)
    assert cfg.component_map == []


def test_resolve_ohtl_faces_relative_to_the_line():
    cfg = resolve("ohtl_tower", 50.0)
    assert _zones(cfg) == [
        ("peak", 44.0, None),
        ("arms", 27.5, 44.0),
        ("body", 6.0, 27.5),
        ("legs", None, 6.0),
    ]
    assert cfg.sides.labels == ["Line ahead", "Right face", "Line back", "Left face"]
    assert cfg.sides.basis == "position" and cfg.cluster_m == 1.0


def test_cluster_has_a_floor_of_three_quarters_of_a_metre():
    assert resolve("telecom_tower", 20.0).cluster_m == 0.75
    assert resolve("tank", 30.0).cluster_m == 0.75
    assert resolve("telecom_tower", 42.0).cluster_m == 0.84


def test_metre_zones_override_in_either_key_form_and_are_sorted_top_first():
    cfg = resolve(
        "building_facade",
        60.0,
        {
            "zones": [
                {"id": "podium", "label": "Podium", "max": 12},
                {"id": "crown", "label": "Roof and crown", "min_m": 55},
                {"id": "L01", "label": "Level 01", "min": 12, "max_m": 55.0},
            ]
        },
    )
    assert _zones(cfg) == [("crown", 55.0, None), ("L01", 12.0, 55.0), ("podium", None, 12.0)]


def test_overrides_deep_merge_over_the_profile():
    cfg = resolve(
        "building_facade",
        60.0,
        {"sides": {"title": "Elevation"}, "report": {"min_severity": 3}, "cluster_m": 2.0, "patch_grid": 20},
    )
    assert cfg.sides.title == "Elevation" and cfg.sides.type == "faces" and len(cfg.sides.labels) == 4
    assert (cfg.report.pages, cfg.report.min_severity) == ("defect", 3)
    assert (cfg.cluster_m, cfg.patch_grid) == (2.0, 20)


def test_compass_sides_always_carry_the_eight_points():
    cfg = resolve("building_facade", 60.0, {"sides": {"type": "compass"}})
    assert cfg.sides.labels == list(COMPASS)


def test_unknown_profile_bad_height_and_bad_overrides_are_rejected():
    with pytest.raises(UnknownProfile):
        resolve("chimney", 10.0)
    with pytest.raises(ValueError):
        resolve("stack", 0.0)
    with pytest.raises(ValidationError):
        resolve("stack", 10.0, {"colour": "red"})
    with pytest.raises(ValidationError):
        resolve("stack", 10.0, {"report": {"min_severity": 4}})
    with pytest.raises(ValidationError):
        resolve("ohtl_tower", 10.0, {"sides": {"labels": ["Only one"]}})


def test_kit_profile_names_map_to_ids():
    assert profile_id_for_kit("building-facade") == "building_facade"
    assert profile_id_for_kit("ohtl-tower") == "ohtl_tower"
    assert profile_id_for_kit("stack") == "stack"
    with pytest.raises(UnknownProfile):
        profile_id_for_kit("pipeline")


def test_profile_text_has_no_em_or_en_dashes():
    text = json.dumps([p.model_dump(mode="json") for p in PROFILES.values()], ensure_ascii=False)
    assert not DASHES.search(text)


def test_a_review_round_trips_through_json():
    for pid in PROFILES:
        cfg = resolve(pid, 33.3)
        assert ReviewConfig.model_validate(json.loads(json.dumps(cfg.model_dump(mode="json")))) == cfg
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_review_profiles.py -q`
Expected: `ModuleNotFoundError: No module named 'app.asset_review.profiles'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/profiles.py
"""Review profiles (spec 2026-10-02-asset-findings §7, decision A6).

Ported from the asset-inspection kit's `profiles/*.yaml`: only the review settings, never the class
lists (catalogue types stay the source of classes). `resolve` turns a profile and an asset height
into the `asset_model.review` copy (spec §5.1), with zones in metres, top first.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

COMPASS: tuple[str, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")
DEFAULT_PATCH_GRID = 48  # kit project.run(grid=48)
DEFAULT_FRUSTUM = (0.05, 0.125)  # kit engine.js focusFrustum default
#: Kit `job.profile` names (hyphenated) to Kestrel profile ids.
KIT_PROFILE_IDS = {
    "stack": "stack",
    "building-facade": "building_facade",
    "tank": "tank",
    "telecom-tower": "telecom_tower",
    "ohtl-tower": "ohtl_tower",
}

FindingUnit = Literal["photo", "region"]
PlacementMode = Literal["patch", "point", "mixed"]


class UnknownProfile(ValueError):
    def __init__(self, profile_id: str) -> None:
        super().__init__(f"unknown review profile {profile_id!r}")
        self.profile_id = profile_id


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Sides(_Model):
    type: Literal["compass", "faces"] = "compass"
    labels: list[str] = Field(default_factory=list)
    basis: Literal["position", "normal"] = "position"
    title: str
    noun: str = "side"

    @model_validator(mode="before")
    @classmethod
    def _compass_labels(cls, data: Any) -> Any:
        """Compass labels are always the eight points; only faces carry their own labels."""
        if isinstance(data, dict) and data.get("type", "compass") == "compass":
            return {**data, "labels": list(COMPASS)}
        return data

    @model_validator(mode="after")
    def _face_labels(self) -> Sides:
        if self.type == "faces" and len(self.labels) < 2:
            raise ValueError("faces sides need at least two labels")
        return self


class Focus(_Model):
    frustum: tuple[float, float] = DEFAULT_FRUSTUM
    oblique_deg: float = 0.0


class ReportOptions(_Model):
    pages: Literal["finding", "defect"] = "finding"
    min_severity: int = Field(default=1, ge=1, le=3)


class ComponentRule(_Model):
    match: str  # a regular expression over the GLB node name, case-insensitive
    label: str


class Limit(_Model):
    title: str
    text: str


class ProfileZone(_Model):
    id: str
    label: str
    from_frac: float = Field(ge=0, le=1)
    to_frac: float = Field(ge=0, le=1)


class Profile(_Model):
    id: str
    name: str
    asset_noun: str
    finding_noun: str
    assessment_title: str
    finding_unit: FindingUnit
    placement: PlacementMode
    patch_grid: int = DEFAULT_PATCH_GRID
    cluster_m: float | None = None  # None: max(0.75, 0.02 H)
    zones: list[ProfileZone]  # top first
    sides: Sides
    focus: Focus = Focus()
    report: ReportOptions = ReportOptions()
    component_map: list[ComponentRule] = Field(default_factory=list)
    facts: list[str]
    limits: list[Limit]
    breakdowns: list[str]
    footer_disclaimer: str


class ReviewZone(_Model):
    id: str
    label: str
    min_m: float | None = None  # None: open below
    max_m: float | None = None  # None: open above


def _zone_key(z: ReviewZone) -> tuple[float, float]:
    top = math.inf if z.max_m is None else z.max_m
    bottom = -math.inf if z.min_m is None else z.min_m
    return (-top, -bottom)


class ReviewConfig(_Model):
    """`asset_model.review` (spec §5.1): a resolved, editable copy of a profile."""

    profile_id: str
    name: str
    asset_noun: str
    finding_noun: str
    assessment_title: str
    finding_unit: FindingUnit
    placement: PlacementMode
    patch_grid: int = Field(ge=2, le=128)
    cluster_m: float = Field(gt=0)
    zones: list[ReviewZone]
    sides: Sides
    focus: Focus
    report: ReportOptions
    component_map: list[ComponentRule]
    facts: list[str]
    limits: list[Limit]
    breakdowns: list[str]
    footer_disclaimer: str

    @field_validator("zones")
    @classmethod
    def _top_first(cls, v: list[ReviewZone]) -> list[ReviewZone]:
        return sorted(v, key=_zone_key)


def _limits(visual: str, draft: str, approx: str) -> list[Limit]:
    """The kit's three report limits, in its order."""
    return [
        Limit(title="Visual only", text=visual),
        Limit(title="Draft, unvalidated", text=draft),
        Limit(title="Approximate positions", text=approx),
    ]


_STACK = Profile(
    id="stack",
    name="Stack, chimney or flare",
    asset_noun="stack",
    finding_noun="candidate corrosion",
    assessment_title="Visual corrosion inspection report",
    finding_unit="photo",
    placement="patch",
    zones=[
        ProfileZone(id="head", label="Top / head", from_frac=0.92, to_frac=1.0),
        ProfileZone(id="shaft", label="Shaft / access", from_frac=0.19, to_frac=0.92),
        ProfileZone(id="base", label="Base / inlet", from_frac=0.0, to_frac=0.19),
    ],
    sides=Sides(type="compass", title="Side of the stack (approximate bearing)"),
    facts="severity height zone component side coverage photo captured position camera".split(),
    limits=_limits(
        "Grades describe what corrosion looks like in the photo. They do not measure metal loss, "
        "pitting depth or fitness for service.",
        "Fine or low-contrast corrosion can be missed, and similar-looking coatings or deposits can be "
        "marked.",
        "The model and camera poses are estimated from photos and GPS. Positions guide the eye; they are "
        "not surveyed locations.",
    ),
    breakdowns=["zone", "component"],
    footer_disclaimer="Draft visual assessment. Not an engineering or fitness-for-service assessment.",
)

_BUILDING_FACADE = Profile(
    id="building_facade",
    name="Building facade",
    asset_noun="building",
    finding_noun="facade defects",
    assessment_title="Facade visual inspection report",
    finding_unit="region",
    placement="mixed",
    patch_grid=14,
    cluster_m=1.5,
    zones=[
        ProfileZone(id="roof", label="Roof and crown", from_frac=0.88, to_frac=1.0),
        ProfileZone(id="upper", label="Upper floors", from_frac=0.55, to_frac=0.88),
        ProfileZone(id="middle", label="Middle floors", from_frac=0.3, to_frac=0.55),
        ProfileZone(id="lower", label="Lower floors", from_frac=0.16, to_frac=0.3),
        ProfileZone(id="podium", label="Podium", from_frac=0.0, to_frac=0.16),
    ],
    sides=Sides(
        type="faces",
        basis="normal",
        labels=["North elevation", "East elevation", "South elevation", "West elevation"],
        title="Elevation (direction the facade faces)",
        noun="elevation",
    ),
    focus=Focus(frustum=(0.14, 0.26), oblique_deg=28.0),
    report=ReportOptions(pages="defect", min_severity=2),
    facts="severity class defect height zone component side photo captured".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Sealant adhesion, fixings, water tightness "
        "and glass stress are not tested.",
        "Fine cracks, sealant gaps and low-contrast defects can be missed, and reflections can look "
        "like defects. Confirm on site before repair planning.",
        "Floors, elevations and positions come from GPS, gimbal angles and a reconstructed 3D model; "
        "they are not surveyed locations.",
    ),
    breakdowns=["side", "class", "zone"],
    footer_disclaimer="Draft visual facade assessment. Not a facade engineering or structural assessment.",
)

_TANK = Profile(
    id="tank",
    name="Tank, silo or vessel",
    asset_noun="tank",
    finding_noun="defects",
    assessment_title="Tank visual inspection report",
    finding_unit="region",
    placement="patch",
    zones=[
        ProfileZone(id="roof", label="Roof", from_frac=0.9, to_frac=1.0),
        ProfileZone(id="shell", label="Shell courses", from_frac=0.1, to_frac=0.9),
        ProfileZone(id="bottom", label="Bottom course / foundation", from_frac=0.0, to_frac=0.1),
    ],
    sides=Sides(type="compass", title="Side of the tank (approximate bearing)"),
    facts="severity class defect height zone component side coverage photo captured position camera".split(),
    limits=_limits(
        "Findings describe the visible surface. Wall thickness, pitting depth and fitness for service "
        "are not measured.",
        "Findings under insulation or low-contrast coatings can be missed. Confirm before repair planning.",
        "Heights and bearings come from estimated camera poses and the 3D model; they are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not an API 653 / fitness-for-service assessment.",
)

_TELECOM_TOWER = Profile(
    id="telecom_tower",
    name="Telecom tower or mast",
    asset_noun="tower",
    finding_noun="defects",
    assessment_title="Tower visual inspection report",
    finding_unit="region",
    placement="point",
    zones=[
        ProfileZone(id="antenna", label="Antenna zone", from_frac=0.8, to_frac=1.0),
        ProfileZone(id="body", label="Tower body", from_frac=0.1, to_frac=0.8),
        ProfileZone(id="base", label="Base / foundation", from_frac=0.0, to_frac=0.1),
    ],
    sides=Sides(type="compass", title="Side of the tower (approximate bearing)"),
    facts="severity class defect height zone component side photo captured position camera".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Torque, section loss and structural capacity "
        "are not measured.",
        "Small or hidden defects can be missed. Every critical finding needs confirmation on site.",
        "Heights and faces come from estimated camera poses and the 3D model. They guide a climber; they "
        "are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not a structural or load-capacity assessment.",
)

_OHTL_TOWER = Profile(
    id="ohtl_tower",
    name="Transmission tower (OHTL)",
    asset_noun="tower",
    finding_noun="defects",
    assessment_title="Transmission tower visual inspection report",
    finding_unit="region",
    placement="point",
    zones=[
        ProfileZone(id="peak", label="Peak and earthwire", from_frac=0.88, to_frac=1.0),
        ProfileZone(id="arms", label="Crossarms and insulators", from_frac=0.55, to_frac=0.88),
        ProfileZone(id="body", label="Tower body", from_frac=0.12, to_frac=0.55),
        ProfileZone(id="legs", label="Legs and foundation", from_frac=0.0, to_frac=0.12),
    ],
    sides=Sides(
        type="faces",
        labels=["Line ahead", "Right face", "Line back", "Left face"],
        title="Face (relative to the line)",
        noun="face",
    ),
    facts="severity class defect height zone component side photo captured position camera".split(),
    limits=_limits(
        "Findings describe what is visible in the photos. Electrical condition, clearances and loading "
        "are not measured.",
        "Hairline cracks and hidden damage can be missed. Confirm critical findings before switching or "
        "climbing.",
        "Heights and faces come from estimated camera poses and the 3D model. They guide a line crew; "
        "they are not surveyed.",
    ),
    breakdowns=["class", "zone", "component"],
    footer_disclaimer="Visual inspection. Not an electrical or structural assessment.",
)

#: The five built-ins (spec §7), by id.
PROFILES: dict[str, Profile] = {
    p.id: p for p in (_STACK, _BUILDING_FACADE, _TANK, _TELECOM_TOWER, _OHTL_TOWER)
}


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """Kit `config.deep_merge`: dicts merge key by key, everything else replaces."""
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _metre_zones(zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Zones in metres, from either `min_m`/`max_m` or the kit's `job.asset.zones` `min`/`max`."""
    out = []
    for z in zones:
        lo = z.get("min_m", z.get("min"))
        hi = z.get("max_m", z.get("max"))
        out.append(
            {
                "id": z["id"],
                "label": z["label"],
                "min_m": None if lo is None else float(lo),
                "max_m": None if hi is None else float(hi),
            }
        )
    return out


def _mm(v: float) -> float:
    return round(v, 3)


def resolve(profile_id: str, height_m: float, overrides: dict[str, Any] | None = None) -> ReviewConfig:
    """The review copy for an asset `height_m` tall. `overrides` is merged over the profile (kit
    `deep_merge` rules); `overrides["zones"]`, when given, replaces the zones and is in metres."""
    try:
        p = PROFILES[profile_id]
    except KeyError:
        raise UnknownProfile(profile_id) from None
    if not height_m > 0:
        raise ValueError("height_m must be positive")
    base = p.model_dump(mode="json", exclude={"id", "zones", "cluster_m"})
    base["profile_id"] = p.id
    base["cluster_m"] = p.cluster_m if p.cluster_m is not None else _mm(max(0.75, 0.02 * height_m))
    base["zones"] = [
        {
            "id": z.id,
            "label": z.label,
            "min_m": None if z.from_frac <= 0 else _mm(z.from_frac * height_m),
            "max_m": None if z.to_frac >= 1 else _mm(z.to_frac * height_m),
        }
        for z in p.zones
    ]
    over = copy.deepcopy(overrides or {})
    if "zones" in over:
        over["zones"] = _metre_zones(over["zones"])
    return ReviewConfig.model_validate(_deep_merge(base, over))


def profile_id_for_kit(name: str) -> str:
    """A kit profile name (`building-facade`) as a Kestrel id (`building_facade`)."""
    try:
        return KIT_PROFILE_IDS[name]
    except KeyError:
        raise UnknownProfile(name) from None
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_review_profiles.py -q`
Expected: `12 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/profiles.py tests/test_asset_review_profiles.py
& $PY -m ruff format --check app/asset_review/profiles.py tests/test_asset_review_profiles.py
git add backend/app/asset_review/profiles.py backend/tests/test_asset_review_profiles.py
git commit -m "feat(asset-review): five review profiles ported from the kit, and resolve (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Derivation (height, bearing, side, zone, component)

**Files:**
- Create: `backend/app/asset_review/derive.py`
- Test: `backend/tests/test_asset_review_derive.py`

**Interfaces:**
- Consumes: `Frame`, `norm_deg`, `plant_bearing`, `true_bearing` (Task 1); `ReviewConfig`, `ComponentRule`, `resolve` (Task 2).
- Produces:
  - `app.asset_review.derive.derive(center: tuple[float, float, float] | None, normal: tuple[float, float, float] | None, review: ReviewConfig, frame: Frame) -> Derived`, with `Derived(height_m, bearing_deg, side, zone)` a frozen dataclass; every field is `None` when `center` is `None` (`NOT_PLACED`). Used by J3, J4 and J5.
  - `side_of(bearing_deg: float, review: ReviewConfig, frame: Frame) -> str`; `zone_of(height_m: float, review: ReviewConfig) -> str | None` (the zone **id**); `bearing_of(center, normal, review) -> float` (plant bearing).
  - `component_name(node: str | None, component_map: Sequence[ComponentRule]) -> str | None` (kit `project.component_name`). J3 uses it for `part`.
- Rules (kit `records.build` lines 112 to 121, `side_of`, `zone_of`):
  - Height is the centre's y. Bearing is `atan2(z, x)` of the centre; with `sides.basis = "normal"` it is `atan2(nz, nx)` of the normal when `hypot(nx, nz) > 0.3` (strictly).
  - Compass: `COMPASS[floor(true_bearing / 45 + 0.5) % 8]`. Faces: `labels[floor(rel / (360 / k) + 0.5) % k]` with `rel = true_bearing - line_azimuth_deg` (0 when unset), wrapped. Half up on a boundary (the kit's `round` was half to even; they differ only at exactly 22.5, 67.5 and so on).
  - Zone: the first zone, top first, with `min <= h < max`; with no match, the top zone when `h` is at or above its minimum, else the bottom zone. `None` when the review has no zones.
  - An unplaced point (no centre) has no height, bearing, side or zone. It never falls back to the camera target (spec §7, plan R7).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_asset_review_derive.py
"""Height, bearing, side and zone (spec 2026-10-02-asset-findings §7)."""

import pytest

from app.asset_review.derive import NOT_PLACED, Derived, component_name, derive, side_of, zone_of
from app.asset_review.frame import Frame
from app.asset_review.profiles import ComponentRule, resolve

TOWER = resolve("telecom_tower", 42.0)  # antenna >= 33.6, body 4.2 to 33.6, base < 4.2
FACADE = resolve("building_facade", 60.0)
OHTL = resolve("ohtl_tower", 50.0)
PLAIN = Frame(height_m=42.0)


def test_an_unplaced_point_has_no_height_side_or_zone():
    """Spec §7 and plan R7: never the camera target's height (the kit's 88.98 m on a 74.4 m building)."""
    assert derive(None, None, TOWER, PLAIN) == NOT_PLACED == Derived(None, None, None, None)
    assert derive(None, (1.0, 0.0, 0.0), FACADE, PLAIN) == NOT_PLACED


def test_height_is_the_centre_y_and_bearing_is_atan2_z_x():
    d = derive((0.5, 30.35, -0.375), None, TOWER, PLAIN)
    assert d.height_m == 30.35
    assert d.bearing_deg == pytest.approx(323.13010235415595, abs=1e-9)
    assert (d.side, d.zone) == ("NW", "body")


@pytest.mark.parametrize(
    ("bearing", "side"),
    [
        (0.0, "N"),
        (22.4, "N"),
        (22.5, "NE"),  # half up; the kit's round() gave N here
        (67.5, "E"),
        (112.4, "E"),
        (180.0, "S"),
        (202.5, "SW"),
        (270.0, "W"),
        (337.4, "NW"),
        (337.5, "N"),
        (359.9, "N"),
    ],
)
def test_compass_sides_are_eight_45_degree_sectors(bearing, side):
    assert side_of(bearing, TOWER, PLAIN) == side


def test_compass_sides_use_the_true_bearing_but_store_the_plant_bearing():
    rotated = Frame(height_m=42.0, north_offset_deg=90.0)
    d = derive((5.0, 10.0, 0.0), None, TOWER, rotated)
    assert d.bearing_deg == 0.0 and d.side == "E"


@pytest.mark.parametrize(
    ("bearing", "face"),
    [
        (30.0, "Line ahead"),
        (74.9, "Line ahead"),
        (75.0, "Right face"),
        (120.0, "Right face"),
        (210.0, "Line back"),
        (300.0, "Left face"),
        (345.0, "Line ahead"),
    ],
)
def test_faces_are_relative_to_the_line_azimuth(bearing, face):
    assert side_of(bearing, OHTL, Frame(height_m=50.0, line_azimuth_deg=30.0)) == face


def test_faces_without_a_line_azimuth_are_relative_to_north():
    assert side_of(90.0, OHTL, Frame(height_m=50.0)) == "Right face"


def test_facade_side_comes_from_the_normal_when_it_is_horizontal_enough():
    frame = Frame(height_m=60.0, line_azimuth_deg=340.0)
    centre = (10.0, 5.0, 0.0)  # plant bearing 0: relative to the line 20 deg, the north elevation
    assert derive(centre, None, FACADE, frame).side == "North elevation"
    facing_east = derive(centre, (0.0, 0.0, 1.0), FACADE, frame)
    assert facing_east.bearing_deg == 90.0 and facing_east.side == "East elevation"  # 110 deg off the line
    assert derive(centre, (0.0, 0.0, -1.0), FACADE, frame).side == "West elevation"  # 270 - 340 = 290
    # horizontal part 0.2828 and exactly 0.3: not more than 0.3, so the position decides
    assert derive(centre, (0.2, 0.95, 0.2), FACADE, frame).bearing_deg == 0.0
    assert derive(centre, (0.0, 0.9, 0.3), FACADE, frame).bearing_deg == 0.0
    assert derive(centre, (0.0, 0.9, 0.3000001), FACADE, frame).bearing_deg == 90.0


def test_basis_position_ignores_the_normal():
    assert derive((1.0, 5.0, 0.0), (0.0, 0.0, 1.0), TOWER, PLAIN).bearing_deg == 0.0


@pytest.mark.parametrize(
    ("h", "zone"),
    [(100.0, "antenna"), (33.6, "antenna"), (33.59, "body"), (4.2, "body"), (4.19, "base"), (-5.0, "base")],
)
def test_zones_are_min_inclusive_and_top_first(h, zone):
    assert zone_of(h, TOWER) == zone


def test_a_height_in_a_gap_between_zones_falls_back_like_the_kit():
    gappy = resolve(
        "tank",
        40.0,
        {
            "zones": [
                {"id": "upper", "label": "Upper", "min": 20, "max": 30},
                {"id": "lower", "label": "Lower", "min": 0, "max": 10},
            ]
        },
    )
    assert zone_of(25.0, gappy) == "upper"
    assert zone_of(15.0, gappy) == "lower"  # below the top zone's minimum: the bottom zone
    assert zone_of(35.0, gappy) == "upper"  # at or above the top zone's minimum: the top zone
    assert zone_of(-1.0, gappy) == "lower"


def test_no_zones_means_no_zone():
    bare = resolve("tank", 40.0, {"zones": []})
    assert zone_of(10.0, bare) is None
    assert derive((1.0, 10.0, 0.0), None, bare, PLAIN).zone is None


@pytest.mark.parametrize(
    ("node", "want"),
    [
        ("Leg_000", "Leg"),
        ("Antenna mount_012", "Antenna mount"),
        ("flare-tip.003", "Flare tip"),
        ("Shell", "Shell"),
        ("___", None),
        ("", None),
        (None, None),
    ],
)
def test_component_name_cleans_the_node_name(node, want):
    assert component_name(node, []) == want


def test_component_map_rules_win_in_order_and_ignore_case():
    rules = [ComponentRule(match=r"^leg", label="Tower leg"), ComponentRule(match="LEG|brac", label="Steel")]
    assert component_name("Leg_000", rules) == "Tower leg"
    assert component_name("Bracing_004", rules) == "Steel"
    assert component_name("Platform_200", rules) == "Platform"
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_review_derive.py -q`
Expected: `ModuleNotFoundError: No module named 'app.asset_review.derive'`.

- [ ] **Step 3: Implement**

```python
# backend/app/asset_review/derive.py
"""Height, bearing, side and zone of a placed point (spec 2026-10-02-asset-findings §7).

A port of the kit's `records.build` bearing block, `side_of` and `zone_of`, with two changes:
- an unplaced point has no height, bearing, side or zone (spec §7, plan R7), never the camera's
  target height;
- a sector boundary rounds half up (`floor(x + 0.5)`), where the kit used Python's half-to-even
  `round`; the two differ only on an exact boundary such as 22.5 degrees.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.asset_review.frame import Frame, norm_deg, plant_bearing, true_bearing
from app.asset_review.profiles import ComponentRule, ReviewConfig

#: With `sides.basis = "normal"`, the normal gives the bearing when its horizontal part exceeds this.
NORMAL_MIN_HORIZONTAL = 0.3

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Derived:
    height_m: float | None
    bearing_deg: float | None
    side: str | None
    zone: str | None


NOT_PLACED = Derived(None, None, None, None)


def bearing_of(center: Vec3, normal: Vec3 | None, review: ReviewConfig) -> float:
    """Plant bearing of the centre; of the normal instead with `basis: normal` and a normal that is
    more than 0.3 horizontal."""
    if (
        review.sides.basis == "normal"
        and normal is not None
        and math.hypot(normal[0], normal[2]) > NORMAL_MIN_HORIZONTAL
    ):
        return plant_bearing(normal[0], normal[2])
    return plant_bearing(center[0], center[2])


def side_of(bearing_deg: float, review: ReviewConfig, frame: Frame) -> str:
    """The side label for a plant bearing. Compass sides use the true bearing; faces use the true
    bearing relative to `frame.line_azimuth_deg` (0 when unset)."""
    rel = true_bearing(bearing_deg, frame)
    if review.sides.type == "faces":
        rel = norm_deg(rel - (frame.line_azimuth_deg or 0.0))
    labels = review.sides.labels
    k = len(labels)
    return labels[math.floor(rel / (360.0 / k) + 0.5) % k]


def zone_of(height_m: float, review: ReviewConfig) -> str | None:
    """The first zone (top first) with min <= h < max; else the top zone when h is at or above its
    minimum, else the bottom zone (kit `zone_of`). None when the review has no zones."""
    zones = review.zones
    if not zones:
        return None
    for z in zones:
        lo = -math.inf if z.min_m is None else z.min_m
        hi = math.inf if z.max_m is None else z.max_m
        if lo <= height_m < hi:
            return z.id
    top_lo = -math.inf if zones[0].min_m is None else zones[0].min_m
    return zones[0].id if height_m >= top_lo else zones[-1].id


def derive(center: Vec3 | None, normal: Vec3 | None, review: ReviewConfig, frame: Frame) -> Derived:
    if center is None:
        return NOT_PLACED
    bearing = bearing_of(center, normal, review)
    return Derived(
        height_m=float(center[1]),
        bearing_deg=bearing,
        side=side_of(bearing, review, frame),
        zone=zone_of(float(center[1]), review),
    )


def component_name(node: str | None, component_map: Sequence[ComponentRule]) -> str | None:
    """Kit `project.component_name`: the first `component_map` rule whose regex matches the node name
    (case-insensitive), else the node name with separators as spaces, a trailing number dropped and
    the first letter capitalised."""
    if not node:
        return None
    for rule in component_map:
        if re.search(rule.match, node, re.IGNORECASE):
            return rule.label
    name = re.sub(r"[_\-.]+", " ", node).strip()
    name = re.sub(r"\s*\d+$", "", name)
    return name[:1].upper() + name[1:] if name else None
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_review_derive.py -q`
Expected: `40 passed`.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/derive.py tests/test_asset_review_derive.py
& $PY -m ruff format --check app/asset_review/derive.py tests/test_asset_review_derive.py
git add backend/app/asset_review/derive.py backend/tests/test_asset_review_derive.py
git commit -m "feat(asset-review): height, bearing, side and zone derivation (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Findings map geometry (Python) and the shared fixture

**Files:**
- Create: `backend/app/asset_review/findings_map.py`
- Create: `contract/fixtures/asset-findings-map.json`
- Test: `backend/tests/test_asset_review_findings_map.py`

**Interfaces:**
- Consumes: `Frame`, `norm_deg` (Task 1); `ReviewConfig`, `resolve` (Task 2).
- Produces:
  - `app.asset_review.findings_map.MapDot(id: str, height_m: float | None, bearing_deg: float | None, severity: int | None)` (frozen dataclass; `bearing_deg` is the plant bearing, as stored on the finding).
  - `geometry(review: ReviewConfig, frame: Frame, dots: Sequence[MapDot]) -> dict` (JSON-able): `width`, `height`, `plot {x, y, w, h}`, `sil_cx`, `zone_label_x`, `dot_r`, `top_m`, `step_m`, `silhouette` (`[[x, y], ...]` polygon or `null`), `levels [{value, y, x1, x2}]`, `zones [{id, label, y, h, label_y, shade}]`, `y_ticks [{value, y}]`, `x_ticks [{label, x}]`, `axis_title`, `dots [{id, x, y, severity}]` (lowest severity first, then id, so severe dots draw on top), `unplaced` (dots without a height or bearing; not drawn). U5 draws it as SVG; R1 draws it in the PDF.
  - `r2(v)`: half up to 0.01; `nice_step(height_m)`.
  - `contract/fixtures/asset-findings-map.json`: `{spec, note, cases: [{name, profile_id, overrides, frame, dots, review, expected}]}`. `review` holds only what the TS twin reads (`sides`, `zones`); the Python test re-derives it with `resolve()` and checks it equals the fixture.
- Layout: the kit's `report/gen.py findings_map` (viewBox 760 x 400, left margin 110, right 138, top 10, bottom 38, silhouette strip 64 wide centred at x = 36, `k = min(7, 30 / rmax)`, the kit's `nice_step`). x of a dot: `110 + rel(bearing) / 360 * 512`, with `rel = true bearing` for compass and `true bearing - line azimuth` for faces. y: `10 + (1 - clamp(h, 0, top) / top) * 352`.
- Parity rules (why the code looks the way it does): no `log10` (the step loop uses only multiply and divide), no accumulated `+=` for ticks (uses `n * step`), rounding by `floor(v * 100 + 0.5) / 100` in both languages, and the dot sort tie-breaks on the id by code unit.

- [ ] **Step 1: Write the fixture**

```json
{
  "spec": "docs/superpowers/specs/2026-10-02-asset-findings-design.md section 9 (asset findings map)",
  "note": "backend/app/asset_review/findings_map.py and frontend/src/assetmodels/findingsMap/geometry.ts both compute `expected` from `review`, `frame` and `dots`. The backend also checks that `review` equals resolve(profile_id, frame.height_m, overrides) restricted to sides and zones. Coordinates are rounded half up to 0.01.",
  "cases": [
    {
      "name": "stack_compass_fraction_zones",
      "profile_id": "stack",
      "overrides": null,
      "frame": {
        "height_m": 80.0,
        "north_offset_deg": 0.0,
        "line_azimuth_deg": null,
        "silhouette": [[0.0, 2.2], [20.0, 2.2], [23.0, 1.65], [60.0, 1.24], [76.0, 0.87]],
        "levels": [1.5, 37.9, 75.2]
      },
      "dots": [
        {"id": "f1", "height_m": 76.5, "bearing_deg": 10.0, "severity": 2},
        {"id": "f2", "height_m": 40.0, "bearing_deg": 200.0, "severity": 1},
        {"id": "f3", "height_m": 5.0, "bearing_deg": 359.9, "severity": 2},
        {"id": "f4", "height_m": null, "bearing_deg": null, "severity": 3},
        {"id": "f5", "height_m": 95.0, "bearing_deg": 90.0, "severity": 3},
        {"id": "f6", "height_m": -2.0, "bearing_deg": 270.0, "severity": null}
      ],
      "review": {
        "sides": {
          "type": "compass",
          "labels": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
          "basis": "position",
          "title": "Side of the stack (approximate bearing)",
          "noun": "side"
        },
        "zones": [
          {"id": "head", "label": "Top / head", "min_m": 73.6, "max_m": null},
          {"id": "shaft", "label": "Shaft / access", "min_m": 15.2, "max_m": 73.6},
          {"id": "base", "label": "Base / inlet", "min_m": null, "max_m": 15.2}
        ]
      },
      "expected": {
        "width": 760,
        "height": 400,
        "plot": {"x": 110, "y": 10, "w": 512, "h": 352},
        "sil_cx": 36.0,
        "zone_label_x": 632,
        "dot_r": 5.5,
        "top_m": 80.0,
        "step_m": 10.0,
        "silhouette": [
          [20.6, 362.0],
          [20.6, 274.0],
          [24.45, 260.8],
          [27.32, 98.0],
          [29.91, 27.6],
          [42.09, 27.6],
          [44.68, 98.0],
          [47.55, 260.8],
          [51.4, 274.0],
          [51.4, 362.0]
        ],
        "levels": [
          {"value": 1.5, "y": 355.4, "x1": 17.6, "x2": 54.4},
          {"value": 37.9, "y": 195.24, "x1": 21.45, "x2": 50.55},
          {"value": 75.2, "y": 31.12, "x1": 24.32, "x2": 47.68}
        ],
        "zones": [
          {"id": "head", "label": "Top / head", "y": 10.0, "h": 28.16, "label_y": 28.08, "shade": true},
          {
            "id": "shaft",
            "label": "Shaft / access",
            "y": 38.16,
            "h": 256.96,
            "label_y": 170.64,
            "shade": false
          },
          {"id": "base", "label": "Base / inlet", "y": 295.12, "h": 66.88, "label_y": 332.56, "shade": true}
        ],
        "y_ticks": [
          {"value": 0.0, "y": 362.0},
          {"value": 10.0, "y": 318.0},
          {"value": 20.0, "y": 274.0},
          {"value": 30.0, "y": 230.0},
          {"value": 40.0, "y": 186.0},
          {"value": 50.0, "y": 142.0},
          {"value": 60.0, "y": 98.0},
          {"value": 70.0, "y": 54.0},
          {"value": 80.0, "y": 10.0}
        ],
        "x_ticks": [
          {"label": "N", "x": 110.0},
          {"label": "E", "x": 238.0},
          {"label": "S", "x": 366.0},
          {"label": "W", "x": 494.0},
          {"label": "N", "x": 622.0}
        ],
        "axis_title": "Side of the stack (approximate bearing)",
        "dots": [
          {"id": "f6", "x": 494.0, "y": 362.0, "severity": null},
          {"id": "f2", "x": 394.44, "y": 186.0, "severity": 1},
          {"id": "f1", "x": 124.22, "y": 25.4, "severity": 2},
          {"id": "f3", "x": 621.86, "y": 340.0, "severity": 2},
          {"id": "f5", "x": 238.0, "y": 10.0, "severity": 3}
        ],
        "unplaced": 1
      }
    },
    {
      "name": "facade_faces_metre_zones",
      "profile_id": "building_facade",
      "overrides": {
        "zones": [
          {"id": "crown", "label": "Roof and crown", "min": 55},
          {"id": "L01", "label": "Level 01", "min": 12, "max": 55},
          {"id": "podium", "label": "Podium", "max": 12}
        ]
      },
      "frame": {
        "height_m": 60.0,
        "north_offset_deg": 0.0,
        "line_azimuth_deg": 340.0,
        "silhouette": [],
        "levels": [12.0, 55.0]
      },
      "dots": [
        {"id": "a", "height_m": 30.0, "bearing_deg": 340.0, "severity": 2},
        {"id": "b", "height_m": 56.2, "bearing_deg": 70.0, "severity": 1},
        {"id": "c", "height_m": 3.3, "bearing_deg": 160.5, "severity": 2},
        {"id": "d", "height_m": 12.0, "bearing_deg": 250.0, "severity": 1}
      ],
      "review": {
        "sides": {
          "type": "faces",
          "labels": ["North elevation", "East elevation", "South elevation", "West elevation"],
          "basis": "normal",
          "title": "Elevation (direction the facade faces)",
          "noun": "elevation"
        },
        "zones": [
          {"id": "crown", "label": "Roof and crown", "min_m": 55.0, "max_m": null},
          {"id": "L01", "label": "Level 01", "min_m": 12.0, "max_m": 55.0},
          {"id": "podium", "label": "Podium", "min_m": null, "max_m": 12.0}
        ]
      },
      "expected": {
        "width": 760,
        "height": 400,
        "plot": {"x": 110, "y": 10, "w": 512, "h": 352},
        "sil_cx": 36.0,
        "zone_label_x": 632,
        "dot_r": 5.5,
        "top_m": 60.0,
        "step_m": 10.0,
        "silhouette": null,
        "levels": [
          {"value": 12.0, "y": 291.6, "x1": 26.0, "x2": 46.0},
          {"value": 55.0, "y": 39.33, "x1": 26.0, "x2": 46.0}
        ],
        "zones": [
          {"id": "crown", "label": "Roof and crown", "y": 10.0, "h": 29.33, "label_y": 28.67, "shade": true},
          {"id": "L01", "label": "Level 01", "y": 39.33, "h": 252.27, "label_y": 169.47, "shade": false},
          {"id": "podium", "label": "Podium", "y": 291.6, "h": 70.4, "label_y": 330.8, "shade": true}
        ],
        "y_ticks": [
          {"value": 0.0, "y": 362.0},
          {"value": 10.0, "y": 303.33},
          {"value": 20.0, "y": 244.67},
          {"value": 30.0, "y": 186.0},
          {"value": 40.0, "y": 127.33},
          {"value": 50.0, "y": 68.67},
          {"value": 60.0, "y": 10.0}
        ],
        "x_ticks": [
          {"label": "North elevation", "x": 110.0},
          {"label": "East elevation", "x": 238.0},
          {"label": "South elevation", "x": 366.0},
          {"label": "West elevation", "x": 494.0},
          {"label": "North elevation", "x": 622.0}
        ],
        "axis_title": "Elevation (direction the facade faces)",
        "dots": [
          {"id": "b", "x": 238.0, "y": 32.29, "severity": 1},
          {"id": "d", "x": 494.0, "y": 291.6, "severity": 1},
          {"id": "a", "x": 110.0, "y": 186.0, "severity": 2},
          {"id": "c", "x": 366.71, "y": 342.64, "severity": 2}
        ],
        "unplaced": 0
      }
    },
    {
      "name": "tower_compass_north_offset",
      "profile_id": "telecom_tower",
      "overrides": null,
      "frame": {
        "height_m": 42.0,
        "north_offset_deg": 10.0,
        "line_azimuth_deg": null,
        "silhouette": [[0.0, 4.243], [36.0, 1.273], [42.0, 1.273]],
        "levels": [30.0, 36.0]
      },
      "dots": [
        {"id": "D1", "height_m": 12.0, "bearing_deg": 45.0, "severity": 2},
        {"id": "D4", "height_m": 39.2, "bearing_deg": 168.43, "severity": 2},
        {"id": "D3", "height_m": 30.35, "bearing_deg": 355.0, "severity": 1}
      ],
      "review": {
        "sides": {
          "type": "compass",
          "labels": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
          "basis": "position",
          "title": "Side of the tower (approximate bearing)",
          "noun": "side"
        },
        "zones": [
          {"id": "antenna", "label": "Antenna zone", "min_m": 33.6, "max_m": null},
          {"id": "body", "label": "Tower body", "min_m": 4.2, "max_m": 33.6},
          {"id": "base", "label": "Base / foundation", "min_m": null, "max_m": 4.2}
        ]
      },
      "expected": {
        "width": 760,
        "height": 400,
        "plot": {"x": 110, "y": 10, "w": 512, "h": 352},
        "sil_cx": 36.0,
        "zone_label_x": 632,
        "dot_r": 5.5,
        "top_m": 45.0,
        "step_m": 5.0,
        "silhouette": [[6.3, 362.0], [27.09, 80.4], [27.09, 33.47], [44.91, 33.47], [44.91, 80.4], [65.7, 362.0]],
        "levels": [
          {"value": 30.0, "y": 127.33, "x1": 3.3, "x2": 68.7},
          {"value": 36.0, "y": 80.4, "x1": 24.09, "x2": 47.91}
        ],
        "zones": [
          {"id": "antenna", "label": "Antenna zone", "y": 10.0, "h": 89.17, "label_y": 58.59, "shade": true},
          {"id": "body", "label": "Tower body", "y": 99.17, "h": 229.97, "label_y": 218.16, "shade": false},
          {
            "id": "base",
            "label": "Base / foundation",
            "y": 329.15,
            "h": 32.85,
            "label_y": 349.57,
            "shade": true
          }
        ],
        "y_ticks": [
          {"value": 0.0, "y": 362.0},
          {"value": 5.0, "y": 322.89},
          {"value": 10.0, "y": 283.78},
          {"value": 15.0, "y": 244.67},
          {"value": 20.0, "y": 205.56},
          {"value": 25.0, "y": 166.44},
          {"value": 30.0, "y": 127.33},
          {"value": 35.0, "y": 88.22},
          {"value": 40.0, "y": 49.11},
          {"value": 45.0, "y": 10.0}
        ],
        "x_ticks": [
          {"label": "N", "x": 110.0},
          {"label": "E", "x": 238.0},
          {"label": "S", "x": 366.0},
          {"label": "W", "x": 494.0},
          {"label": "N", "x": 622.0}
        ],
        "axis_title": "Side of the tower (approximate bearing)",
        "dots": [
          {"id": "D3", "x": 117.11, "y": 124.6, "severity": 1},
          {"id": "D1", "x": 188.22, "y": 268.13, "severity": 2},
          {"id": "D4", "x": 363.77, "y": 55.37, "severity": 2}
        ],
        "unplaced": 0
      }
    }
  ]
}
```

The cases are made-up shapes, not customer assets: a stack with fraction zones and a dot above the top (clamped), one below the ground (clamped), one unplaced and one with no severity; a facade with faces relative to a 340 degree line, metre zones given in the kit's `min`/`max` form, and no silhouette; the synthetic tower's shape with a 10 degree north offset.

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_asset_review_findings_map.py
"""Findings map geometry against the shared fixture (spec 2026-10-02-asset-findings §9). The TS twin
`frontend/src/assetmodels/findingsMap/geometry.test.ts` reads the same file."""

import json
from pathlib import Path

import pytest

from app.asset_review.findings_map import MapDot, geometry, nice_step, r2
from app.asset_review.frame import Frame
from app.asset_review.profiles import resolve

FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "asset-findings-map.json"
CASES = json.loads(FIXTURE.read_text("utf-8"))["cases"]


def test_the_fixture_has_the_three_cases():
    assert [c["name"] for c in CASES] == [
        "stack_compass_fraction_zones",
        "facade_faces_metre_zones",
        "tower_compass_north_offset",
    ]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_geometry_equals_the_fixture(case):
    review = resolve(case["profile_id"], case["frame"]["height_m"], case["overrides"])
    pinned = {
        "sides": review.sides.model_dump(mode="json"),
        "zones": [z.model_dump(mode="json") for z in review.zones],
    }
    assert pinned == case["review"]  # the TS side reads `review` straight from the fixture
    got = geometry(review, Frame.model_validate(case["frame"]), [MapDot(**d) for d in case["dots"]])
    assert json.loads(json.dumps(got)) == case["expected"]


def test_r2_rounds_half_up():
    assert (r2(0.125), r2(-0.004), r2(-0.006), r2(27.315)) == (0.13, 0.0, -0.01, 27.32)


@pytest.mark.parametrize(("h", "step"), [(80.0, 10.0), (42.0, 5.0), (74.4, 10.0), (12.0, 2.0), (3.0, 0.5)])
def test_nice_step(h, step):
    assert nice_step(h) == pytest.approx(step, abs=1e-12)


def test_dots_without_height_or_bearing_are_counted_not_drawn():
    review = resolve("tank", 10.0)
    g = geometry(
        review,
        Frame(height_m=10.0),
        [
            MapDot("a", 5.0, None, 1),
            MapDot("b", None, 90.0, 1),
            MapDot("c", 5.0, 90.0, 1),
        ],
    )
    assert [d["id"] for d in g["dots"]] == ["c"] and g["unplaced"] == 2


def test_dots_draw_lowest_severity_first_then_by_id():
    g = geometry(
        resolve("tank", 10.0),
        Frame(height_m=10.0),
        [
            MapDot("z", 1.0, 0.0, 3),
            MapDot("b", 1.0, 0.0, 1),
            MapDot("a", 1.0, 0.0, 1),
            MapDot("n", 1.0, 0.0, None),
        ],
    )
    assert [d["id"] for d in g["dots"]] == ["n", "a", "b", "z"]
```

- [ ] **Step 3: Run it to see it fail**

Run: `& $PY -m pytest tests/test_asset_review_findings_map.py -q`
Expected: `ModuleNotFoundError: No module named 'app.asset_review.findings_map'`.

- [ ] **Step 4: Implement**

```python
# backend/app/asset_review/findings_map.py
"""The asset findings map geometry (spec 2026-10-02-asset-findings §9, §10).

x is the side (compass bearing 0 to 360, or the faces relative to the line), y is the height. The
layout is the kit's `report/gen.py findings_map` (viewBox 760 x 400). The frontend twin
`frontend/src/assetmodels/findingsMap/geometry.ts` computes the same numbers; both are pinned by
`contract/fixtures/asset-findings-map.json`. Every coordinate is rounded half up to 0.01 with the
same arithmetic in both languages, so the two outputs compare exactly.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from app.asset_review.frame import Frame, norm_deg
from app.asset_review.profiles import ReviewConfig

WIDTH, HEIGHT = 760, 400
SIL_W, LEFT, RIGHT, TOP, BOTTOM = 64, 110, 138, 10, 38
PLOT_W, PLOT_H = WIDTH - LEFT - RIGHT, HEIGHT - TOP - BOTTOM
SIL_CX = SIL_W / 2 + 4
DOT_R = 5.5
COMPASS_TICKS: tuple[tuple[str, float], ...] = (
    ("N", 0.0),
    ("E", 90.0),
    ("S", 180.0),
    ("W", 270.0),
    ("N", 360.0),
)


@dataclass(frozen=True)
class MapDot:
    id: str
    height_m: float | None
    bearing_deg: float | None  # plant bearing
    severity: int | None


def r2(v: float) -> float:
    """Half up to 0.01: `Math.floor(v * 100 + 0.5) / 100` in the TS twin."""
    return math.floor(v * 100 + 0.5) / 100


def nice_step(height_m: float) -> float:
    """Kit `nice_step` (H / 8 snapped to 1, 2, 5 or 10 times a power of ten), without log10 so the
    TS twin gets the same float."""
    raw = height_m / 8
    p = 1.0
    while p * 10 <= raw:
        p *= 10
    while p > raw:
        p /= 10
    m = raw / p
    return (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10) * p


def geometry(review: ReviewConfig, frame: Frame, dots: Sequence[MapDot]) -> dict[str, Any]:
    step = nice_step(frame.height_m)
    top = math.ceil(frame.height_m / step) * step

    def y_of(v: float) -> float:
        return TOP + (1 - max(0.0, min(top, v)) / top) * PLOT_H

    sil = [(float(y), float(r)) for y, r in frame.silhouette] or [(0.0, 1.0)]
    rmax = max(r for _, r in sil) or 1.0
    k = min(7.0, (SIL_W / 2 - 2) / rmax)

    def r_at(h: float) -> float:
        r = 0.0
        for y, rr in sil:
            if y <= h:
                r = rr
        return r or sil[0][1]

    silhouette = None
    if frame.silhouette:
        left = [[r2(SIL_CX - r * k), r2(y_of(y))] for y, r in sil]
        right = [[r2(SIL_CX + r * k), r2(y_of(y))] for y, r in reversed(sil)]
        silhouette = left + right
    levels = [
        {
            "value": lv,
            "y": r2(y_of(lv)),
            "x1": r2(SIL_CX - r_at(lv) * k - 3),
            "x2": r2(SIL_CX + r_at(lv) * k + 3),
        }
        for lv in frame.levels
    ]
    zones = []
    for i, z in enumerate(review.zones):
        a = 0.0 if z.min_m is None else max(0.0, z.min_m)
        b = top if z.max_m is None else min(top, z.max_m)
        zones.append(
            {
                "id": z.id,
                "label": z.label,
                "y": r2(y_of(b)),
                "h": r2(max(0.0, y_of(a) - y_of(b))),
                "label_y": r2(y_of((a + b) / 2) + 4),
                "shade": i % 2 == 0,
            }
        )
    y_ticks = []
    n = 0
    while n * step <= top + 1e-6:
        y_ticks.append({"value": r2(n * step), "y": r2(y_of(n * step))})
        n += 1

    off = frame.north_offset_deg
    rel: Callable[[float], float]
    if review.sides.type == "faces":
        labels = review.sides.labels
        az = frame.line_azimuth_deg or 0.0
        ticks = [(lab, i * 360 / len(labels)) for i, lab in enumerate(labels)] + [(labels[0], 360.0)]

        def rel(b: float) -> float:
            return norm_deg(b + off - az)
    else:
        ticks = list(COMPASS_TICKS)

        def rel(b: float) -> float:
            return norm_deg(b + off)

    x_ticks = [{"label": lab, "x": r2(LEFT + b / 360 * PLOT_W)} for lab, b in ticks]
    placed = sorted(
        (d for d in dots if d.bearing_deg is not None and d.height_m is not None),
        key=lambda d: (d.severity or 0, d.id),
    )
    out_dots = [
        {
            "id": d.id,
            "x": r2(LEFT + rel(d.bearing_deg) / 360 * PLOT_W),  # type: ignore[arg-type]
            "y": r2(y_of(d.height_m)),  # type: ignore[arg-type]
            "severity": d.severity,
        }
        for d in placed
    ]
    return {
        "width": WIDTH,
        "height": HEIGHT,
        "plot": {"x": LEFT, "y": TOP, "w": PLOT_W, "h": PLOT_H},
        "sil_cx": SIL_CX,
        "zone_label_x": LEFT + PLOT_W + 10,
        "dot_r": DOT_R,
        "top_m": r2(top),
        "step_m": r2(step),
        "silhouette": silhouette,
        "levels": levels,
        "zones": zones,
        "y_ticks": y_ticks,
        "x_ticks": x_ticks,
        "axis_title": review.sides.title,
        "dots": out_dots,
        "unplaced": len(dots) - len(placed),
    }
```

- [ ] **Step 5: Run it to see it pass**

Run: `& $PY -m pytest tests/test_asset_review_findings_map.py -q`
Expected: `12 passed`. If a fixture case fails on one coordinate, the implementation differs from the code above; do not edit the fixture to match (the TS twin in Task 5 is checked against the same numbers).

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff check app/asset_review/findings_map.py tests/test_asset_review_findings_map.py
& $PY -m ruff format --check app/asset_review/findings_map.py tests/test_asset_review_findings_map.py
git add backend/app/asset_review/findings_map.py backend/tests/test_asset_review_findings_map.py contract/fixtures/asset-findings-map.json
git commit -m "feat(asset-review): findings map geometry and its shared fixture (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The TypeScript twin and the parity test

**Files:**
- Create: `frontend/src/assetmodels/findingsMap/geometry.ts`
- Test: `frontend/src/assetmodels/findingsMap/geometry.test.ts`

**Interfaces:**
- Consumes: `contract/fixtures/asset-findings-map.json` (Task 4).
- Produces (module exports): `geometry(review: MapReview, frame: MapFrame, dots: MapDot[]): MapGeometry`, `r2`, `normDeg`, `niceStep`, `MAP_WIDTH`, `MAP_HEIGHT`, and the types `MapReview`, `MapFrame`, `MapZone`, `MapDot`, `MapGeometry`. The types are structural subsets, so C0's generated `AssetReviewConfig` and `AssetFrame` types are assignable to `MapReview` and `MapFrame` without a cast. U5's `FindingsMap.tsx` imports from here.
- The same pattern as `frontend/src/reports/printTheme.parity.test.ts` and `frontend/src/mapws/view/siteGrid.test.ts`: read the contract fixture with `readFileSync`, compare with `toEqual`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/assetmodels/findingsMap/geometry.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  geometry,
  niceStep,
  normDeg,
  r2,
  type MapDot,
  type MapFrame,
  type MapGeometry,
  type MapReview,
} from "./geometry";

/** P1's shared fixture (spec §9: "a shared fixture pins both"); findings_map.py reads the same file. */
interface Case {
  name: string;
  review: MapReview;
  frame: MapFrame;
  dots: MapDot[];
  expected: MapGeometry;
}

const FIXTURE = resolve(__dirname, "../../../../contract/fixtures/asset-findings-map.json");
const CASES = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }).cases;

describe("findings map geometry parity (contract/fixtures/asset-findings-map.json)", () => {
  it("has the three shared cases", () => {
    expect(CASES.map((c) => c.name)).toEqual([
      "stack_compass_fraction_zones",
      "facade_faces_metre_zones",
      "tower_compass_north_offset",
    ]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s equals the fixture", (_name, c) => {
    expect(JSON.parse(JSON.stringify(geometry(c.review, c.frame, c.dots)))).toEqual(c.expected);
  });
});

describe("findings map helpers", () => {
  it("rounds half up to 0.01", () => {
    expect(r2(0.125)).toBe(0.13);
    expect(r2(-0.006)).toBe(-0.01);
    expect(r2(-0.004)).toBe(0);
    expect(r2(27.315)).toBe(27.32);
  });

  it("wraps degrees into [0, 360) without a negative zero", () => {
    expect(normDeg(-10)).toBe(350);
    expect(normDeg(360)).toBe(0);
    expect(Object.is(normDeg(-0), 0)).toBe(true);
    expect(normDeg(725)).toBe(5);
  });

  it("snaps the height step to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceStep(80)).toBe(10);
    expect(niceStep(42)).toBe(5);
    expect(niceStep(74.4)).toBe(10);
    expect(niceStep(12)).toBe(2);
    expect(niceStep(3)).toBeCloseTo(0.5, 12);
  });

  it("skips a dot without a height or a bearing and counts it as unplaced", () => {
    const review: MapReview = {
      sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], title: "Side" },
      zones: [],
    };
    const frame: MapFrame = {
      height_m: 10,
      north_offset_deg: 0,
      line_azimuth_deg: null,
      silhouette: [],
      levels: [],
    };
    const g = geometry(review, frame, [
      { id: "a", height_m: 5, bearing_deg: null, severity: 1 },
      { id: "b", height_m: null, bearing_deg: 90, severity: 1 },
      { id: "c", height_m: 5, bearing_deg: 90, severity: 1 },
    ]);
    expect(g.dots.map((d) => d.id)).toEqual(["c"]);
    expect(g.unplaced).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/findingsMap/geometry.test.ts`
Expected: FAIL, `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Implement**

```ts
// frontend/src/assetmodels/findingsMap/geometry.ts
/**
 * The asset findings map geometry (spec 2026-10-02-asset-findings §9): the TS twin of
 * backend/app/asset_review/findings_map.py. x is the side (compass bearing, or the faces relative to
 * the line), y is the height; layout from the kit's report findings map (viewBox 760 x 400). Both
 * twins are pinned by contract/fixtures/asset-findings-map.json, so the arithmetic below follows the
 * Python statement for statement.
 */

export const MAP_WIDTH = 760;
export const MAP_HEIGHT = 400;
const SIL_W = 64;
const LEFT = 110;
const RIGHT = 138;
const TOP = 10;
const BOTTOM = 38;
const PLOT_W = MAP_WIDTH - LEFT - RIGHT;
const PLOT_H = MAP_HEIGHT - TOP - BOTTOM;
const SIL_CX = SIL_W / 2 + 4;
const DOT_R = 5.5;
const COMPASS_TICKS: [string, number][] = [
  ["N", 0],
  ["E", 90],
  ["S", 180],
  ["W", 270],
  ["N", 360],
];

export interface MapZone {
  id: string;
  label: string;
  min_m: number | null;
  max_m: number | null;
}

/** The parts of `asset_model.review` the map reads; the contract's review type is assignable to it. */
export interface MapReview {
  sides: { type: "compass" | "faces"; labels: string[]; title: string };
  zones: MapZone[];
}

/** The parts of `asset_model.frame` the map reads. */
export interface MapFrame {
  height_m: number;
  north_offset_deg: number;
  line_azimuth_deg: number | null;
  silhouette: number[][];
  levels: number[];
}

export interface MapDot {
  id: string;
  height_m: number | null;
  /** Plant bearing, degrees clockwise from plant north. */
  bearing_deg: number | null;
  severity: number | null;
}

export interface MapGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  sil_cx: number;
  zone_label_x: number;
  dot_r: number;
  top_m: number;
  step_m: number;
  silhouette: number[][] | null;
  levels: { value: number; y: number; x1: number; x2: number }[];
  zones: { id: string; label: string; y: number; h: number; label_y: number; shade: boolean }[];
  y_ticks: { value: number; y: number }[];
  x_ticks: { label: string; x: number }[];
  axis_title: string;
  dots: { id: string; x: number; y: number; severity: number | null }[];
  unplaced: number;
}

/** Half up to 0.01, as `r2` in findings_map.py. */
export function r2(v: number): number {
  return Math.floor(v * 100 + 0.5) / 100;
}

/** [0, 360), as `norm_deg` in frame.py (JS `%` is C fmod, like math.fmod). */
export function normDeg(deg: number): number {
  let out = deg % 360;
  if (out < 0) out += 360;
  if (out >= 360) out = 0;
  return out + 0;
}

export function niceStep(heightM: number): number {
  const raw = heightM / 8;
  let p = 1;
  while (p * 10 <= raw) p *= 10;
  while (p > raw) p /= 10;
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function geometry(review: MapReview, frame: MapFrame, dots: MapDot[]): MapGeometry {
  const step = niceStep(frame.height_m);
  const top = Math.ceil(frame.height_m / step) * step;
  const yOf = (v: number) => TOP + (1 - Math.max(0, Math.min(top, v)) / top) * PLOT_H;

  const sil: [number, number][] =
    frame.silhouette.length > 0 ? frame.silhouette.map(([y, r]) => [y, r] as [number, number]) : [[0, 1]];
  const rmax = Math.max(...sil.map(([, r]) => r)) || 1;
  const k = Math.min(7, (SIL_W / 2 - 2) / rmax);
  const rAt = (h: number) => {
    let r = 0;
    for (const [y, rr] of sil) if (y <= h) r = rr;
    return r || sil[0][1];
  };

  let silhouette: number[][] | null = null;
  if (frame.silhouette.length > 0) {
    const left = sil.map(([y, r]) => [r2(SIL_CX - r * k), r2(yOf(y))]);
    const right = [...sil].reverse().map(([y, r]) => [r2(SIL_CX + r * k), r2(yOf(y))]);
    silhouette = [...left, ...right];
  }
  const levels = frame.levels.map((lv) => ({
    value: lv,
    y: r2(yOf(lv)),
    x1: r2(SIL_CX - rAt(lv) * k - 3),
    x2: r2(SIL_CX + rAt(lv) * k + 3),
  }));
  const zones = review.zones.map((z, i) => {
    const a = z.min_m === null ? 0 : Math.max(0, z.min_m);
    const b = z.max_m === null ? top : Math.min(top, z.max_m);
    return {
      id: z.id,
      label: z.label,
      y: r2(yOf(b)),
      h: r2(Math.max(0, yOf(a) - yOf(b))),
      label_y: r2(yOf((a + b) / 2) + 4),
      shade: i % 2 === 0,
    };
  });
  const yTicks: { value: number; y: number }[] = [];
  for (let n = 0; n * step <= top + 1e-6; n += 1) yTicks.push({ value: r2(n * step), y: r2(yOf(n * step)) });

  const off = frame.north_offset_deg;
  let ticks: [string, number][];
  let rel: (b: number) => number;
  if (review.sides.type === "faces") {
    const labels = review.sides.labels;
    const az = frame.line_azimuth_deg ?? 0;
    ticks = [
      ...labels.map((lab, i) => [lab, (i * 360) / labels.length] as [string, number]),
      [labels[0], 360],
    ];
    rel = (b) => normDeg(b + off - az);
  } else {
    ticks = COMPASS_TICKS;
    rel = (b) => normDeg(b + off);
  }
  const xTicks = ticks.map(([label, b]) => ({ label, x: r2(LEFT + (b / 360) * PLOT_W) }));

  const placed = dots
    .filter(
      (d): d is MapDot & { height_m: number; bearing_deg: number } =>
        d.bearing_deg !== null && d.height_m !== null,
    )
    .sort((p, q) => (p.severity ?? 0) - (q.severity ?? 0) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    plot: { x: LEFT, y: TOP, w: PLOT_W, h: PLOT_H },
    sil_cx: SIL_CX,
    zone_label_x: LEFT + PLOT_W + 10,
    dot_r: DOT_R,
    top_m: r2(top),
    step_m: r2(step),
    silhouette,
    levels,
    zones,
    y_ticks: yTicks,
    x_ticks: xTicks,
    axis_title: review.sides.title,
    dots: placed.map((d) => ({
      id: d.id,
      x: r2(LEFT + (rel(d.bearing_deg) / 360) * PLOT_W),
      y: r2(yOf(d.height_m)),
      severity: d.severity,
    })),
    unplaced: dots.length - placed.length,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/findingsMap/geometry.test.ts`
Expected: `8 passed`.

- [ ] **Step 5: Lint, type-check and commit**

```powershell
pnpm -C frontend exec eslint src/assetmodels/findingsMap
pnpm -C frontend exec prettier --check src/assetmodels/findingsMap
pnpm -C frontend exec tsc -b
git add frontend/src/assetmodels/findingsMap/geometry.ts frontend/src/assetmodels/findingsMap/geometry.test.ts
git commit -m "feat(assetmodels): findings map geometry twin with fixture parity (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: eslint and prettier print nothing; `tsc -b` exits 0.

---

### Task 6: Contract alignment for `AssetFrame` and `AssetReviewConfig`

C0 wrote these schemas from spec §5.1. `ReviewConfig` also carries what §7 says a profile holds for the report (`facts`, `limits`, the nouns and titles, `component_map`, `breakdowns`, `footer_disclaimer`), and J1 serves `asset_model.review` as a `ReviewConfig` dump. Without this task, schemathesis's response check in `tests/test_contract.py` rejects the extra fields as soon as J1 routes `patchAssetModel` (the schemas are `additionalProperties: false`). If C0 already wrote exactly the block below, Step 2 passes at once and Steps 3 and 4 change nothing; commit only the test.

**Files:**
- Modify: `contract/openapi.yaml` (`components/schemas`)
- Regenerate: `contract/client/schema.d.ts`
- Test: `backend/tests/test_asset_review_contract.py`

**Interfaces:**
- Consumes: `Frame`, `Origin`, `Preset` (Task 1); `ReviewConfig` and its parts, `resolve` (Task 2); C0's `AssetFrame` and `AssetReviewConfig`, referenced from `AssetModel.frame`, `AssetModel.review` and `AssetModelPatch`.
- Produces: schemas `AssetFrame`, `AssetFrameOrigin`, `AssetFramePreset`, `AssetReviewConfig`, `AssetReviewZone`, `AssetReviewSides`, `AssetReviewFocus`, `AssetReviewReport`, `AssetReviewComponentRule`, `AssetReviewLimit`, each with exactly the pydantic model's field names and `additionalProperties: false`. Generated TS: `components["schemas"]["AssetFrame"]` and `components["schemas"]["AssetReviewConfig"]`.

- [ ] **Step 1: Write the test**

```python
# backend/tests/test_asset_review_contract.py
"""P1's models and the contract schemas name the same fields (spec 2026-10-02-asset-findings §5.1):
`asset_model.frame` and `asset_model.review` are stored as `Frame` and `ReviewConfig` dumps and
served as `AssetFrame` and `AssetReviewConfig`."""

from pathlib import Path

import yaml

from app.asset_review.frame import Frame, Origin, Preset
from app.asset_review.profiles import (
    ComponentRule,
    Focus,
    Limit,
    ReportOptions,
    ReviewConfig,
    ReviewZone,
    Sides,
    resolve,
)

CONTRACT = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
PAIRS = {
    "AssetFrame": Frame,
    "AssetFrameOrigin": Origin,
    "AssetFramePreset": Preset,
    "AssetReviewConfig": ReviewConfig,
    "AssetReviewZone": ReviewZone,
    "AssetReviewSides": Sides,
    "AssetReviewFocus": Focus,
    "AssetReviewReport": ReportOptions,
    "AssetReviewComponentRule": ComponentRule,
    "AssetReviewLimit": Limit,
}


def _schemas() -> dict:
    return yaml.safe_load(CONTRACT.read_text("utf-8"))["components"]["schemas"]


def test_every_frame_and_review_schema_has_the_models_fields():
    schemas = _schemas()
    for name, model in PAIRS.items():
        assert set(schemas[name]["properties"]) == set(model.model_fields), name
        assert schemas[name].get("additionalProperties") is False, name


def test_a_resolved_review_carries_every_required_field():
    required = set(_schemas()["AssetReviewConfig"]["required"])
    for pid in ("stack", "building_facade", "ohtl_tower"):
        assert set(resolve(pid, 60.0).model_dump(mode="json")) == required
```

- [ ] **Step 2: Run it**

Run: `& $PY -m pytest tests/test_asset_review_contract.py -q`
Expected before Step 3: FAIL with `KeyError` on the first nested schema name C0 did not use (for example `'AssetFrameOrigin'`), or an `AssertionError` naming `AssetReviewConfig` (C0 had only the §5.1 fields).

- [ ] **Step 3: Replace the two schemas and their nested schemas**

In `contract/openapi.yaml`, find C0's `AssetFrame:` and `AssetReviewConfig:` under `components/schemas` (search `AssetFrame:`). Replace both definitions, and any nested schema that only they referenced, with this block, at the same indentation (four spaces before each schema name). Leave every `$ref: "#/components/schemas/AssetFrame"` and `$ref: "#/components/schemas/AssetReviewConfig"` elsewhere unchanged.

```yaml
    AssetFrameOrigin:
      type: object
      additionalProperties: false
      description: The asset's base centre (WGS84) and the ground altitude in the photos' altitude datum.
      required: [lat, lon, ground_alt_m]
      properties:
        lat: { type: number, minimum: -90, maximum: 90 }
        lon: { type: number, minimum: -180, maximum: 180 }
        ground_alt_m: { type: number }
    AssetFramePreset:
      type: object
      additionalProperties: false
      description: A named close-up view, in the asset frame (metres).
      required: [id, label, target, camera]
      properties:
        id: { type: string, minLength: 1 }
        label: { type: string, minLength: 1 }
        target: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
        camera: { type: array, items: { type: number }, minItems: 3, maxItems: 3 }
    AssetFrame:
      type: object
      additionalProperties: false
      description: >-
        `asset_model.frame` (spec 2026-10-02-asset-findings §5.1). Metres, Y up, X plant north, Z plant
        east, origin at the base centre on the ground datum. `north_offset_deg` is the true bearing of
        plant north; `line_azimuth_deg` is a true bearing. Every field but `height_m` has a default.
      required: [height_m]
      properties:
        origin:
          oneOf:
            - $ref: "#/components/schemas/AssetFrameOrigin"
            - type: "null"
        north_offset_deg: { type: number, default: 0 }
        height_m: { type: number, exclusiveMinimum: 0 }
        datum_label: { type: string, default: Ground }
        datum_note: { type: string, default: "" }
        line_azimuth_deg: { type: [number, "null"] }
        silhouette:
          type: array
          description: "[y, r] pairs, ascending y: the radial outline used by the findings map"
          items: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        levels: { type: array, items: { type: number } }
        presets: { type: array, items: { $ref: "#/components/schemas/AssetFramePreset" } }
    AssetReviewZone:
      type: object
      additionalProperties: false
      required: [id, label, min_m, max_m]
      properties:
        id: { type: string }
        label: { type: string }
        min_m: { type: [number, "null"], description: "null: open below" }
        max_m: { type: [number, "null"], description: "null: open above" }
    AssetReviewSides:
      type: object
      additionalProperties: false
      required: [type, labels, basis, title, noun]
      properties:
        type: { type: string, enum: [compass, faces] }
        labels: { type: array, items: { type: string }, description: "the eight compass points, or the faces in order from the line azimuth" }
        basis: { type: string, enum: [position, normal] }
        title: { type: string }
        noun: { type: string }
    AssetReviewFocus:
      type: object
      additionalProperties: false
      required: [frustum, oblique_deg]
      properties:
        frustum: { type: array, items: { type: number }, minItems: 2, maxItems: 2, description: "half-height of the focus view as [min, max] fractions of the asset height" }
        oblique_deg: { type: number }
    AssetReviewReport:
      type: object
      additionalProperties: false
      required: [pages, min_severity]
      properties:
        pages: { type: string, enum: [finding, defect] }
        min_severity: { type: integer, minimum: 1, maximum: 3 }
    AssetReviewComponentRule:
      type: object
      additionalProperties: false
      required: [match, label]
      properties:
        match: { type: string, description: "a case-insensitive regular expression over the GLB node name" }
        label: { type: string }
    AssetReviewLimit:
      type: object
      additionalProperties: false
      required: [title, text]
      properties:
        title: { type: string }
        text: { type: string }
    AssetReviewConfig:
      type: object
      additionalProperties: false
      description: >-
        `asset_model.review` (spec 2026-10-02-asset-findings §5.1, §7): a review profile resolved for the
        asset's height and editable by the operator. Zones are in metres, top first.
      required:
        - profile_id
        - name
        - asset_noun
        - finding_noun
        - assessment_title
        - finding_unit
        - placement
        - patch_grid
        - cluster_m
        - zones
        - sides
        - focus
        - report
        - component_map
        - facts
        - limits
        - breakdowns
        - footer_disclaimer
      properties:
        profile_id: { type: string, description: "the built-in profile it came from: stack, building_facade, tank, telecom_tower or ohtl_tower" }
        name: { type: string }
        asset_noun: { type: string }
        finding_noun: { type: string }
        assessment_title: { type: string }
        finding_unit: { type: string, enum: [photo, region] }
        placement: { type: string, enum: [patch, point, mixed] }
        patch_grid: { type: integer, minimum: 2, maximum: 128 }
        cluster_m: { type: number, exclusiveMinimum: 0 }
        zones: { type: array, items: { $ref: "#/components/schemas/AssetReviewZone" } }
        sides: { $ref: "#/components/schemas/AssetReviewSides" }
        focus: { $ref: "#/components/schemas/AssetReviewFocus" }
        report: { $ref: "#/components/schemas/AssetReviewReport" }
        component_map: { type: array, items: { $ref: "#/components/schemas/AssetReviewComponentRule" } }
        facts: { type: array, items: { type: string } }
        limits: { type: array, items: { $ref: "#/components/schemas/AssetReviewLimit" } }
        breakdowns: { type: array, items: { type: string } }
        footer_disclaimer: { type: string }
```

Then delete any schema C0 created for these two that is now unreferenced (Spectral's `oas3-unused-component` names it in Step 4).

- [ ] **Step 4: Lint the contract, regenerate the client, run the test**

```powershell
pnpm -C contract lint
pnpm -C contract generate
& $PY -m pytest tests/test_asset_review_contract.py tests/test_contract.py -q
pnpm -C frontend exec tsc -b
```

Expected: Spectral reports no errors; `schema.d.ts` changes only inside the frame and review types; both pytest files pass; `tsc -b` exits 0 (no frontend code reads these types yet).

- [ ] **Step 5: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts backend/tests/test_asset_review_contract.py
git commit -m "feat(contract): AssetFrame and AssetReviewConfig match the P1 models

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The shared synthetic tower generator

**Files:**
- Create: `backend/tests/fixtures/synthetic_tower.py` (the folder `backend/tests/fixtures/` exists and has no `__init__.py`; tests import it as `from fixtures.synthetic_tower import make_tower`, a namespace package on pytest's rootdir path, like `findings_helpers`)
- Test: `backend/tests/test_synthetic_tower.py`

**Interfaces:**
- Consumes: `Frame`, `Origin`, `Preset` (Task 1); `resolve` (Task 2) and `derive` (Task 3) in its test; `app.datasets.prepare.read_exif` and `read_camera` (the importer's EXIF and XMP readers, `backend/app/datasets/prepare.py`) in its test.
- Produces, for J2, J3, J4, J5 and the close-out:
  - `make_tower(tmp_path: Path, *, photos: bool = True) -> Tower`, deterministic.
  - `Tower(glb_path: Path, frame: Frame, poses: list[dict], truth: list[TruthFinding], photos_dir: Path | None, profile_id: str = "telecom_tower", image_size: tuple[int, int] = (1600, 1067))`.
  - `poses`: 32 dicts shaped like a kit `cameras.json` photo: `id` (`p001`), `name` and `source_name` (`DJI_0001.JPG`), `sequence` (`"1"`), `position`, `target`, `up` (asset frame, metres), `hfov`, `vfov` (degrees), `yaw`, `pitch`, `roll` (the gimbal angles written to the photo), `latitude`, `longitude`, `altitude`, `width`, `height`, `time` (EXIF form), `orientation_source`.
  - `TruthFinding(id, cls, severity, center, radius, note, zone, side, sightings: tuple[TruthSighting, ...])`; `TruthSighting(image_name: str, box: tuple[x, y, w, h])` in photo pixels, top-left origin, clipped to the photo (the shape of a `box` row).
  - Constants `LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0`, `PHOTO_W, PHOTO_H = 1600, 1067`, `HFOV`, `VFOV`, `HEIGHT_M = 42.0`.
- What the photos carry, and why (J2 reads poses from the image row, filled on import by `app.datasets.prepare`):
  - EXIF GPS latitude, longitude and altitude (`read_exif`: the `image.lat`, `lon`, `alt` columns; the altitude is absolute, the frame origin's ground altitude is 5 m);
  - EXIF `FocalLength` 4.5 mm and `FocalLengthIn35mmFilm` 31, so `intrinsics_from_exif` gives `focal_mm = 4.5`, `sensor_w_mm = 5.2258` and J2's FOV equals the kit's 35 mm rule;
  - EXIF `PixelXDimension`/`PixelYDimension` (`orig_w`, `orig_h`);
  - DJI XMP `GimbalYawDegree` (in (-180, 180], as DJI writes it), `GimbalPitchDegree`, `GimbalRollDegree`, `FlightYawDegree`, `RelativeAltitude`, `AbsoluteAltitude`, written through Pillow's `xmp=` save argument, which is where `read_xmp` finds it (`opened.info["xmp"]`).
  - `DateTimeOriginal` from 2026:09:20 09:10:00, seven seconds apart.
  - Pixels: a flat sky with a filled disc in the class colour over each visible defect. The kit rendered the tower in WebGL through Playwright; that needs a browser at test time, and no unit needs the rendered pixels (J3 only crops the photo for the patch texture).
- Port notes: `make_tower.py` geometry is copied statement for statement (253 nodes, the same names, `Leg_000` and on). `shoot.py` poses are copied exactly. `detect_truth.py` is copied except the occlusion ray cast: trimesh's ray engine needs `rtree`, which is not installed, so the generator uses a vectorised numpy Moller-Trumbore test over the 10,680 triangles, which gives the same visibility.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_synthetic_tower.py
"""The shared synthetic tower generator (backend/tests/fixtures/synthetic_tower.py): a port of the kit's
examples/synthetic-tower that J2 to J5 and the close-out build on. No customer data (spec A10)."""

import math

import pytest
import trimesh
from fixtures.synthetic_tower import ALT0, LAT0, LON0, PHOTO_H, PHOTO_W, make_tower
from PIL import Image

from app.asset_review.derive import derive
from app.asset_review.profiles import resolve
from app.datasets.prepare import read_camera, read_exif

COUNTS = {"D1": 7, "D2": 9, "D3": 8, "D4": 6, "D5": 8, "D6": 8}


def test_it_writes_a_glb_and_32_geotagged_photos(tmp_path):
    t = make_tower(tmp_path)
    assert t.glb_path == tmp_path / "model.glb" and t.glb_path.stat().st_size > 100_000
    assert t.photos_dir == tmp_path / "photos"
    names = sorted(p.name for p in t.photos_dir.iterdir())
    assert names == [f"DJI_{i:04d}.JPG" for i in range(1, 33)]
    assert [p["name"] for p in t.poses] == names
    assert t.profile_id == "telecom_tower" and t.image_size == (PHOTO_W, PHOTO_H) == (1600, 1067)


def test_the_glb_is_the_kit_tower(tmp_path):
    scene = trimesh.load(make_tower(tmp_path, photos=False).glb_path, force="scene")
    assert len(scene.graph.nodes_geometry) == 253
    lo, hi = scene.bounds
    assert lo.tolist() == pytest.approx([-6.0, -0.3, -6.0], abs=1e-6)
    assert hi.tolist() == pytest.approx([6.0, 42.0476, 6.0], abs=1e-3)
    assert "Leg_000" in scene.graph.nodes_geometry


def test_it_is_deterministic(tmp_path):
    a, b = make_tower(tmp_path / "a"), make_tower(tmp_path / "b")
    assert a.glb_path.read_bytes() == b.glb_path.read_bytes()
    assert (a.photos_dir / "DJI_0010.JPG").read_bytes() == (b.photos_dir / "DJI_0010.JPG").read_bytes()
    assert a.truth == b.truth and a.poses == b.poses


def test_photos_false_writes_no_jpegs(tmp_path):
    t = make_tower(tmp_path, photos=False)
    assert t.photos_dir is None and not (tmp_path / "photos").exists()


def test_the_frame(tmp_path):
    f = make_tower(tmp_path, photos=False).frame
    assert (
        (f.origin.lat, f.origin.lon, f.origin.ground_alt_m) == (LAT0, LON0, ALT0) == (24.4539, 54.3773, 5.0)
    )
    assert (f.height_m, f.north_offset_deg, f.line_azimuth_deg) == (42.0, 0.0, None)
    assert f.levels == [30.0, 36.0] and f.silhouette[0] == (0.0, 4.243)


def test_the_truth_is_the_kits_six_defects(tmp_path):
    truth = make_tower(tmp_path, photos=False).truth
    assert [(d.id, d.cls, d.severity) for d in truth] == [
        ("D1", "corrosion", 2),
        ("D2", "fastener", 3),
        ("D3", "foreign", 1),
        ("D4", "antenna", 2),
        ("D5", "coating", 1),
        ("D6", "cable", 2),
    ]
    centres = {d.id: d.center for d in truth}
    assert centres["D1"] == pytest.approx((2.37071, 12.0, 2.37071), abs=1e-5)
    assert centres["D2"] == pytest.approx((-1.84571, 21.0, -1.84571), abs=1e-5)
    assert centres["D3"] == pytest.approx((0.5, 30.35, -0.375))
    assert centres["D4"] == pytest.approx((-1.39413, 39.2, 0.28529), abs=1e-5)
    assert centres["D5"] == pytest.approx((2.73485, 6.0, -2.73485), abs=1e-5)
    assert centres["D6"] == pytest.approx((0.965, 27.6, 1.095))


def test_the_sightings_follow_detect_truth(tmp_path):
    truth = make_tower(tmp_path, photos=False).truth
    assert {d.id: len(d.sightings) for d in truth} == COUNTS
    assert sum(COUNTS.values()) == 46
    first = truth[0].sightings[0]
    assert first.image_name == "DJI_0009.JPG"
    assert first.box == pytest.approx((611.0, 867.5, 77.2, 77.2))
    for d in truth:
        for s in d.sightings:
            x, y, w, h = s.box
            assert (
                0 <= x and 0 <= y and x + w <= PHOTO_W + 1e-6 and y + h <= PHOTO_H + 1e-6 and w > 0 and h > 0
            )


def test_truth_zone_and_side_follow_the_derivation_rules(tmp_path):
    t = make_tower(tmp_path, photos=False)
    review = resolve(t.profile_id, t.frame.height_m)
    for d in t.truth:
        got = derive(d.center, None, review, t.frame)
        assert (got.zone, got.side) == (d.zone, d.side), d.id
    assert [(d.zone, d.side) for d in t.truth] == [
        ("body", "NE"),
        ("body", "SW"),
        ("body", "NW"),
        ("antenna", "S"),
        ("body", "NW"),
        ("body", "NE"),
    ]


def test_the_poses_are_the_kits_four_rings(tmp_path):
    poses = make_tower(tmp_path, photos=False).poses
    assert len(poses) == 32
    assert sorted({p["position"][1] for p in poses}) == [7.0, 17.0, 27.0, 38.0]
    assert [p["roll"] for p in poses].count(3.0) == 5  # k % 7 == 3
    p = poses[3]
    assert p["yaw"] == pytest.approx(336.0) and p["pitch"] == pytest.approx(-7.594643368591445)
    assert p["hfov"] == pytest.approx(2 * math.degrees(math.atan(36 / 62)))
    assert math.hypot(p["target"][0], p["target"][2]) < 1e-9  # aimed at the axis


def test_the_photos_read_like_the_importer_reads_them(tmp_path):
    t = make_tower(tmp_path)
    pose = t.poses[3]
    with Image.open(t.photos_dir / "DJI_0004.JPG") as im:
        assert im.size == (1600, 1067)
        capture, lat, lon, alt = read_exif(im)
        cam = read_camera(im, original=True)
    assert capture.isoformat() == "2026-09-20T09:10:21+00:00"
    assert lat == pytest.approx(pose["latitude"], abs=1e-7)
    assert lon == pytest.approx(pose["longitude"], abs=1e-7)
    assert alt == pytest.approx(12.0) == pose["altitude"]
    assert (cam.gimbal_yaw, cam.gimbal_pitch, cam.gimbal_roll, cam.rel_alt) == (-24.0, -7.59, 3.0, 7.0)
    assert cam.focal_mm == 4.5 and cam.sensor_w_mm == pytest.approx(36 * 4.5 / 31)
    assert (cam.orig_w, cam.orig_h) == (1600, 1067)
```

- [ ] **Step 2: Run it to see it fail**

Run: `& $PY -m pytest tests/test_synthetic_tower.py -q`
Expected: `ModuleNotFoundError: No module named 'fixtures.synthetic_tower'`.

- [ ] **Step 3: Implement**

```python
# backend/tests/fixtures/synthetic_tower.py
"""The asset-inspection kit's synthetic telecom tower, generated at test time (spec
2026-10-02-asset-findings A10 and §12; index "Shared fixtures").

A port of the kit's `examples/synthetic-tower/` (the operator's own code, no customer data):
- `make_tower.py`: the 42 m lattice tower GLB with six defects (D1 to D6), same geometry;
- `shoot.py`: 32 camera poses (four rings of eight), same formulas; instead of a WebGL render, each
  photo is a flat sky with a filled disc where each visible defect projects, so no browser is needed;
- `detect_truth.py`: the truth sightings (a box around each visible defect per photo), with the
  occlusion test done by a numpy ray cast (Moller-Trumbore) instead of trimesh's rtree ray engine.

Photos are 1600 x 1067 JPEGs named `DJI_0001.JPG` ... with EXIF GPS (lat, lon, altitude),
FocalLength 4.5 mm and FocalLengthIn35mmFilm 31, and DJI XMP gimbal yaw, pitch and roll, in the
form `app.datasets.prepare.read_exif` and `read_camera` read on import.
"""

from __future__ import annotations

import copy
import functools
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import piexif
import trimesh
from PIL import Image, ImageDraw

from app.asset_review.frame import Frame, Origin, Preset

LAT0, LON0, ALT0 = 24.4539, 54.3773, 5.0
EARTH_R = 6378137.0
PHOTO_W, PHOTO_H = 1600, 1067
FOCAL_MM, F35 = 4.5, 31
HFOV = 2 * math.degrees(math.atan(36 / (2 * F35)))
VFOV = 2 * math.degrees(math.atan(math.tan(math.radians(HFOV / 2)) * PHOTO_H / PHOTO_W))
HEIGHT_M = 42.0
PROFILE_ID = "telecom_tower"
SKY = (159, 183, 207)
STEEL = [150, 156, 162, 255]
CLASS_RGB = {
    "corrosion": (168, 82, 30),
    "fastener": (200, 30, 40),
    "foreign": (96, 72, 40),
    "antenna": (225, 225, 222),
    "coating": (222, 190, 70),
    "cable": (40, 40, 40),
}
XMP = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" '
    'drone-dji:AbsoluteAltitude="{alt:+.3f}" drone-dji:RelativeAltitude="{rel:+.3f}" '
    'drone-dji:GimbalRollDegree="{roll:+.2f}" drone-dji:GimbalYawDegree="{yaw:+.2f}" '
    'drone-dji:GimbalPitchDegree="{pitch:+.2f}" drone-dji:FlightYawDegree="{yaw:+.2f}"/>'
    "</rdf:RDF></x:xmpmeta>"
)

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class TruthSighting:
    image_name: str
    box: tuple[float, float, float, float]  # x, y, w, h in photo pixels, top-left origin


@dataclass(frozen=True)
class TruthFinding:
    id: str
    cls: str  # the kit's telecom-tower class key
    severity: int
    center: Vec3
    radius: float
    note: str
    zone: str  # the telecom_tower zone id at H = 42 m, written out by hand (not computed)
    side: str  # the compass side, written out by hand (not computed)
    sightings: tuple[TruthSighting, ...]


@dataclass(frozen=True)
class Tower:
    glb_path: Path
    frame: Frame
    poses: list[dict]
    truth: list[TruthFinding]
    photos_dir: Path | None
    profile_id: str = PROFILE_ID
    image_size: tuple[int, int] = (PHOTO_W, PHOTO_H)


def _half(y: float) -> float:
    return 3.0 - (3.0 - 0.9) * min(y, 36) / 36


def _corners(y: float) -> list[Vec3]:
    h = _half(y) if y <= 36 else 0.9
    return [(h * sx, y, h * sz) for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1))]


def _on_leg(k: int, y: float, out: float = 0.1) -> list[float]:
    x, _, z = _corners(y)[k]
    n = np.array([x, 0.0, z])
    n /= np.linalg.norm(n)
    return (np.array([x, y, z]) + n * out).tolist()


def _build_parts() -> tuple[list[tuple[str, trimesh.Trimesh]], list[dict]]:
    """`make_tower.py`, statement for statement: parts in the same order, the same truth."""
    parts: list[tuple[str, trimesh.Trimesh]] = []

    def cyl(a, b, r, color, name):
        a, b = np.array(a, float), np.array(b, float)
        v = b - a
        length = np.linalg.norm(v)
        m = trimesh.creation.cylinder(radius=r, height=length, sections=10)
        zax = np.array([0, 0, 1.0])
        d = v / length
        ax = np.cross(zax, d)
        s = np.linalg.norm(ax)
        rot = np.eye(4)
        if s > 1e-9:
            rot[:3, :3] = trimesh.transformations.rotation_matrix(math.atan2(s, np.dot(zax, d)), ax / s)[
                :3, :3
            ]
        elif np.dot(zax, d) < 0:
            rot[:3, :3] = np.diag([1, -1, -1])
        m.apply_transform(rot)
        m.apply_translation((a + b) / 2)
        m.visual.face_colors = color
        parts.append((name, m))

    def box(ext, center, color, name, rot=None):
        m = trimesh.creation.box(extents=ext)
        if rot is not None:
            m.apply_transform(rot)
        m.apply_translation(center)
        m.visual.face_colors = color
        parts.append((name, m))

    levels = [*np.arange(0, 36.01, 3).tolist(), 39, 42]
    for i in range(len(levels) - 1):
        c0, c1 = _corners(levels[i]), _corners(levels[i + 1])
        for k in range(4):
            cyl(c0[k], c1[k], 0.09, STEEL, "Leg")
            a, b = c0[k], c0[(k + 1) % 4]
            c, d = c1[k], c1[(k + 1) % 4]
            cyl(a, d, 0.04, STEEL, "Bracing")
            cyl(b, c, 0.04, STEEL, "Bracing")
            cyl(c, d, 0.05, STEEL, "Horizontal")
    for py in (30, 36):
        h = _half(py) + 0.6
        box([2 * h, 0.08, 2 * h], [0, py, 0], [120, 124, 130, 255], "Platform")
        for sx, sz in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            cyl((h * sx, py, h * sz), (h * sx, py + 1.1, h * sz), 0.03, STEEL, "Handrail")
    ant_truth = []
    for sb in (30, 150, 270):
        for off in (-0.45, 0.45):
            b = math.radians(sb)
            r = 1.35
            cx, cz = r * math.cos(b) - off * math.sin(b), r * math.sin(b) + off * math.cos(b)
            rot = trimesh.transformations.rotation_matrix(-b, [0, 1, 0])
            tilted = sb == 150 and off > 0
            if tilted:
                rot = rot @ trimesh.transformations.rotation_matrix(math.radians(22), [0, 0, 1])
            box([0.14, 1.9, 0.34], [cx, 39.2, cz], [225, 225, 222, 255], "Antenna", rot)
            cyl((0.9 * math.cos(b), 39.2, 0.9 * math.sin(b)), (cx, 39.2, cz), 0.04, STEEL, "Antenna mount")
            if tilted:
                ant_truth.append([cx, 39.2, cz])
    cyl(
        (_half(0) * 0.85, 0.5, _half(0) * 0.85),
        (0.9 * 0.85, 38, 0.9 * 0.85),
        0.05,
        [40, 40, 40, 255],
        "Feeder cable",
    )

    truth: list[dict] = []

    def blob(mesh, p, color, name):
        mesh.apply_translation(p)
        mesh.visual.face_colors = color
        parts.append((name, mesh))

    p = _on_leg(0, 12)
    m = trimesh.creation.icosphere(2, 0.22)
    m.apply_scale([1, 1.6, 1])
    blob(m, p, [168, 82, 30, 255], "Leg")
    truth.append(
        {
            "id": "D1",
            "class": "corrosion",
            "severity": 2,
            "center": p,
            "radius": 0.35,
            "note": "Rust staining on the leg around a bolted splice.",
        }
    )
    p = _on_leg(2, 21)
    blob(trimesh.creation.box(extents=[0.3, 0.3, 0.3]), p, [200, 30, 40, 255], "Leg")
    truth.append(
        {
            "id": "D2",
            "class": "fastener",
            "severity": 3,
            "center": p,
            "radius": 0.25,
            "note": "Splice plate with an empty bolt hole; a bolt appears to be missing.",
        }
    )
    p = [_half(30) * 0.4, 30.35, -_half(30) * 0.3]
    m = trimesh.creation.icosphere(2, 0.4)
    m.apply_scale([1.3, 0.6, 1.1])
    blob(m, p, [96, 72, 40, 255], "Platform")
    truth.append(
        {
            "id": "D3",
            "class": "foreign",
            "severity": 1,
            "center": p,
            "radius": 0.5,
            "note": "Bird nest on the 30 m platform grating.",
        }
    )
    truth.append(
        {
            "id": "D4",
            "class": "antenna",
            "severity": 2,
            "center": ant_truth[0],
            "radius": 0.9,
            "note": "Sector 2 panel is tilted about 20 degrees relative to its neighbour.",
        }
    )
    p = _on_leg(1, 6, 0.12)
    m = trimesh.creation.icosphere(2, 0.3)
    m.apply_scale([1, 2.2, 1])
    blob(m, p, [222, 190, 70, 255], "Leg")
    truth.append(
        {
            "id": "D5",
            "class": "coating",
            "severity": 1,
            "center": p,
            "radius": 0.5,
            "note": "Galvanising breakdown with light white rust on the lower leg.",
        }
    )
    p = [0.9 * 0.85 + 0.35, 27.0, 0.9 * 0.85 + 0.6]
    cyl([0.9 * 0.85 + 0.05, 28.2, 0.9 * 0.85 + 0.05], p, 0.05, [40, 40, 40, 255], "Feeder cable")
    truth.append(
        {
            "id": "D6",
            "class": "cable",
            "severity": 2,
            "center": [0.9 * 0.85 + 0.2, 27.6, 0.9 * 0.85 + 0.33],
            "radius": 0.7,
            "note": "Feeder cable has come out of its clamp and hangs free.",
        }
    )
    box([12, 0.3, 12], [0, -0.15, 0], [170, 164, 150, 255], "Foundation")
    return parts, truth


#: Hand-derived zone and side of each truth centre (telecom_tower, H = 42 m: antenna >= 33.6 m,
#: body 4.2 to 33.6 m; compass sector = floor(bearing / 45 + 0.5)).
TRUTH_ZONE_SIDE = {
    "D1": ("body", "NE"),  # (2.371, 12, 2.371): 45.0 deg
    "D2": ("body", "SW"),  # (-1.846, 21, -1.846): 225.0 deg
    "D3": ("body", "NW"),  # (0.5, 30.35, -0.375): 323.1 deg
    "D4": ("antenna", "S"),  # (-1.394, 39.2, 0.285): 168.4 deg
    "D5": ("body", "NW"),  # (2.735, 6, -2.735): 315.0 deg
    "D6": ("body", "NE"),  # (0.965, 27.6, 1.095): 48.6 deg
}


def _poses() -> list[dict]:
    """`shoot.py`: four rings (7, 17, 27, 38 m) of eight shots looking at the axis, 2 m below level."""
    poses = []
    k = 0
    for h in (7, 17, 27, 38):
        for a in range(0, 360, 45):
            radius = 15 + (h > 30) * 3
            ar = math.radians(a + (h % 10) * 3)
            x, z, y = radius * math.cos(ar), radius * math.sin(ar), float(h)
            yaw = (math.degrees(math.atan2(-z, -x)) + 360) % 360
            pitch = math.degrees(math.atan2(-2.0, radius))
            roll = 3.0 if k % 7 == 3 else 0.0
            pr, yr = math.radians(pitch), math.radians(yaw)
            d = [math.cos(pr) * math.cos(yr), math.sin(pr), math.cos(pr) * math.sin(yr)]
            t = -(x * d[0] + z * d[2]) / (d[0] ** 2 + d[2] ** 2)
            target = [x + d[0] * t, y + d[1] * t, z + d[2] * t]
            up = [0.0, 1.0, 0.0]
            if roll:
                r = math.radians(roll)
                c, s = math.cos(r), math.sin(r)
                kv = sum(d[i] * up[i] for i in range(3))
                cr = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]
                up = [up[i] * c + cr[i] * s + d[i] * kv * (1 - c) for i in range(3)]
            lat = LAT0 + math.degrees(x / EARTH_R)
            lon = LON0 + math.degrees(z / (EARTH_R * math.cos(math.radians(LAT0))))
            name = f"DJI_{k + 1:04d}.JPG"
            poses.append(
                {
                    "id": f"p{k + 1:03d}",
                    "name": name,
                    "source_name": name,
                    "sequence": "1",
                    "position": [x, y, z],
                    "target": target,
                    "up": up,
                    "hfov": HFOV,
                    "vfov": VFOV,
                    "yaw": yaw,
                    "pitch": pitch,
                    "roll": roll,
                    "latitude": lat,
                    "longitude": lon,
                    "altitude": ALT0 + y,
                    "width": PHOTO_W,
                    "height": PHOTO_H,
                    "time": f"2026:09:20 09:{10 + k // 8:02d}:{(k % 8) * 7:02d}",
                    "orientation_source": "gimbal XMP",
                }
            )
            k += 1
    return poses


def _first_hit(tris: np.ndarray, origin: np.ndarray, direction: np.ndarray) -> float:
    """Distance along a unit ray to the nearest triangle (Moller-Trumbore over every triangle), or inf."""
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    p = np.cross(direction, e2)
    det = np.einsum("ij,ij->i", e1, p)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = origin - v0
    u = np.einsum("ij,ij->i", s, p) * inv
    q = np.cross(s, e1)
    v = (q @ direction) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9)
    return float(t[hit].min()) if hit.any() else math.inf


def _sightings(tris: np.ndarray, poses: list[dict], truth: list[dict]) -> dict[str, list[TruthSighting]]:
    """`detect_truth.py`: project each defect into each photo, keep it when it is inside 97% of the
    frame, at least 7 px in radius and not hidden behind other geometry; box = centre +- radius,
    clipped to the photo."""
    out: dict[str, list[TruthSighting]] = {d["id"]: [] for d in truth}
    for p in poses:
        c = np.array(p["position"])
        f = np.array(p["target"]) - c
        f /= np.linalg.norm(f)
        up = np.array(p["up"])
        r = np.cross(f, up)
        r /= np.linalg.norm(r)
        u = np.cross(r, f)
        th, tv = math.tan(math.radians(p["hfov"] / 2)), math.tan(math.radians(p["vfov"] / 2))
        for d in truth:
            x_rel = np.array(d["center"]) - c
            depth = float(x_rel @ f)
            if depth <= 0:
                continue
            x, y = float(x_rel @ r) / depth / th, float(x_rel @ u) / depth / tv
            if abs(x) > 0.97 or abs(y) > 0.97:
                continue
            px, py = (x + 1) / 2 * PHOTO_W, (1 - y) / 2 * PHOTO_H
            rad = d["radius"] / depth / tv * PHOTO_H / 2
            if rad < 7:
                continue
            dist = float(np.linalg.norm(x_rel))
            if _first_hit(tris, c, x_rel / dist) < dist - d["radius"] * 1.1:
                continue
            x0, y0 = max(0.0, round(px - rad, 1)), max(0.0, round(py - rad, 1))
            x1, y1 = min(float(PHOTO_W), round(px + rad, 1)), min(float(PHOTO_H), round(py + rad, 1))
            out[d["id"]].append(TruthSighting(p["name"], (x0, y0, round(x1 - x0, 1), round(y1 - y0, 1))))
    return out


@functools.cache
def _model() -> tuple[bytes, tuple[TruthFinding, ...], tuple[dict, ...]]:
    """Built once per test process: the GLB bytes, the truth and the poses."""
    parts, raw_truth = _build_parts()
    scene = trimesh.Scene()
    for i, (name, m) in enumerate(parts):
        scene.add_geometry(m, node_name=f"{name}_{i:03d}", geom_name=f"g{i:03d}")
    glb = scene.export(file_type="glb")
    tris = trimesh.util.concatenate([m for _, m in parts]).triangles
    poses = _poses()
    seen = _sightings(tris, poses, raw_truth)
    truth = tuple(
        TruthFinding(
            id=d["id"],
            cls=d["class"],
            severity=d["severity"],
            center=(float(d["center"][0]), float(d["center"][1]), float(d["center"][2])),
            radius=d["radius"],
            note=d["note"],
            zone=TRUTH_ZONE_SIDE[d["id"]][0],
            side=TRUTH_ZONE_SIDE[d["id"]][1],
            sightings=tuple(seen[d["id"]]),
        )
        for d in raw_truth
    )
    return glb, truth, tuple(poses)


def _dms(v: float) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]]:
    v = abs(v)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return ((d, 1), (m, 1), (int(round(s * 10000)), 10000))


def _write_photo(path: Path, pose: dict, discs: list[tuple[tuple[float, float, float, float], str]]) -> None:
    im = Image.new("RGB", (PHOTO_W, PHOTO_H), SKY)
    draw = ImageDraw.Draw(im)
    for (x, y, w, h), cls in discs:
        draw.ellipse([x, y, x + w, y + h], fill=CLASS_RGB[cls])
    lat, lon, alt = pose["latitude"], pose["longitude"], pose["altitude"]
    exif = {
        "0th": {piexif.ImageIFD.Make: b"SynthDrone", piexif.ImageIFD.Model: b"KitTest"},
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: pose["time"].encode(),
            piexif.ExifIFD.FocalLength: (45, 10),
            piexif.ExifIFD.FocalLengthIn35mmFilm: F35,
            piexif.ExifIFD.PixelXDimension: PHOTO_W,
            piexif.ExifIFD.PixelYDimension: PHOTO_H,
        },
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
            piexif.GPSIFD.GPSLatitude: _dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
            piexif.GPSIFD.GPSLongitude: _dms(lon),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (int(round(alt * 1000)), 1000),
        },
    }
    yaw = pose["yaw"] if pose["yaw"] <= 180 else pose["yaw"] - 360
    xmp = XMP.format(alt=alt, rel=pose["position"][1], roll=pose["roll"], yaw=yaw, pitch=pose["pitch"])
    im.save(path, "JPEG", quality=85, exif=piexif.dump(exif), xmp=xmp.encode())


def tower_frame() -> Frame:
    return Frame(
        origin=Origin(lat=LAT0, lon=LON0, ground_alt_m=ALT0),
        north_offset_deg=0.0,
        height_m=HEIGHT_M,
        datum_label="Ground",
        datum_note="Synthetic tower; the foundation slab top is 0 m",
        line_azimuth_deg=None,
        silhouette=[(0.0, 4.243), (36.0, 1.273), (42.0, 1.273)],
        levels=[30.0, 36.0],
        presets=[Preset(id="antennas", label="Antennas", target=(0.0, 39.2, 0.0), camera=(8.0, 42.0, 8.0))],
    )


def make_tower(tmp_path: Path, *, photos: bool = True) -> Tower:
    """Write `model.glb` (and with `photos`, `photos/DJI_0001.JPG` ... `DJI_0032.JPG`) under
    `tmp_path`. Deterministic: the same bytes on every call."""
    glb, truth, poses = _model()
    tmp_path.mkdir(parents=True, exist_ok=True)
    glb_path = tmp_path / "model.glb"
    glb_path.write_bytes(glb)
    photos_dir = None
    if photos:
        photos_dir = tmp_path / "photos"
        photos_dir.mkdir(exist_ok=True)
        by_image: dict[str, list] = {}
        for t in truth:
            for s in t.sightings:
                by_image.setdefault(s.image_name, []).append((s.box, t.cls))
        for pose in poses:
            _write_photo(photos_dir / pose["name"], pose, by_image.get(pose["name"], []))
    return Tower(
        glb_path=glb_path,
        frame=tower_frame(),
        poses=copy.deepcopy(list(poses)),
        truth=list(truth),
        photos_dir=photos_dir,
    )
```

- [ ] **Step 4: Run it to see it pass**

Run: `& $PY -m pytest tests/test_synthetic_tower.py -q --durations=3`
Expected: `10 passed`, the slowest test under 2 s.

If `test_the_sightings_follow_detect_truth` reports different counts, the geometry or the poses drifted from the kit; compare `_build_parts` and `_poses` with `examples/synthetic-tower/make_tower.py` and `shoot.py` in the kit (`C:\Users\D\Claude_Workspace\outputs\Kestrel AI Reference Pack\asset-inspection-kit\`) line by line. Do not change the expected numbers.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff check tests/fixtures/synthetic_tower.py tests/test_synthetic_tower.py
& $PY -m ruff format --check tests/fixtures/synthetic_tower.py tests/test_synthetic_tower.py
git add backend/tests/fixtures/synthetic_tower.py backend/tests/test_synthetic_tower.py
git commit -m "test(asset-review): shared synthetic tower generator ported from the kit (P1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gate and land

- [ ] **Step 1: The full gate** (AGENTS.md), from the worktree root:

```powershell
pnpm -C contract check
cd backend; & $PY -m ruff check .; & $PY -m ruff format --check .; & $PY -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. `cargo test` is skipped: this unit does not touch the sidecar, and a fresh worktree has no frozen binary.

- [ ] **Step 2: No customer data.** `git diff main --stat` lists only the files named in Tasks 1 to 7. The fixture JSON and the generator hold only made-up shapes and the kit's synthetic tower.

- [ ] **Step 3: Land.** Run `scripts\finish-task.ps1` from the worktree. If it fails on Windows PowerShell 5.1 (memory: nested-unit-controllers), run the gate by hand as in Step 1, then from the main checkout `git merge --ff-only task/af-p1`; remove the worktree junction-safely (list `Get-ChildItem <wt> -Recurse -Force -Directory | Where-Object LinkType`, delete each link as a link with `[System.IO.Directory]::Delete(path, $false)`, then `git worktree remove --force` and `git worktree prune`), delete the branch with `git branch -d task/af-p1`, and check `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` still exists.

- [ ] **Step 4: Operator walkthrough.** Not user-observable: P1 adds pure modules, a test fixture and a contract shape; nothing in the app changes until J1, U5 and R1 use them.

---

## Self-review

**Spec coverage for P1:**
- §5.1 `frame`: `Frame` with every listed field; the north offset and line azimuth senses are fixed in Task 1 and recorded below.
- §5.1 `review`: `ReviewConfig` has every listed field (`profile_id, finding_unit, placement, patch_grid, cluster_m, zones [{id, label, min_m, max_m}], sides {type, labels, basis}, focus {frustum, oblique_deg}, report {pages, min_severity}`) plus the report texts §7 says a profile carries.
- §7 table: all five profiles with their unit, placement, zones and sides; `building_facade` keeps grid 14 and cluster 1.5 m; compass for `stack`, `tank`, `telecom_tower`; faces by normal for `building_facade`; faces relative to the line for `ohtl_tower`.
- §7 rules: bearing `atan2(z, x)`, the normal rule with the strict 0.3 horizontal threshold, height = centre y, unplaced has no height (Task 3 tests `test_an_unplaced_point_has_no_height_side_or_zone`).
- §9 findings map: one geometry in Python and TS, one shared fixture, parity on both sides (Tasks 4 and 5).
- §12: synthetic tower generated at test time (Task 7); findings map parity (Tasks 4 and 5).
- Review Focus: the index assigns no Review Focus test to P1.

**Placeholder scan:** every step has its full code or command; the only conditional is Task 6's "if C0 already wrote exactly this block", whose outcome the test decides.

**Type consistency:** `Frame`, `ReviewConfig`, `Derived`, `MapDot`, `Tower` and `TruthFinding` are named the same in every task, in the index table and in the tests.

**Last task is the gate:** Task 8.

## Index notes

1. **`ReviewConfig` has more fields than spec §5.1 lists:** `name`, `asset_noun`, `finding_noun`, `assessment_title`, `sides.title`, `sides.noun`, `component_map`, `facts`, `limits`, `breakdowns`, `footer_disclaimer`. §7 says each profile carries the report settings and limits text, and J3 (`component_map`) and R1 (facts, limits, titles) need them. Task 6 aligns the contract; if C0 has not yet written `AssetFrame` and `AssetReviewConfig`, it should use Task 6's block as is, and Task 6 then only adds the test.
2. **Frame angle senses** (the spec names the fields only): `north_offset_deg` is the true bearing of plant north; `line_azimuth_deg` is a true bearing. Compass sides use the true bearing; stored `bearing_deg` stays the plant bearing (the frame rule in Global Constraints). J2 converts a GPS offset with `true_to_plant(north_m, east_m, frame.north_offset_deg)`. Every kit job has offset 0, so imports are unaffected.
3. **Zone open ends are `null`**, not the kit's +-1e9, in `review.zones` and the contract.
4. **Side rounding is half up** (`floor(x + 0.5)`) where the kit used Python's half-to-even `round`; they differ only on an exact sector boundary.
5. **`Tower` has three fields beyond the index's four:** `photos_dir`, `profile_id`, `image_size`; and `make_tower` takes `photos: bool = True`. `TruthFinding` carries its `sightings` (image name and box), which J3, J4 and X need to draw boxes.
6. **`derive.py` exports more than `derive`:** `side_of`, `zone_of`, `bearing_of`, `component_name`, `NOT_PLACED`. `MapDot` is a frozen dataclass `(id, height_m, bearing_deg, severity)`.

## Spec gaps found while planning

- **`rtree` is not installed** in `backend/.venv`, and trimesh's ray engine needs it: `mesh.ray.intersects_id` raises `ModuleNotFoundError: No module named 'rtree'` (checked 2026-10-03 on `main`). The index's Tech Stack says "trimesh (rtree; embree when present) ... (all present)". J3's ray casting and J1 (if it ray casts) need `rtree` added under the overlay-venv rule (requirements, the PyInstaller spec, `build.ps1` and `smoke_frozen.ps1`), or a numpy caster like Task 7's. P1 avoids it.
- The spec does not say whether compass sides are true or plant bearings when `north_offset_deg` is not 0. Index note 2 fixes it.
