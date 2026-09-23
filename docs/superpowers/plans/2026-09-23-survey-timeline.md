# Survey Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a project's object counts per class over time, one row per survey (map), from the counts that map detection runs already store, marking any survey counted with a different model or confidence as not comparable.

**Architecture:** One nullable `captured_on` date on `geo_map` (read from `TIFFTAG_DATETIME` at import, editable by `PATCH`), a pure selection/delta service over existing `GeoMap`/`MapRun` rows, one read-only `GET /survey-timeline` endpoint, and a new `Surveys` screen with an inline-SVG chart and a table. No new job, no new detector, no geometry.

**Tech Stack:** Python 3.11 (FastAPI, SQLAlchemy 2.0, Alembic, pytest, ruff) in `backend/.venv` · TypeScript/React 18 (Vite, Vitest, Playwright, zustand) via pnpm · `contract/openapi.yaml` + `openapi-typescript`

**Spec:** `docs/superpowers/specs/2026-09-23-survey-timeline-design.md`

## Global Constraints

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same change, never hand-edited.
- Stage by path (`git add <paths>`); never `git add -A`. Commit identity is `Danijel Jovanovic <info@synapse-solutions.ai>`.
- Backend commands run against the main checkout's interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. A worktree has no venv of its own.
- The alembic chain is linear. At the time of writing the head is `0005_maps`; **check `backend/app/db/migrations/versions/` for the real head before writing the migration** and chain onto it. Other sessions are merging.
- A migration that cannot fail cannot stop the app starting: add nullable columns, no data backfill.
- No domain words. The UI says "objects", "surveys", "classes" — never "machines"/"machinery".
- Design system only: components from `frontend/src/ui` (`Alert`, `Button`, `EmptyState`, `Pill`, `Segmented`, `SkeletonRows`, `Select`, `Field`, `Icon`). `frontend/scripts/check-tokens.mjs` rejects raw palette colours.
- Gate before merge: `pnpm -C contract check`; `ruff check .`, `ruff format --check .`, `pytest` in `backend`; `pnpm -C frontend lint test build e2e`; `cargo test` only if the frozen sidecar exists.

---

### Task 1: `captured_on` on a map (column, schema, PATCH)

The survey date is the one fact the timeline needs that nothing stores today. `created_at` is when the file was imported, which is not when the site was flown.

**Files:**
- Create: `backend/app/db/migrations/versions/<next>_map_captured_on.py`
- Modify: `backend/app/db/models.py` (`GeoMap`, after `gsd_cm`), `backend/app/maps/schemas.py` (`GeoMapOut`), `backend/app/maps/service.py`, `backend/app/maps/router.py`
- Test: `backend/tests/test_maps_api.py` (append; create only if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `GeoMap.captured_on: date | None`; `GeoMapOut.captured_on: date | None`; `service.set_captured_on(handle: ProjectHandle, map_id: str, captured_on: date | None) -> GeoMap`; `PATCH /api/v1/projects/{projectId}/maps/{mapId}` accepting `{"captured_on": "2026-04-15" | null}` and returning `GeoMapOut`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_maps_api.py`:

```python
def test_captured_on_is_set_cleared_and_validated(client, project_id, map_row):
    url = f"/api/v1/projects/{project_id}/maps/{map_row.id}"
    assert client.get(url).json()["captured_on"] is None

    r = client.patch(url, json={"captured_on": "2026-04-15"})
    assert r.status_code == 200, r.text
    assert r.json()["captured_on"] == "2026-04-15"
    assert client.get(url).json()["captured_on"] == "2026-04-15"

    assert client.patch(url, json={"captured_on": None}).json()["captured_on"] is None
    assert client.patch(url, json={"captured_on": "15/04/2026"}).status_code == 422
```

If `map_row` does not already exist as a fixture in that file, add it above the test:

```python
@pytest.fixture
def map_row(handle):
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name="survey A", status="ready", source_path="E:/nowhere/a.tif", source_size=1)
        s.add(row)
        s.flush()
        s.expunge(row)
    return row
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_api.py -k captured_on -v` from `backend`.
Expected: FAIL — `KeyError: 'captured_on'` (or 405 on the PATCH).

- [ ] **Step 3: Add the column and the migration**

In `backend/app/db/models.py`, inside `class GeoMap`, directly after the `gsd_cm` line:

```python
    # When the imagery was flown, not when the file was imported. Null until known.
    captured_on: Mapped[date | None] = mapped_column(Date, nullable=True)
```

Add `Date` to the existing `sqlalchemy` import list and `date` to the `datetime` import at the top of the file.

Create the migration (file name and revision use the next number after the real head):

```python
"""map captured_on

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, no backfill: a migration that cannot fail cannot stop the app opening.
    op.add_column("geo_map", sa.Column("captured_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.execute("ALTER TABLE geo_map DROP COLUMN captured_on")
```

- [ ] **Step 4: Expose it in the schema and the service**

In `backend/app/maps/schemas.py`, add to `GeoMapOut` after `gsd_cm: float | None`:

```python
    captured_on: date | None
```

add `from datetime import date, datetime` at the top, and in `GeoMapOut.from_row` add `captured_on=row.captured_on,` next to `gsd_cm=...`. Then add the request model beside the other maps schemas:

```python
class GeoMapPatch(BaseModel):
    """Only `captured_on` is editable; a date the operator corrects by hand."""

    captured_on: date | None = None
```

In `backend/app/maps/service.py`, after `get_map`:

```python
def set_captured_on(handle: ProjectHandle, map_id: str, captured_on: date | None) -> GeoMap:
    with handle.session() as s:
        row = _get(s, map_id)
        row.captured_on = captured_on
        s.flush()
        s.expunge(row)
    return row
```

with `from datetime import date` added to its imports.

- [ ] **Step 5: Add the PATCH handler**

In `backend/app/maps/router.py`, directly after `get_map`:

```python
@router.patch("/maps/{mapId}", response_model=GeoMapOut)
def patch_map(  # noqa: N803
    mapId: str,
    body: GeoMapPatch,
    handle: ProjectHandle = Depends(get_project),
) -> GeoMapOut:
    return GeoMapOut.from_row(service.set_captured_on(handle, mapId, body.captured_on))
```

and add `GeoMapPatch` to the `from app.maps.schemas import (...)` list.

- [ ] **Step 6: Run the test to verify it passes**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_api.py -k captured_on -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0006_map_captured_on.py backend/app/maps/schemas.py backend/app/maps/service.py backend/app/maps/router.py backend/tests/test_maps_api.py
git commit -m "feat(maps): a map carries the date its imagery was flown"
```

---

### Task 2: Read the survey date from the GeoTIFF

**Files:**
- Modify: `backend/app/maps/raster.py` (`RasterInfo`, `inspect_raster`), `backend/app/maps/jobs_import.py` (the row update block)
- Test: `backend/tests/test_maps_raster.py` (append; create only if absent)

**Interfaces:**
- Consumes: `GeoMap.captured_on` from Task 1.
- Produces: `RasterInfo.captured_on: date | None`, filled by `inspect_raster` from the raster's `TIFFTAG_DATETIME` tag; `run_map_import` writes it to the row.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_maps_raster.py`:

```python
def test_inspect_raster_reads_the_capture_date_from_tifftag_datetime(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    import numpy as np

    path = tmp_path / "ortho.tif"
    with rasterio.open(path, "w", driver="GTiff", width=4, height=4, count=1, dtype="uint8") as dst:
        dst.write(np.zeros((1, 4, 4), dtype="uint8"))
        dst.update_tags(TIFFTAG_DATETIME="2026:04:15 07:30:00")
    assert raster.inspect_raster(path).captured_on == date(2026, 4, 15)


def test_inspect_raster_without_the_tag_reports_no_capture_date(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    import numpy as np

    path = tmp_path / "plain.tif"
    with rasterio.open(path, "w", driver="GTiff", width=4, height=4, count=1, dtype="uint8") as dst:
        dst.write(np.zeros((1, 4, 4), dtype="uint8"))
    assert raster.inspect_raster(path).captured_on is None
```

with `from datetime import date` and `from app.maps import raster` at the top of the file if absent.

- [ ] **Step 2: Run the test to verify it fails**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_raster.py -k capture_date -v`
Expected: FAIL — `AttributeError: 'RasterInfo' object has no attribute 'captured_on'`.

- [ ] **Step 3: Implement**

In `backend/app/maps/raster.py`, add to `RasterInfo`:

```python
    captured_on: date | None = None
```

(`from datetime import date` at the top). Add the parser above `inspect_raster`:

```python
def _captured_on(tags: dict) -> date | None:
    """TIFFTAG_DATETIME is "YYYY:MM:DD HH:MM:SS". An unreadable value is no date, never an error."""
    raw = (tags.get("TIFFTAG_DATETIME") or "").strip()
    try:
        return datetime.strptime(raw[:10], "%Y:%m:%d").date()
    except ValueError:
        return None
```

(`from datetime import date, datetime`). Inside `inspect_raster`'s `with rasterio.open(path) as src:` block, after the `info = (...)` line:

```python
                captured_on = _captured_on(src.tags())
```

and pass it through the return: `return RasterInfo(*info, crs_wkt=crs_wkt, epsg=epsg, proj4=proj4, geotransform=geotransform, captured_on=captured_on)`.

In `backend/app/maps/jobs_import.py`, in the `with ctx.project.session() as s:` block that sets the row fields, after `row.gsd_cm = ...`:

```python
        # Only fill it in; never overwrite a date the operator has corrected by hand.
        if row.captured_on is None:
            row.captured_on = info.captured_on
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_raster.py -v`
Expected: PASS (or skipped where `rasterio` is unavailable).

- [ ] **Step 5: Commit**

```bash
git add backend/app/maps/raster.py backend/app/maps/jobs_import.py backend/tests/test_maps_raster.py
git commit -m "feat(maps): import reads the capture date from TIFFTAG_DATETIME"
```

---

### Task 3: The timeline service (pure selection and deltas)

The whole judgement of the feature lives here: which run represents a survey, and which surveys may be subtracted from each other.

**Files:**
- Create: `backend/app/maps/timeline.py`, `backend/tests/test_maps_timeline.py`

**Interfaces:**
- Consumes: `GeoMap`, `MapRun` rows.
- Produces:

```python
@dataclass(frozen=True)
class Basis:
    model_id: str | None
    model_name: str | None
    conf: float

@dataclass(frozen=True)
class Survey:
    map_id: str
    map_name: str
    captured_on: date | None
    date_is_import_date: bool
    run_id: str | None
    model_name: str | None
    conf: float | None
    counts: dict[str, int]
    deltas: dict[str, int]
    state: str          # "ok" | "not_comparable" | "not_counted"
    reason: str | None

def choose_basis(runs: list[MapRun]) -> Basis | None: ...
def build_timeline(maps: list[GeoMap], runs_by_map: dict[str, list[MapRun]], basis: Basis | None) -> list[Survey]: ...
```

Ordering: oldest first by `(captured_on or created_at.date(), created_at)`; deltas compare each `ok` survey with the previous `ok` survey.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_maps_timeline.py`:

```python
"""The timeline's judgement: which run speaks for a survey, and what may be subtracted."""

from datetime import UTC, date, datetime

from app.db.models import GeoMap, MapRun
from app.maps.timeline import Basis, build_timeline, choose_basis


def _map(name, captured=None, created=1):
    return GeoMap(
        id=f"m-{name}",
        name=name,
        status="ready",
        source_path="x",
        source_size=1,
        captured_on=captured,
        created_at=datetime(2026, 1, created, tzinfo=UTC),
    )


def _run(map_id, model_id="mod-a", conf=0.25, counts=None, created=1, name="v1"):
    return MapRun(
        id=f"r-{map_id}-{created}",
        map_id=map_id,
        kind="local_model",
        model_id=model_id,
        model_name=name,
        conf=conf,
        counts=counts or {},
        created_at=datetime(2026, 2, created, tzinfo=UTC),
    )


def test_basis_is_the_newest_runs_model_and_confidence():
    runs = [_run("a", model_id="old", conf=0.4, created=1), _run("b", model_id="new", conf=0.25, created=9)]
    assert choose_basis(runs) == Basis(model_id="new", model_name="v1", conf=0.25)


def test_no_runs_at_all_has_no_basis():
    assert choose_basis([]) is None


def test_surveys_are_ordered_oldest_first_and_deltas_follow_the_order():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1))]
    runs = {"m-april": [_run("m-april", counts={"c1": 5})], "m-may": [_run("m-may", counts={"c1": 8})]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert [s.map_name for s in out] == ["april", "may"]
    assert out[0].deltas == {} and out[1].deltas == {"c1": 3}


def test_a_run_on_another_model_is_marked_and_skipped_by_deltas():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1)), _map("june", date(2026, 6, 1))]
    runs = {
        "m-april": [_run("m-april", counts={"c1": 5})],
        "m-may": [_run("m-may", model_id="other", name="v2", counts={"c1": 50})],
        "m-june": [_run("m-june", counts={"c1": 6})],
    }
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[1].state == "not_comparable" and "different model" in out[1].reason
    assert out[1].deltas == {}
    # June compares with April, the previous comparable survey - never with the odd one out.
    assert out[2].deltas == {"c1": 1}


def test_a_matching_run_wins_over_a_newer_run_on_another_model():
    maps = [_map("april", date(2026, 4, 1))]
    runs = {"m-april": [_run("m-april", counts={"c1": 5}, created=1), _run("m-april", model_id="other", counts={"c1": 99}, created=5)]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "ok" and out[0].counts == {"c1": 5}


def test_a_confidence_mismatch_says_so():
    maps = [_map("april", date(2026, 4, 1))]
    runs = {"m-april": [_run("m-april", conf=0.4, counts={"c1": 5})]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "not_comparable" and "0.4" in out[0].reason and "0.25" in out[0].reason


def test_a_map_with_no_runs_is_not_counted_yet():
    out = build_timeline([_map("april", date(2026, 4, 1))], {}, Basis("mod-a", "v1", 0.25))
    assert out[0].state == "not_counted" and out[0].counts == {} and out[0].run_id is None


def test_a_map_without_a_capture_date_falls_back_to_its_import_date():
    out = build_timeline([_map("april", None, created=7)], {}, Basis("mod-a", "v1", 0.25))
    assert out[0].captured_on == date(2026, 1, 7) and out[0].date_is_import_date is True


def test_a_class_absent_from_the_earlier_survey_has_no_delta():
    maps = [_map("april", date(2026, 4, 1)), _map("may", date(2026, 5, 1))]
    runs = {"m-april": [_run("m-april", counts={"c1": 5})], "m-may": [_run("m-may", counts={"c1": 5, "c2": 3})]}
    out = build_timeline(maps, runs, Basis("mod-a", "v1", 0.25))
    assert out[1].deltas == {"c1": 0}  # c2 did not exist to be counted, so it gets no delta
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_timeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.maps.timeline'`.

- [ ] **Step 3: Implement**

Create `backend/app/maps/timeline.py`:

```python
"""Counts over time across a project's maps (spec 2026-09-23-survey-timeline §4).

Every number here was computed elsewhere: `MapRun.counts` is written by a detection run. This module
only decides which run speaks for a survey and which surveys may be compared, so a change of model
can never read as a change on the ground.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.db.models import GeoMap, MapRun


@dataclass(frozen=True)
class Basis:
    model_id: str | None
    model_name: str | None
    conf: float


@dataclass(frozen=True)
class Survey:
    map_id: str
    map_name: str
    captured_on: date | None
    date_is_import_date: bool
    run_id: str | None
    model_name: str | None
    conf: float | None
    counts: dict[str, int] = field(default_factory=dict)
    deltas: dict[str, int] = field(default_factory=dict)
    state: str = "not_counted"
    reason: str | None = None


def choose_basis(runs: list[MapRun]) -> Basis | None:
    """The newest run's model and confidence: what "comparable" means until the operator says otherwise."""
    newest = max(runs, key=lambda r: r.created_at, default=None)
    if newest is None:
        return None
    return Basis(model_id=newest.model_id, model_name=newest.model_name, conf=newest.conf)


def _survey_date(m: GeoMap) -> tuple[date, bool]:
    return (m.captured_on, False) if m.captured_on else (m.created_at.date(), True)


def _pick(runs: list[MapRun], basis: Basis) -> tuple[MapRun | None, str | None]:
    """The newest run on the basis; failing that the newest run at all, with what differs."""
    matching = [r for r in runs if r.model_id == basis.model_id and r.conf == basis.conf]
    if matching:
        return max(matching, key=lambda r: r.created_at), None
    if not runs:
        return None, None
    newest = max(runs, key=lambda r: r.created_at)
    if newest.model_id != basis.model_id:
        return newest, f"different model ({newest.model_name or 'unknown'}, not {basis.model_name or 'unknown'})"
    return newest, f"confidence {newest.conf} vs {basis.conf}"


def build_timeline(
    maps: list[GeoMap], runs_by_map: dict[str, list[MapRun]], basis: Basis | None
) -> list[Survey]:
    ordered = sorted(maps, key=lambda m: (_survey_date(m)[0], m.created_at))
    out: list[Survey] = []
    previous: dict[str, int] | None = None
    for m in ordered:
        when, from_import = _survey_date(m)
        runs = runs_by_map.get(m.id, [])
        run, reason = _pick(runs, basis) if basis else (None, None)
        counts = dict(run.counts or {}) if run else {}
        state = "not_counted" if run is None else ("not_comparable" if reason else "ok")
        deltas: dict[str, int] = {}
        if state == "ok" and previous is not None:
            # A class missing from the earlier survey gets no delta: it did not exist to be counted.
            deltas = {c: n - previous[c] for c, n in counts.items() if c in previous}
        out.append(
            Survey(
                map_id=m.id,
                map_name=m.name,
                captured_on=when,
                date_is_import_date=from_import,
                run_id=run.id if run else None,
                model_name=run.model_name if run else None,
                conf=run.conf if run else None,
                counts=counts,
                deltas=deltas,
                state=state,
                reason=reason,
            )
        )
        if state == "ok":
            previous = counts
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_timeline.py -v`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/maps/timeline.py backend/tests/test_maps_timeline.py
git commit -m "feat(maps): survey timeline selection and deltas"
```

---

### Task 4: Contract for the timeline endpoint

**Files:**
- Modify: `contract/openapi.yaml`, `contract/client/schema.d.ts` (generated)

**Interfaces:**
- Consumes: the `Survey` shape from Task 3.
- Produces: `GET /api/v1/projects/{projectId}/survey-timeline` → `SurveyTimeline`; `PATCH /api/v1/projects/{projectId}/maps/{mapId}` → `GeoMap`; `GeoMap.captured_on`.

- [ ] **Step 1: Add the PATCH and the timeline path**

In `contract/openapi.yaml`, under `/api/v1/projects/{projectId}/maps/{mapId}`, after the `get:` block:

```yaml
    patch:
      tags: [maps]
      operationId: patchMap
      summary: Correct the survey date (when the imagery was flown, not when it was imported).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/GeoMapPatch" }
      responses:
        "200":
          description: the updated map
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GeoMap" }
        default: { $ref: "#/components/responses/Error" }
```

Add the new path beside the other project paths (alphabetical order is not enforced; put it after the `map-runs` block):

```yaml
  /api/v1/projects/{projectId}/survey-timeline:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [maps]
      operationId: getSurveyTimeline
      summary: Counts per class for every survey (map) of this project, oldest first, with the change since the previous comparable survey.
      parameters:
        - { name: model_id, in: query, schema: { type: string }, description: compare on this model instead of the newest run's }
        - { name: conf, in: query, schema: { type: number, minimum: 0, maximum: 1 }, description: compare at this confidence instead of the newest run's }
      responses:
        "200":
          description: the timeline
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SurveyTimeline" }
              example:
                basis: { model_id: "m0000000-2222-4000-8000-000000000001", model_name: "yolo11m-coco", conf: 0.25 }
                classes:
                  - { id: "c1a2b3c4-0000-4000-8000-000000000001", name: "excavator", colour: "#f97316" }
                surveys:
                  - map_id: "9a7b6c5d-0000-4000-8000-000000000001"
                    map_name: "April survey"
                    captured_on: "2026-04-15"
                    date_is_import_date: false
                    run_id: "5e4d3c2b-0000-4000-8000-000000000001"
                    model_name: "yolo11m-coco"
                    conf: 0.25
                    counts: { "c1a2b3c4-0000-4000-8000-000000000001": 12 }
                    deltas: {}
                    state: ok
                    reason: null
                  - map_id: "9a7b6c5d-0000-4000-8000-000000000002"
                    map_name: "May survey"
                    captured_on: "2026-05-20"
                    date_is_import_date: false
                    run_id: "5e4d3c2b-0000-4000-8000-000000000002"
                    model_name: "yolo11m-coco"
                    conf: 0.25
                    counts: { "c1a2b3c4-0000-4000-8000-000000000001": 15 }
                    deltas: { "c1a2b3c4-0000-4000-8000-000000000001": 3 }
                    state: ok
                    reason: null
        default: { $ref: "#/components/responses/Error" }
```

In `components.schemas`, add `captured_on: { type: string, format: date, nullable: true }` to the existing `GeoMap` schema (and to its `required` list if that schema lists every field — match the file's existing style), then add:

```yaml
    GeoMapPatch:
      type: object
      additionalProperties: false
      properties:
        captured_on: { type: string, format: date, nullable: true, description: when the imagery was flown; null clears it }
    SurveyBasis:
      type: object
      required: [model_id, model_name, conf]
      properties:
        model_id: { type: string, nullable: true }
        model_name: { type: string, nullable: true }
        conf: { type: number }
    SurveyClass:
      type: object
      required: [id, name, colour]
      properties:
        id: { type: string }
        name: { type: string }
        colour: { type: string }
    Survey:
      type: object
      required: [map_id, map_name, captured_on, date_is_import_date, run_id, model_name, conf, counts, deltas, state, reason]
      properties:
        map_id: { type: string }
        map_name: { type: string }
        captured_on: { type: string, format: date, nullable: true }
        date_is_import_date: { type: boolean, description: the date shown is the import date because the survey date is unknown }
        run_id: { type: string, nullable: true }
        model_name: { type: string, nullable: true }
        conf: { type: number, nullable: true }
        counts: { type: object, additionalProperties: { type: integer } }
        deltas: { type: object, additionalProperties: { type: integer } }
        state: { type: string, enum: [ok, not_comparable, not_counted] }
        reason: { type: string, nullable: true }
    SurveyTimeline:
      type: object
      required: [basis, classes, surveys]
      properties:
        basis: { $ref: "#/components/schemas/SurveyBasis", nullable: true }
        classes:
          type: array
          items: { $ref: "#/components/schemas/SurveyClass" }
        surveys:
          type: array
          items: { $ref: "#/components/schemas/Survey" }
```

- [ ] **Step 2: Regenerate the client and lint the contract**

Run: `pnpm -C contract check`
Expected: Spectral reports no errors; `generate` rewrites `contract/client/schema.d.ts`; the `git diff --exit-code` step of `check` FAILS the first time because the generated file changed. That failure is expected here — it is the signal to commit the regenerated file.

- [ ] **Step 3: Confirm the generated types exist**

Run: `grep -n "SurveyTimeline\|GeoMapPatch" contract/client/schema.d.ts | head`
Expected: both names appear.

- [ ] **Step 4: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts
git commit -m "docs(contract): survey timeline and map patch"
```

---

### Task 5: The timeline endpoint

**Files:**
- Modify: `backend/app/maps/router.py`, `backend/app/maps/schemas.py`, `backend/app/maps/service.py`
- Test: `backend/tests/test_maps_timeline_api.py` (create)

**Interfaces:**
- Consumes: `timeline.build_timeline`, `timeline.choose_basis` (Task 3); `GeoMapPatch` (Task 1).
- Produces: `GET /api/v1/projects/{projectId}/survey-timeline?model_id=&conf=` → `SurveyTimelineOut`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_maps_timeline_api.py`:

```python
"""The timeline endpoint over real rows: ordering, deltas, and the honest markers."""

from datetime import UTC, date, datetime

import pytest

from app.db.models import GeoMap, MapRun

BASE = "/api/v1/projects"


@pytest.fixture
def three_surveys(handle):
    """April and June counted with the same model; May with another one."""
    with handle.session() as s:
        for i, (name, when) in enumerate(
            [("April", date(2026, 4, 1)), ("May", date(2026, 5, 1)), ("June", date(2026, 6, 1))], start=1
        ):
            s.add(
                GeoMap(
                    id=f"map-{i}",
                    name=name,
                    status="ready",
                    source_path=f"E:/nowhere/{i}.tif",
                    source_size=1,
                    captured_on=when,
                    created_at=datetime(2026, 1, i, tzinfo=UTC),
                )
            )
        for i, (map_id, model, counts) in enumerate(
            [("map-1", "mod-a", {"c1": 5}), ("map-2", "mod-b", {"c1": 50}), ("map-3", "mod-a", {"c1": 9})], start=1
        ):
            s.add(
                MapRun(
                    id=f"run-{i}",
                    map_id=map_id,
                    kind="local_model",
                    model_id=model,
                    model_name=model,
                    conf=0.25,
                    counts=counts,
                    created_at=datetime(2026, 2, i, tzinfo=UTC),
                )
            )


def test_timeline_is_oldest_first_with_deltas_between_comparable_surveys(client, project_id, three_surveys):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    # The newest run is June's (mod-a), so that is the basis.
    assert body["basis"]["model_name"] == "mod-a"
    names = [s["map_name"] for s in body["surveys"]]
    assert names == ["April", "May", "June"]
    assert body["surveys"][1]["state"] == "not_comparable"
    assert body["surveys"][2]["deltas"] == {"c1": 4}  # June minus April, skipping May


def test_the_basis_can_be_chosen(client, project_id, three_surveys):
    body = client.get(f"{BASE}/{project_id}/survey-timeline", params={"model_id": "mod-b", "conf": 0.25}).json()
    assert body["basis"]["model_id"] == "mod-b"
    assert [s["state"] for s in body["surveys"]] == ["not_comparable", "ok", "not_comparable"]


def test_a_project_with_no_maps_returns_an_empty_timeline(client, project_id):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    assert body == {"basis": None, "classes": body["classes"], "surveys": []}


def test_the_timeline_carries_the_project_classes_for_the_chart(client, project_id, three_surveys):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    assert len(body["classes"]) == 8
    assert {"id", "name", "colour"} <= set(body["classes"][0])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_timeline_api.py -v`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the schemas**

In `backend/app/maps/schemas.py`:

```python
class SurveyBasisOut(BaseModel):
    model_id: str | None
    model_name: str | None
    conf: float


class SurveyClassOut(BaseModel):
    id: str
    name: str
    colour: str


class SurveyOut(BaseModel):
    map_id: str
    map_name: str
    captured_on: date | None
    date_is_import_date: bool
    run_id: str | None
    model_name: str | None
    conf: float | None
    counts: dict[str, int]
    deltas: dict[str, int]
    state: Literal["ok", "not_comparable", "not_counted"]
    reason: str | None


class SurveyTimelineOut(BaseModel):
    basis: SurveyBasisOut | None
    classes: list[SurveyClassOut]
    surveys: list[SurveyOut]
```

- [ ] **Step 4: Add the service query**

In `backend/app/maps/service.py`:

```python
def timeline_rows(handle: ProjectHandle) -> tuple[list[GeoMap], dict[str, list[MapRun]]]:
    """Every map of the project with its runs. Bounded: tens of rows, and no detections."""
    with handle.session() as s:
        maps = list(s.execute(select(GeoMap)).scalars())
        runs = list(s.execute(select(MapRun)).scalars())
        for row in (*maps, *runs):
            s.expunge(row)
    by_map: dict[str, list[MapRun]] = {}
    for r in runs:
        by_map.setdefault(r.map_id, []).append(r)
    return maps, by_map
```

(add `MapRun` to the model imports if absent).

- [ ] **Step 5: Add the handler**

In `backend/app/maps/router.py`:

```python
@router.get("/survey-timeline", response_model=SurveyTimelineOut)
def get_survey_timeline(
    model_id: str | None = None,
    conf: float | None = None,
    handle: ProjectHandle = Depends(get_project),
) -> SurveyTimelineOut:
    maps, runs_by_map = service.timeline_rows(handle)
    all_runs = [r for rs in runs_by_map.values() for r in rs]
    basis = timeline.choose_basis(all_runs)
    if model_id is not None or conf is not None:
        chosen = next((r for r in all_runs if r.model_id == model_id), None)
        basis = timeline.Basis(
            model_id=model_id if model_id is not None else (basis.model_id if basis else None),
            model_name=chosen.model_name if chosen else (basis.model_name if basis else None),
            conf=conf if conf is not None else (basis.conf if basis else 0.25),
        )
    with handle.session() as s:
        classes = [
            SurveyClassOut(id=c["id"], name=c["name"], colour=c["colour"]) for c in handle.row(s).classes
        ]
    return SurveyTimelineOut(
        basis=SurveyBasisOut(**vars(basis)) if basis else None,
        classes=classes,
        surveys=[SurveyOut(**vars(s_)) for s_ in timeline.build_timeline(maps, runs_by_map, basis)],
    )
```

with `from app.maps import timeline` and the new schema names added to the imports.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_maps_timeline_api.py tests/test_maps_timeline.py -v`
Expected: PASS.

- [ ] **Step 7: Run the whole backend suite and lint**

Run from `backend`: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . && E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check . && E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/maps/router.py backend/app/maps/schemas.py backend/app/maps/service.py backend/tests/test_maps_timeline_api.py
git commit -m "feat(maps): survey timeline endpoint"
```

---

### Task 6: The Surveys screen (route, nav, table)

**Files:**
- Create: `frontend/src/api/surveys.ts`, `frontend/src/surveys/useSurveyTimeline.ts`, `frontend/src/surveys/SurveyTable.tsx`, `frontend/src/screens/SurveysScreen.tsx`, `frontend/src/screens/SurveysScreen.test.tsx`
- Modify: `frontend/src/routes.tsx`, `frontend/src/app/Sidebar.tsx`, `frontend/src/ui/Icon.tsx`, `frontend/src/test/fixtures.ts`

**Interfaces:**
- Consumes: `GET /survey-timeline` (Task 4/5).
- Produces: `fetchSurveyTimeline(api, projectId, basis?) -> Promise<SurveyTimeline>`; `useSurveyTimeline(projectId)` → `{ timeline, loading, error, reload }`; route `/p/:projectId/surveys`; `IconName` gains `"trend"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/screens/SurveysScreen.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { SurveysScreen } from "./SurveysScreen";
import { fakeClient, PROJECT_ID, exampleTimeline } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";

const route = `/p/${PROJECT_ID}/surveys`;
const path = "/p/:projectId/surveys";

beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

describe("SurveysScreen", () => {
  it("lists surveys newest first with the change since the previous one", async () => {
    const { api } = fakeClient([{ method: "GET", path: /survey-timeline/, body: exampleTimeline }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("May survey");
    expect(rows[1]).toHaveTextContent("+3");
    expect(rows[2]).toHaveTextContent("April survey");
  });

  it("marks a survey counted another way and shows why", async () => {
    const odd = {
      ...exampleTimeline,
      surveys: [
        exampleTimeline.surveys[0],
        { ...exampleTimeline.surveys[1], state: "not_comparable", reason: "different model (v2, not v1)", deltas: {} },
      ],
    };
    const { api } = fakeClient([{ method: "GET", path: /survey-timeline/, body: odd }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    expect(await screen.findByText(/different model/)).toBeInTheDocument();
  });

  it("explains itself when there are no maps yet", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /survey-timeline/, body: { basis: null, classes: [], surveys: [] } },
    ]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    expect(await screen.findByText(/no surveys yet/i)).toBeInTheDocument();
  });

  it("reloads when a map detection run finishes", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /survey-timeline/, body: exampleTimeline }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    await screen.findAllByRole("row");
    act(() =>
      useJobsStore
        .getState()
        .upsert({ ...exampleTimeline.job, id: "j1", type: "map_detect", state: "succeeded", progress: 1 }),
    );
    await screen.findAllByRole("row");
    expect(requests.filter((r) => r.url.includes("survey-timeline")).length).toBeGreaterThan(1);
  });
});
```

Add the fixture to `frontend/src/test/fixtures.ts` (reuse the existing `PROJECT_ID`/class-id constants in that file):

```ts
export const exampleTimeline = {
  basis: { model_id: MODEL_ID, model_name: "yolo11m-coco", conf: 0.25 },
  classes: [{ id: CLASS1_ID, name: "excavator", colour: "#f97316" }],
  surveys: [
    {
      map_id: MAP_ID,
      map_name: "April survey",
      captured_on: "2026-04-15",
      date_is_import_date: false,
      run_id: "5e4d3c2b-0000-4000-8000-000000000001",
      model_name: "yolo11m-coco",
      conf: 0.25,
      counts: { [CLASS1_ID]: 12 },
      deltas: {},
      state: "ok",
      reason: null,
    },
    {
      map_id: "9a7b6c5d-0000-4000-8000-000000000002",
      map_name: "May survey",
      captured_on: "2026-05-20",
      date_is_import_date: false,
      run_id: "5e4d3c2b-0000-4000-8000-000000000002",
      model_name: "yolo11m-coco",
      conf: 0.25,
      counts: { [CLASS1_ID]: 15 },
      deltas: { [CLASS1_ID]: 3 },
      state: "ok",
      reason: null,
    },
  ],
  job: exampleJob,
};
```

(If `CLASS1_ID`/`MAP_ID`/`MODEL_ID` have different names in that file, use the existing ones.)

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend`: `npx vitest run src/screens/SurveysScreen.test.tsx`
Expected: FAIL — cannot resolve `./SurveysScreen`.

- [ ] **Step 3: Write the API wrapper and the hook**

`frontend/src/api/surveys.ts`:

```ts
import type { ApiClient } from "@contract/client";
import type { components } from "@contract/client";
import { unwrap } from "./errors";

export type SurveyTimeline = components["schemas"]["SurveyTimeline"];
export type Survey = components["schemas"]["Survey"];

export function fetchSurveyTimeline(
  api: ApiClient,
  projectId: string,
  basis?: { model_id?: string; conf?: number },
): Promise<SurveyTimeline> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/survey-timeline", {
      params: { path: { projectId }, query: basis ?? {} },
    }),
  );
}
```

`frontend/src/surveys/useSurveyTimeline.ts` — follow `frontend/src/train/useDatasets.ts` exactly (an `attempt` counter, a composite `key`, a cancelled flag):

```ts
import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchSurveyTimeline, type SurveyTimeline } from "@/api/surveys";

type State = { key: string; timeline: SurveyTimeline | null; error: string | null };

export function useSurveyTimeline(projectId: string, basis?: { model_id?: string; conf?: number }) {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${basis?.model_id ?? ""}|${basis?.conf ?? ""}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", timeline: null, error: null });
  useEffect(() => {
    let cancelled = false;
    fetchSurveyTimeline(api, projectId, basis)
      .then((timeline) => !cancelled && setState({ key, timeline, error: null }))
      .catch((e: unknown) => !cancelled && setState({ key, timeline: null, error: String(e) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, key]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { timeline: state.timeline, loading: state.key !== key, error: state.error, reload };
}
```

- [ ] **Step 4: Write the table and the screen**

`frontend/src/surveys/SurveyTable.tsx` renders newest first, one column per class, the delta beside each count, and a `Pill` for a non-`ok` state:

```tsx
import { Pill } from "@/ui";
import type { Survey, SurveyTimeline } from "@/api/surveys";

const delta = (n: number | undefined) => (n === undefined ? "" : n === 0 ? "=" : n > 0 ? `+${n}` : `${n}`);

export function SurveyTable({ timeline }: { timeline: SurveyTimeline }) {
  const rows: Survey[] = [...timeline.surveys].reverse();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2">Survey</th>
          <th>Date</th>
          {timeline.classes.map((c) => (
            <th key={c.id}>{c.name}</th>
          ))}
          <th>Counted with</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.map_id} className="border-t border-line">
            <td className="py-2">{s.map_name}</td>
            <td>
              {s.captured_on ?? "date not set"}
              {s.date_is_import_date && <span className="text-muted"> (import date)</span>}
            </td>
            {timeline.classes.map((c) => (
              <td key={c.id} className="tabular-nums">
                {s.counts[c.id] ?? "-"}
                <span className="text-muted"> {delta(s.deltas[c.id])}</span>
              </td>
            ))}
            <td>
              {s.state === "ok" ? (
                `${s.model_name} @ ${s.conf}`
              ) : (
                <Pill tone={s.state === "not_counted" ? "muted" : "warning"}>
                  {s.state === "not_counted" ? "not counted yet" : s.reason}
                </Pill>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

(Check `Pill`'s real `tone` values in `frontend/src/ui/Pill.tsx` and use the nearest existing ones.)

`frontend/src/screens/SurveysScreen.tsx`:

```tsx
import { useParams } from "react-router-dom";
import { Alert, EmptyState, SkeletonRows } from "@/ui";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useSurveyTimeline } from "@/surveys/useSurveyTimeline";
import { SurveyTable } from "@/surveys/SurveyTable";

export function SurveysScreen() {
  const { projectId = "" } = useParams();
  const { timeline, loading, error, reload } = useSurveyTimeline(projectId);
  useOnJobsFinished("map_detect", reload);
  useOnJobsFinished("map_import", reload);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold text-ink">Surveys</h1>
      <p className="mt-1 text-sm text-muted">
        How many objects each survey found, and what changed since the one before it.
      </p>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {loading && !timeline && <SkeletonRows rows={3} columns={4} />}
      {timeline && timeline.surveys.length === 0 && (
        <EmptyState icon="map" title="No surveys yet">
          Import a map of the site and run a model over it; each map is one survey.
        </EmptyState>
      )}
      {timeline && timeline.surveys.length > 0 && (
        <div className="mt-6">
          <SurveyTable timeline={timeline} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Register the route, the sidebar entry and the icon**

In `frontend/src/routes.tsx`, beside the maps entries:

```tsx
      { path: "p/:projectId/surveys", element: <SurveysScreen /> },
```

In `frontend/src/app/Sidebar.tsx`, directly after the Maps `PlainEntry`:

```tsx
          <PlainEntry to={`/p/${projectId}/surveys`} icon="trend" compact={compact}>
            Surveys
          </PlainEntry>
```

In `frontend/src/ui/Icon.tsx`, add `| "trend"` to `IconName` and to `PATHS`:

```ts
  trend: "M4 17l5-5 4 3 7-8",
```

- [ ] **Step 6: Run the tests to verify they pass**

Run from `frontend`: `npx vitest run src/screens/SurveysScreen.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Lint and build**

Run from `frontend`: `pnpm lint && pnpm build`
Expected: both pass (`check-tokens.mjs` prints `tokens ok`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/surveys.ts frontend/src/surveys frontend/src/screens/SurveysScreen.tsx frontend/src/screens/SurveysScreen.test.tsx frontend/src/routes.tsx frontend/src/app/Sidebar.tsx frontend/src/ui/Icon.tsx frontend/src/test/fixtures.ts
git commit -m "feat(surveys): a screen listing each survey's counts and its change"
```

---

### Task 7: The chart

**Files:**
- Create: `frontend/src/surveys/chartPoints.ts`, `frontend/src/surveys/SurveyChart.tsx`, `frontend/src/surveys/SurveyChart.test.tsx`
- Modify: `frontend/src/screens/SurveysScreen.tsx`

**Interfaces:**
- Consumes: `SurveyTimeline` (Task 6).
- Produces: `chartLines(timeline: SurveyTimeline, size: {w: number; h: number}) -> Line[]` where `Line = { classId: string; colour: string; points: string; dots: {x: number; y: number; comparable: boolean}[] }`; `<SurveyChart timeline={...} hidden={Set<string>} />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/surveys/SurveyChart.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { chartLines } from "./chartPoints";
import { exampleTimeline } from "@/test/fixtures";

const size = { w: 400, h: 200 };

describe("chartLines", () => {
  it("draws one line per class, oldest survey on the left", () => {
    const [line] = chartLines(exampleTimeline, size);
    expect(chartLines(exampleTimeline, size)).toHaveLength(1);
    expect(line.dots).toHaveLength(2);
    expect(line.dots[0].x).toBeLessThan(line.dots[1].x);
    // 12 then 15: a rising count draws downward in SVG coordinates.
    expect(line.dots[0].y).toBeGreaterThan(line.dots[1].y);
  });

  it("keeps every point inside the box", () => {
    for (const line of chartLines(exampleTimeline, size)) {
      for (const d of line.dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(size.w);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(size.h);
      }
    }
  });

  it("marks a survey that was counted another way as not comparable", () => {
    const odd = {
      ...exampleTimeline,
      surveys: [exampleTimeline.surveys[0], { ...exampleTimeline.surveys[1], state: "not_comparable" as const }],
    };
    expect(chartLines(odd, size)[0].dots.map((d) => d.comparable)).toEqual([true, false]);
  });

  it("a single survey still yields a drawable point", () => {
    const one = { ...exampleTimeline, surveys: [exampleTimeline.surveys[0]] };
    expect(chartLines(one, size)[0].dots).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend`: `npx vitest run src/surveys/SurveyChart.test.tsx`
Expected: FAIL — cannot resolve `./chartPoints`.

- [ ] **Step 3: Implement the point maths**

`frontend/src/surveys/chartPoints.ts`:

```ts
import type { SurveyTimeline } from "@/api/surveys";

export type Dot = { x: number; y: number; comparable: boolean };
export type Line = { classId: string; name: string; colour: string; points: string; dots: Dot[] };

const PAD = 8;

/** Survey rows to SVG coordinates: oldest left, highest count at the top. */
export function chartLines(timeline: SurveyTimeline, size: { w: number; h: number }): Line[] {
  const surveys = timeline.surveys;
  const top = Math.max(1, ...surveys.flatMap((s) => Object.values(s.counts)));
  const stepX = surveys.length > 1 ? (size.w - 2 * PAD) / (surveys.length - 1) : 0;
  return timeline.classes.map((c) => {
    const dots = surveys.map((s, i) => ({
      x: PAD + i * stepX,
      y: size.h - PAD - ((s.counts[c.id] ?? 0) / top) * (size.h - 2 * PAD),
      comparable: s.state === "ok",
    }));
    return {
      classId: c.id,
      name: c.name,
      colour: c.colour,
      points: dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" "),
      dots,
    };
  });
}
```

- [ ] **Step 4: Draw it**

`frontend/src/surveys/SurveyChart.tsx` — inline SVG in the style of `frontend/src/models/TrainingCurve.tsx`:

```tsx
import { chartLines } from "./chartPoints";
import type { SurveyTimeline } from "@/api/surveys";

const SIZE = { w: 640, h: 220 };

export function SurveyChart({ timeline, hidden }: { timeline: SurveyTimeline; hidden: Set<string> }) {
  const lines = chartLines(timeline, SIZE).filter((l) => !hidden.has(l.classId));
  return (
    <svg
      viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
      className="w-full"
      role="img"
      aria-label="Object counts for each survey"
    >
      {lines.map((l) => (
        <g key={l.classId}>
          <polyline points={l.points} fill="none" stroke={l.colour} strokeWidth={2} />
          {l.dots.map((d, i) => (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r={4}
              fill={d.comparable ? l.colour : "none"}
              stroke={l.colour}
              strokeWidth={2}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
```

In `SurveysScreen.tsx`, above the table:

```tsx
      {timeline && timeline.surveys.length > 1 && (
        <SurveyChart timeline={timeline} hidden={hidden} />
      )}
```

with `const [hidden] = useState<Set<string>>(new Set());` and the import. (Class toggling wires `setHidden` to a legend button per class; keep the legend a row of `Button variant="ghost"` entries showing the class colour.)

- [ ] **Step 5: Run the tests to verify they pass**

Run from `frontend`: `npx vitest run src/surveys && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/surveys/chartPoints.ts frontend/src/surveys/SurveyChart.tsx frontend/src/surveys/SurveyChart.test.tsx frontend/src/screens/SurveysScreen.tsx
git commit -m "feat(surveys): a chart of counts over time"
```

---

### Task 8: End to end, and the walkthrough

**Files:**
- Create: `frontend/e2e/surveys.spec.ts`
- Modify: `docs/progress.md`

**Interfaces:**
- Consumes: everything above. The Prism mock answers from the `example` added to `openapi.yaml` in Task 4.

- [ ] **Step 1: Write the spec**

Create `frontend/e2e/surveys.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

test("the surveys screen lists each survey with its change", async ({ page }) => {
  await page.goto(`/p/${P}/surveys`);
  await expect(page.getByRole("heading", { name: "Surveys", exact: true })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("May survey");
  await expect(rows.nth(1)).toContainText("+3");
  await expect(page.getByRole("img", { name: "Object counts for each survey" })).toBeVisible();
});

test("the sidebar reaches it", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await page.getByRole("link", { name: "Surveys" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/surveys$`));
});
```

- [ ] **Step 2: Run it**

Run from `frontend`: `E2E_WEB_PORT=1531 E2E_MOCK_PORT=4131 npx playwright test e2e/surveys.spec.ts`
Expected: PASS. If Prism returns a different survey order than the example, fix the `example` in `openapi.yaml` rather than loosening the test.

- [ ] **Step 3: Run the whole gate**

Run: `pnpm -C contract check`; from `backend`: `ruff check .`, `ruff format --check .`, `pytest -q`; from `frontend`: `pnpm lint && pnpm test && pnpm build && pnpm e2e`.
Expected: all green.

- [ ] **Step 4: Record the evidence**

Add one row to `docs/progress.md` naming the commit, the test counts, and what a person can now do.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/surveys.spec.ts docs/progress.md
git commit -m "test(e2e): the surveys screen, and record the evidence"
```

---

## Self-review

**Spec coverage:** §3.1 `captured_on` → Tasks 1, 2. §3.2 no snapshot table → Task 3 (pure functions, no storage). §4 selection rule → Task 3 (all five cases have a test). §5 screen → Tasks 6, 7. §6 API → Tasks 4, 5. §7 budget → Task 5's `timeline_rows` (maps and runs only, never detections). §8 edge cases → Task 3 tests (no runs, no date, class added later), Task 6 (`map_detect` refresh). §9 testing → Tasks 1-8. §10 success criteria 1-3 are exercised by Task 5 and Task 6 tests; criterion 4 holds because no endpoint touches detections or rasters; criterion 5 is the wording rule in Global Constraints.

**Placeholders:** none. Every step carries the code it needs.

**Type consistency:** `Survey`/`Basis` field names match between `timeline.py` (Task 3), the schemas (Task 5), the contract (Task 4) and the TypeScript (Tasks 6, 7): `map_id, map_name, captured_on, date_is_import_date, run_id, model_name, conf, counts, deltas, state, reason`. `chartLines` returns `Line[]` with `dots` used by both the test and the component.

**Known unknowns the executor must check rather than assume:** the real alembic head; whether `backend/tests/test_maps_api.py` and `test_maps_raster.py` exist and what fixtures they already provide; the exact `Pill` tone names; the fixture constant names in `frontend/src/test/fixtures.ts`; whether `GeoMap`'s contract schema lists `required` fields.
