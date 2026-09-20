# Rotated Bounding Boxes — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry an `angle` field on every box from the database through the contract, the annotation canvas and the exports, so an annotator can rotate a box and that rotation survives a reload and an export.

**Architecture:** `angle` is a single new float on `Box`, in degrees, rotating the box about its own centre, normalised to `[0, 180)`. `x, y, w, h` keep their exact current meaning — the *unrotated* box — so an `angle: 0` box is byte-identical to what is stored today and the migration is a pure default-0 column add. The canvas renders rotation by moving the Konva pivot to the box centre (`offsetX/offsetY`) and enabling the existing `Transformer`'s rotate handle.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (Python 3.11, `backend/.venv`, uv), React 19 + TypeScript + Konva/react-konva + Zustand, OpenAPI 3.1 with `openapi-typescript`, pytest + Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-20-rotated-boxes-design.md`

## Global Constraints

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is **generated** by `pnpm -C contract generate` and committed in the same change. **Never hand-edit it.**
- `angle` is **degrees**, rotation about the box **centre**, normalised to **`[0, 180)`**. Never radians, never about a corner, never `[0, 360)` in storage.
- `x, y, w, h` always describe the **unrotated** box. No task may redefine them.
- Stage by path. **Never `git add -A`.**
- **A worktree has no venv of its own** (`CONTRIBUTING.md` -> Testing). Backend commands run against
  the *main checkout's* interpreter, by absolute path:
  `E:\Dev\Yoloppackend\.venv\Scripts\python.exe`. Never `uv venv` a fresh one inside a
  worktree, and never rely on a bare `python`. Every `.\.venv\Scripts\python.exe` below means that
  absolute path when you are working in a worktree.
- `cargo` is not on PATH in every shell; if it fails to resolve, call
  `%USERPROFILE%\.cargoin\cargo.exe` directly.
- The app must start even when startup work fails — migration `0003` must not be able to fail on user data.
- Wave 1 does **not** change dataset materialisation. `_label_text` stays 5-number detect format; that is Wave 2.

**The full gate** (run before every merge, from `AGENTS.md` section 4):

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
```

The `cargo test` line runs only when `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists. That binary is git-ignored, so a fresh worktree never has it and the step is **skipped, not failed** (`AGENTS.md` section 4).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `contract/openapi.yaml` | `angle` on `Box` (required), `BoxCreate`, `BoxUpdate` (optional) | 1 |
| `contract/client/schema.d.ts` | generated — never hand-edited | 1 |
| `backend/app/db/models.py` | `Box.angle` column | 1 |
| `backend/app/db/migrations/versions/0003_box_angle.py` | **new** — default-0 column add | 1 |
| `backend/app/datasets/schemas.py` | `angle` on `BoxOut`, `BoxCreate`, `BoxUpdate` | 1 |
| `backend/app/datasets/boxes.py` | persist and normalise `angle`; rotated bounds rule | 1, 2 |
| `backend/app/datasets/router.py` | pass `angle` into `create_box` | 1 |
| `backend/app/geometry.py` | **new** — `corners_of`, `aabb_of`, `normalise_angle` (Python side) | 2 |
| `frontend/src/editor/geometry.ts` | `OrientedRect` and the pure rotation maths | 3 |
| `contract/fixtures/oriented-boxes.json` | **new** — corner expectations both languages are pinned to | 3 |
| `frontend/src/editor/commands.ts` | `cmdUpdateRect` / `cmdDuplicate` carry angle | 4 |
| `frontend/src/editor/useEditorActions.ts` | `commitRect` signature widens to `OrientedRect` | 4 |
| `frontend/src/store/editor.ts` | `shiftHeld` + `setShiftHeld` | 5 |
| `frontend/src/editor/hotkeys.ts` | `rotate`, `shift-down`, `shift-up` actions | 5 |
| `frontend/src/editor/useEditorHotkeys.ts` | wires the three new actions | 5 |
| `frontend/src/editor/BoxLayer.tsx` | centre pivot, rotate handle, snap, label anchoring | 6 |
| `frontend/src/test/fixtures.ts` | `angle` on the box fixtures | 1 |
| `backend/app/exports/rows.py` | `ExportBox.angle` | 7 |
| `backend/app/exports/csv_out.py` | `angle` column | 7 |
| `backend/app/exports/coco_out.py` | AABB `bbox` + 4-corner `segmentation` | 7 |
| `backend/app/exports/html_out.py` | draws the rotated quad | 7 |
| `backend/app/exports/yolo_out.py` | exports the envelope of a rotated box, not the unrotated one | 7 |
| `frontend/src/datasets/NewDatasetForm.tsx` | the Wave 1 caveat line | 8 |

**Task order and dependencies** (spec section 6.2):

```
Task 1 (contract + DB + API)   <- bottleneck, nothing starts before it
   |
   +-- Task 2 (rotated bounds + Python geometry)   \
   +-- Task 3 (frontend geometry)                   > independent of each other
   +-- Task 7 (exports)                            /
          |
          +-- Task 4 (commands)      <- needs Task 3
                 |
                 +-- Task 5 (store + hotkeys)   <- needs Task 4
                        |
                        +-- Task 6 (BoxLayer)   <- needs Tasks 3, 4, 5
                               |
                               +-- Task 8 (caveat line)
```

---

## Task 1: `angle` through the contract, the database and the API

The bottleneck task. Contract and backend land together because `contract/openapi.yaml` marking `angle` as required makes `backend/tests/test_contract.py` (schemathesis response conformance) fail until `BoxOut` carries it — they are one deliverable.

**Files:**
- Modify: `contract/openapi.yaml` (`Box` at :1595, `BoxCreate` at :1657, `BoxUpdate` at :1667)
- Modify: `contract/client/schema.d.ts` (regenerated, never hand-edited)
- Modify: `backend/app/db/models.py:58-80` (`class Box`)
- Create: `backend/app/db/migrations/versions/0003_box_angle.py`
- Modify: `backend/app/datasets/schemas.py:159-171` (`BoxOut`), `:173-195` (`from_row`), `:201-206` (`BoxCreate`), `:209-221` (`BoxUpdate`)
- Modify: `backend/app/datasets/boxes.py:54-74` (`create_box`)
- Modify: `backend/app/datasets/router.py:237-244` (`create_box` endpoint)
- Modify: `frontend/src/test/fixtures.ts:106-139` (`personBox`, `proposalBox`)
- Test: `backend/tests/test_boxes.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Python: `Box.angle: float` (SQLAlchemy column, default 0.0); `create_box(handle, image_id, class_id, x, y, w, h, angle=0.0) -> Box`; `BoxOut.angle: float`; `BoxCreate.angle: float = 0.0`; `BoxUpdate.angle: float = None`.
  - TypeScript: `Box["angle"]: number` (required), `BoxCreate["angle"]?: number`, `BoxUpdate["angle"]?: number`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_boxes.py`:

```python
def test_create_box_defaults_to_zero_angle(client, labelled):
    r = _create(client, labelled)
    assert r.status_code == 201, r.text
    assert r.json()["angle"] == 0.0


def test_create_box_accepts_an_angle(client, labelled):
    r = _create(client, labelled, angle=30.0)
    assert r.status_code == 201, r.text
    assert r.json()["angle"] == 30.0


def test_patch_box_sets_the_angle(client, labelled):
    box_id = _create(client, labelled).json()["id"]
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"angle": 45.0})
    assert r.status_code == 200, r.text
    assert r.json()["angle"] == 45.0


def test_angle_is_normalised_into_zero_to_one_eighty_on_write(client, labelled):
    """A rectangle has 180 degree symmetry, so 190 and 10 are the same shape (spec 3.1)."""
    box_id = _create(client, labelled, angle=190.0).json()["id"]
    assert client.get(f"/api/v1/projects/{labelled['pid']}/images/{labelled['image_id']}/boxes").json()[
        "items"
    ][0]["angle"] == 10.0
    r = client.patch(f"/api/v1/projects/{labelled['pid']}/boxes/{box_id}", json={"angle": -10.0})
    assert r.json()["angle"] == 170.0


def test_existing_boxes_read_back_as_zero_angle(client, labelled):
    """Migration 0003 gives every pre-existing row angle 0 through the column default."""
    proposal_id = _proposal(client, labelled)
    rows = client.get(
        f"/api/v1/projects/{labelled['pid']}/images/{labelled['image_id']}/boxes"
    ).json()["items"]
    assert [b["angle"] for b in rows if b["id"] == proposal_id] == [0.0]
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_boxes.py -k angle -v
```

Expected: FAIL — `KeyError: 'angle'` on the response JSON.

- [ ] **Step 3: Add `angle` to the contract**

In `contract/openapi.yaml`, `Box` (at :1595):

- add `angle` to the `required` list, directly after `h`
- add the property beside `h`:

```yaml
        angle:
          type: number
          minimum: 0
          exclusiveMaximum: 180
          description: >-
            Rotation in degrees about the box's own centre, clockwise in image coordinates.
            `x`, `y`, `w`, `h` always describe the unrotated box. A rectangle has 180 degree
            symmetry, so the range is [0, 180) and 190 is stored as 10.
```

- add `angle: 0.0` to the `Box` example and to **both** items of the `BoxList` example (at :1624).

In `BoxCreate` (at :1657) and `BoxUpdate` (at :1667), add the same property (no `required` entry, these are optional):

```yaml
        angle: { type: number, minimum: 0, exclusiveMaximum: 180, default: 0 }
```

- [ ] **Step 4: Regenerate the client and confirm the contract is clean**

```
pnpm -C contract generate
pnpm -C contract check
```

Expected: `check` PASSES (spectral lint clean, and `git diff --exit-code` on `schema.d.ts` is empty because step 4 just regenerated it).

- [ ] **Step 5: Add the column to the model**

In `backend/app/db/models.py`, inside `class Box`, directly after the `h` column:

```python
    # Degrees about the box centre; x/y/w/h always describe the unrotated box (spec 3.1).
    angle: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
```

- [ ] **Step 6: Write the migration**

Create `backend/app/db/migrations/versions/0003_box_angle.py`:

```python
"""box angle

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-20 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `server_default="0"` is the whole migration: every existing box becomes angle 0, which is
    # exactly what it already meant. No backfill pass, so this cannot fail on user data — and a
    # migration that cannot fail cannot be the reason the app will not open.
    op.add_column("box", sa.Column("angle", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    # Not `batch_alter_table`: its SQLite strategy recreates the table (copy, drop, rename), which
    # would churn every box row. A plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) does not.
    op.execute("ALTER TABLE box DROP COLUMN angle")
```

- [ ] **Step 7: Add `angle` to the pydantic schemas**

In `backend/app/datasets/schemas.py`:

`BoxOut` — add after `h: float`:

```python
    angle: float
```

`BoxOut.from_row` — add after `h=row.h,`:

```python
            angle=row.angle,
```

`BoxCreate` — add after `h: float = Field(gt=0)`:

```python
    angle: float = Field(default=0.0)
```

`BoxUpdate` — add after `h: float = Field(default=None, gt=0)`:

```python
    angle: float = Field(default=None)
```

Bounds are **not** declared with `ge`/`lt` here: an out-of-range angle is normalised on write (step 8), not rejected. `190` is a legitimate way to say `10`.

- [ ] **Step 8: Normalise and persist the angle in the service**

In `backend/app/datasets/boxes.py`, add near the other helpers (after `_check_bounds`):

```python
def normalise_angle(deg: float) -> float:
    """Degrees into [0, 180). A rectangle has 180 degree symmetry, so 190 and 10 are one shape.

    Normalising on the write path, not only in the UI: a value arriving from the mock server, a
    test or a future import must land normalised too, or two rows describing the same box compare
    unequal forever after.
    """
    return float(deg) % 180.0
```

In `create_box`, widen the signature and pass it through:

```python
def create_box(
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float = 0.0,
) -> Box:
```

and add `angle=normalise_angle(angle),` to the `Box(...)` constructor, directly after `h=h,`.

In `update_box`, normalise before the field loop — insert directly above `for k, v in fields.items():`:

```python
        if "angle" in fields:
            fields["angle"] = normalise_angle(fields["angle"])
```

- [ ] **Step 9: Pass the angle through the router**

In `backend/app/datasets/router.py:243`, replace the `create_box` call:

```python
    row = boxes.create_box(
        handle, imageId, body.class_id, body.x, body.y, body.w, body.h, body.angle
    )
```

- [ ] **Step 10: Add `angle` to the frontend fixtures**

`angle` is required on `Box`, so `frontend/src/test/fixtures.ts` will not typecheck without it. Add `angle: 0,` after `h: 90,` in `personBox` and after `h: 61,` in `proposalBox`.

- [ ] **Step 11: Run the tests to verify they pass**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_boxes.py tests/test_contract.py tests/test_box_schema.py tests/test_db.py -v
```

Expected: PASS, including the schemathesis conformance suite.

- [ ] **Step 12: Run the full gate**

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
```

Expected: all PASS.

- [ ] **Step 13: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts \
  backend/app/db/models.py backend/app/db/migrations/versions/0003_box_angle.py \
  backend/app/datasets/schemas.py backend/app/datasets/boxes.py backend/app/datasets/router.py \
  backend/tests/test_boxes.py frontend/src/test/fixtures.ts
git commit -m "feat(boxes): store a rotation angle on every box

Degrees about the box centre, normalised to [0, 180). x/y/w/h keep their
exact meaning, so migration 0003 is a pure default-0 column add that
cannot fail on user data."
```

---

## Task 2: Rotated bounds validation and the shared Python geometry

`_check_bounds` currently demands `x + w <= image.width`, which is the backend twin of `clampRect`. A rotated box at an image edge is a legitimate annotation (spec 3.3), so the rule has to branch on the angle. The corner maths lands here too because the bounds check is its first consumer, and Wave 2's label writer will be its second.

**Files:**
- Create: `backend/app/geometry.py`
- Create: `backend/tests/test_geometry.py`
- Modify: `backend/app/datasets/boxes.py:32-39` (`_check_bounds`), and its two call sites at `:59` and `:84`
- Test: `backend/tests/test_boxes.py`

**Interfaces:**
- Consumes: `normalise_angle` from Task 1 (`app.datasets.boxes`) — **moved** into `app.geometry` by this task and re-exported, so Task 1's call sites keep working.
- Produces: `app.geometry.normalise_angle(deg: float) -> float`; `app.geometry.centre_of(x, y, w, h) -> tuple[float, float]`; `app.geometry.corners_of(x, y, w, h, angle) -> list[tuple[float, float]]` (4 points, clockwise from the rotated top-left); `app.geometry.aabb_of(x, y, w, h, angle) -> tuple[float, float, float, float]` returning `(x, y, w, h)` of the axis-aligned envelope.

- [ ] **Step 1: Write the failing geometry test**

Create `backend/tests/test_geometry.py`:

```python
import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.geometry import aabb_of, centre_of, corners_of, normalise_angle


def test_normalise_angle_wraps_at_one_eighty():
    assert normalise_angle(0.0) == 0.0
    assert normalise_angle(190.0) == 10.0
    assert normalise_angle(-10.0) == 170.0
    assert normalise_angle(180.0) == 0.0
    assert normalise_angle(360.0) == 0.0


def test_centre_of_is_the_middle_of_the_unrotated_box():
    assert centre_of(10, 20, 30, 40) == (25.0, 40.0)


def test_corners_at_zero_angle_are_the_plain_rectangle():
    assert corners_of(10, 20, 30, 40, 0.0) == [
        (10.0, 20.0),
        (40.0, 20.0),
        (40.0, 60.0),
        (10.0, 60.0),
    ]


def test_corners_at_ninety_degrees_swap_the_sides():
    """A 30x40 box rotated 90 degrees about its centre occupies a 40x30 footprint."""
    x, y, w, h = aabb_of(10, 20, 30, 40, 90.0)
    assert (round(x, 6), round(y, 6), round(w, 6), round(h, 6)) == (5.0, 25.0, 40.0, 30.0)


def test_aabb_at_zero_angle_is_the_box_itself():
    assert aabb_of(10, 20, 30, 40, 0.0) == (10.0, 20.0, 30.0, 40.0)


@given(
    x=st.floats(-500, 500),
    y=st.floats(-500, 500),
    w=st.floats(0.1, 500),
    h=st.floats(0.1, 500),
    angle=st.floats(0, 179.999),
)
def test_corners_always_keep_the_centre_and_the_side_lengths(x, y, w, h, angle):
    """Rotation is rigid: the centre does not move and no side changes length."""
    cx, cy = centre_of(x, y, w, h)
    c = corners_of(x, y, w, h, angle)
    mx = sum(p[0] for p in c) / 4
    my = sum(p[1] for p in c) / 4
    assert mx == pytest.approx(cx, abs=1e-6)
    assert my == pytest.approx(cy, abs=1e-6)
    top = math.dist(c[0], c[1])
    right = math.dist(c[1], c[2])
    assert top == pytest.approx(w, rel=1e-6)
    assert right == pytest.approx(h, rel=1e-6)


@given(
    w=st.floats(0.1, 500),
    h=st.floats(0.1, 500),
    angle=st.floats(0, 179.999),
)
def test_aabb_always_contains_every_corner(w, h, angle):
    ax, ay, aw, ah = aabb_of(0, 0, w, h, angle)
    for px, py in corners_of(0, 0, w, h, angle):
        assert ax - 1e-6 <= px <= ax + aw + 1e-6
        assert ay - 1e-6 <= py <= ay + ah + 1e-6
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.geometry'`.

- [ ] **Step 3: Write the geometry module**

Create `backend/app/geometry.py`:

```python
"""Oriented-box maths shared by validation, exports and (in wave 2) label materialisation.

`x, y, w, h` always describe the *unrotated* box; `angle` rotates it about its own centre,
in degrees, clockwise in image coordinates (y grows downward). This module is the single
definition of that convention on the Python side — `frontend/src/editor/geometry.ts` is its
TypeScript twin, and the two are pinned to the same fixtures so they cannot drift.
"""

from __future__ import annotations

import math


def normalise_angle(deg: float) -> float:
    """Degrees into [0, 180). A rectangle has 180 degree symmetry, so 190 and 10 are one shape."""
    return float(deg) % 180.0


def centre_of(x: float, y: float, w: float, h: float) -> tuple[float, float]:
    return (x + w / 2, y + h / 2)


def corners_of(x: float, y: float, w: float, h: float, angle: float) -> list[tuple[float, float]]:
    """The four corners in image pixels, clockwise from the rotated top-left."""
    cx, cy = centre_of(x, y, w, h)
    rad = math.radians(angle)
    cos, sin = math.cos(rad), math.sin(rad)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cx + dx * cos - dy * sin, cy + dx * sin + dy * cos))
    return out


def aabb_of(x: float, y: float, w: float, h: float, angle: float) -> tuple[float, float, float, float]:
    """The axis-aligned envelope of the rotated box, as `(x, y, w, h)`."""
    if angle == 0:
        return (float(x), float(y), float(w), float(h))
    pts = corners_of(x, y, w, h, angle)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
```

- [ ] **Step 4: Run the test to verify it passes**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v
```

Expected: PASS (11 tests, two of them hypothesis property tests).

- [ ] **Step 5: Write the failing bounds test**

Append to `backend/tests/test_boxes.py`:

The `labelled` fixture's image is **320x240**. The three cases use one geometry, `w=60, h=20` at `y=10`, and vary only `x` and the angle:

| `x` | centre x | right edge | meaning |
| --- | --- | --- | --- |
| 280 | 310 (inside) | 340 (20 px past) | rotated: allowed to overhang |
| 400 | 430 (outside) | 460 | rotated: centre is out, rejected |
| 280 | 310 | 340 (20 px past) | angle 0: rejected, as today |

```python
def test_rotated_box_may_hang_over_the_image_edge(client, labelled):
    """A truck half out of frame at 30 degrees is a real annotation (spec 3.3).

    320x240 image: this box's right edge is at 340, twenty pixels past it, but its centre (310)
    is comfortably inside.
    """
    r = _create(client, labelled, x=280, y=10, w=60, h=20, angle=30.0)
    assert r.status_code == 201, r.text


def test_rotated_box_centre_must_stay_inside_the_image(client, labelled):
    """Centre at 430 on a 320-wide image: the box is not merely truncated, it is off the frame."""
    r = _create(client, labelled, x=400, y=10, w=60, h=20, angle=30.0)
    assert r.status_code == 422, r.text
    assert "centre" in r.json()["message"]


def test_unrotated_box_still_must_lie_fully_inside(client, labelled):
    """The same box at angle 0 is still rejected: today's rule is untouched (spec 3.3)."""
    r = _create(client, labelled, x=280, y=10, w=60, h=20, angle=0.0)
    assert r.status_code == 422, r.text
    assert "does not lie inside" in r.json()["message"]
```

- [ ] **Step 6: Run the tests to verify they fail**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_boxes.py -k "edge or centre or fully_inside" -v
```

Expected: FAIL — the rotated box is rejected with the old "does not lie inside" message.

- [ ] **Step 7: Branch the bounds check on the angle**

In `backend/app/datasets/boxes.py`, replace `_check_bounds` entirely:

```python
def _check_bounds(image: Image, x: float, y: float, w: float, h: float, angle: float = 0.0) -> None:
    """Angle 0 must lie fully inside the image; a rotated box only needs its centre inside.

    The asymmetry is deliberate (spec 3.3). Forcing a rotated box's corners inside the image would
    shrink or shove it every time the annotator rotated near an edge, and an object half out of
    frame is exactly the case aerial frames are full of. Angle 0 keeps today's rule untouched so
    no box that already exists changes meaning.
    """
    if w <= 0 or h <= 0:
        raise AppError("validation_error", f"box ({x}, {y}, {w}, {h}) has a non-positive side", 422)
    if angle:
        cx, cy = centre_of(x, y, w, h)
        if not (0 <= cx <= image.width and 0 <= cy <= image.height):
            raise AppError(
                "validation_error",
                f"rotated box centre ({cx}, {cy}) is outside the "
                f"{image.width}x{image.height} image",
                422,
            )
        return
    if x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        raise AppError(
            "validation_error",
            f"box ({x}, {y}, {w}, {h}) does not lie inside the {image.width}x{image.height} image",
            422,
        )
```

Add the import at the top of the file, beside the existing imports:

```python
from app.geometry import centre_of, normalise_angle
```

and **delete** the local `normalise_angle` added in Task 1 step 8, so there is exactly one definition.

- [ ] **Step 8: Pass the angle into both call sites**

In `create_box`, replace the check:

```python
        angle = normalise_angle(angle)
        _check_bounds(image, x, y, w, h, angle)
```

(and the constructor then uses the already-normalised local: `angle=angle,`).

In `update_box`, replace the `moved` block:

```python
        if "angle" in fields:
            fields["angle"] = normalise_angle(fields["angle"])
        moved = {k: fields.get(k, getattr(row, k)) for k in ("x", "y", "w", "h", "angle")}
        _check_bounds(_image(s, row.image_id), **moved)
```

- [ ] **Step 9: Run the tests to verify they pass**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_boxes.py tests/test_geometry.py -v
```

Expected: PASS, including every pre-existing box test (angle-0 behaviour is unchanged).

- [ ] **Step 10: Commit**

```bash
git add backend/app/geometry.py backend/app/datasets/boxes.py \
  backend/tests/test_geometry.py backend/tests/test_boxes.py
git commit -m "feat(boxes): let a rotated box hang over the image edge

Angle 0 keeps today's fully-inside rule exactly; a rotated box only needs
its centre in the image, because an object half out of frame is the case
aerial work is full of. Corner maths moves to app/geometry.py, which
wave 2's label writer will share."
```

---

## Task 3: `OrientedRect` and the frontend rotation maths

Pure functions, no React, no Konva. This is the TypeScript twin of Task 2's `app/geometry.py` and must agree with it exactly.

**Files:**
- Modify: `frontend/src/editor/geometry.ts`
- Test: `frontend/src/editor/geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `OrientedRect` (`Rect & { angle: number }`); `centreOf(r: Rect): Point`; `cornersOf(r: OrientedRect): [Point, Point, Point, Point]`; `aabbOf(r: OrientedRect): Rect`; `normaliseAngle(deg: number): number`; `clampOriented(r: OrientedRect, image: Size): OrientedRect`; `orientedEquals(a: OrientedRect, b: OrientedRect, eps?: number): boolean`; `orientedRectOf(b: {x,y,w,h,angle}): OrientedRect`; `roundOriented(r: OrientedRect, decimals?: number): OrientedRect`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/editor/geometry.test.ts`:

```ts
describe("oriented boxes", () => {
  const box = { x: 10, y: 20, w: 30, h: 40, angle: 0 };

  it("normalises degrees into [0, 180)", () => {
    expect(normaliseAngle(0)).toBe(0);
    expect(normaliseAngle(190)).toBeCloseTo(10, 9);
    expect(normaliseAngle(-10)).toBeCloseTo(170, 9);
    expect(normaliseAngle(180)).toBe(0);
    expect(normaliseAngle(360)).toBe(0);
  });

  it("takes the centre of the unrotated box", () => {
    expect(centreOf(box)).toEqual({ x: 25, y: 40 });
  });

  it("gives the plain rectangle's corners at angle 0", () => {
    expect(cornersOf(box)).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it("swaps the footprint at 90 degrees", () => {
    const a = aabbOf({ ...box, angle: 90 });
    expect(a.x).toBeCloseTo(5, 6);
    expect(a.y).toBeCloseTo(25, 6);
    expect(a.w).toBeCloseTo(40, 6);
    expect(a.h).toBeCloseTo(30, 6);
  });

  it("keeps the centre and the side lengths under rotation", () => {
    const c = cornersOf({ ...box, angle: 37 });
    const mx = c.reduce((s, p) => s + p.x, 0) / 4;
    const my = c.reduce((s, p) => s + p.y, 0) / 4;
    expect(mx).toBeCloseTo(25, 6);
    expect(my).toBeCloseTo(40, 6);
    expect(Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y)).toBeCloseTo(30, 6);
    expect(Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y)).toBeCloseTo(40, 6);
  });

  it("clamps a rotated box by its centre, not its corners", () => {
    const image = { width: 320, height: 240 };
    // Hangs 20px off the right edge; the centre is well inside, so it stays put.
    const kept = clampOriented({ x: 280, y: 10, w: 60, h: 20, angle: 30 }, image);
    expect(kept.x).toBe(280);
    // Centre at 430 is outside; it is pulled back so the centre lands on the edge.
    const pulled = clampOriented({ x: 400, y: 10, w: 60, h: 20, angle: 30 }, image);
    expect(pulled.x + pulled.w / 2).toBeCloseTo(320, 6);
  });

  it("clamps an angle-0 box exactly as clampRect does", () => {
    const image = { width: 320, height: 240 };
    const r = { x: 300, y: 10, w: 60, h: 20, angle: 0 };
    const { angle, ...plain } = clampOriented(r, image);
    expect(angle).toBe(0);
    expect(plain).toEqual(clampRect({ x: 300, y: 10, w: 60, h: 20 }, image));
  });

  it("compares angle as well as geometry", () => {
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 30 })).toBe(true);
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 31 })).toBe(false);
    expect(orientedEquals({ ...box, angle: 30 }, { ...box, angle: 30.01 })).toBe(true);
  });
});
```

Add the new names to the existing import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C frontend test -- geometry
```

Expected: FAIL — `normaliseAngle is not a function` / TypeScript cannot resolve the new exports.

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/editor/geometry.ts`:

```ts
/** A box plus its rotation. `x, y, w, h` always describe the *unrotated* box. */
export interface OrientedRect extends Rect {
  /** Degrees about the box centre, clockwise in image coordinates, in [0, 180). */
  angle: number;
}

/** Smallest angle change worth saving, in degrees. */
export const ANGLE_EPSILON = 0.05;

/** Degrees into [0, 180). A rectangle has 180 degree symmetry, so 190 and 10 are one shape. */
export function normaliseAngle(deg: number): number {
  const m = deg % 180;
  return m < 0 ? m + 180 : m;
}

export function centreOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** The four corners in image pixels, clockwise from the rotated top-left. */
export function cornersOf(r: OrientedRect): [Point, Point, Point, Point] {
  const c = centreOf(r);
  const rad = (r.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dy: number): Point => ({
    x: c.x + dx * cos - dy * sin,
    y: c.y + dx * sin + dy * cos,
  });
  const hw = r.w / 2;
  const hh = r.h / 2;
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/** The axis-aligned envelope of the rotated box. */
export function aabbOf(r: OrientedRect): Rect {
  if (r.angle === 0) return { x: r.x, y: r.y, w: r.w, h: r.h };
  const pts = cornersOf(r);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Angle 0 clamps exactly as `clampRect` does; a rotated box only has its centre pulled into the
 * image. Forcing a rotated box's corners inside would shrink or shove it whenever the annotator
 * rotated near an edge, and an object half out of frame is the case aerial frames are full of.
 */
export function clampOriented(r: OrientedRect, image: Size): OrientedRect {
  if (r.angle === 0) return { ...clampRect(rectOf(r), image), angle: 0 };
  const w = Math.min(Math.max(r.w, MIN_BOX_SIDE), image.width);
  const h = Math.min(Math.max(r.h, MIN_BOX_SIDE), image.height);
  const c = centreOf({ ...r, w, h });
  const cx = Math.min(Math.max(c.x, 0), image.width);
  const cy = Math.min(Math.max(c.y, 0), image.height);
  return { x: cx - w / 2, y: cy - h / 2, w, h, angle: normaliseAngle(r.angle) };
}

/**
 * `eps` is the tolerance in image pixels for x/y/w/h; the angle always uses `ANGLE_EPSILON`,
 * because degrees and pixels are not the same unit and one number cannot serve both.
 */
export function orientedEquals(a: OrientedRect, b: OrientedRect, eps = 0.05): boolean {
  return rectEquals(rectOf(a), rectOf(b), eps) && Math.abs(a.angle - b.angle) < ANGLE_EPSILON;
}

export function orientedRectOf(b: { x: number; y: number; w: number; h: number; angle: number }): OrientedRect {
  return { x: b.x, y: b.y, w: b.w, h: b.h, angle: b.angle };
}

export function roundOriented(r: OrientedRect, decimals = 1): OrientedRect {
  const f = 10 ** decimals;
  return { ...roundRect(rectOf(r), decimals), angle: Math.round(normaliseAngle(r.angle) * f) / f };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm -C frontend test -- geometry
```

Expected: PASS — the new suite plus every pre-existing geometry test.

- [ ] **Step 5: Pin both languages to one fixture file**

Spec section 8. The corner maths now exists twice, in two languages. Two implementations of the same formula drift silently, and the symptom in Wave 2 would be label files that are subtly wrong on disk — the worst possible place to find out. One file, read by both test suites, makes drift a test failure instead.

`contract/` is already the directory that holds shared truth, so the fixture lives there. Create `contract/fixtures/oriented-boxes.json`:

```json
{
  "comment": "Shared by backend/tests/test_geometry.py and frontend/src/editor/geometry.test.ts. Corners are clockwise from the rotated top-left, in image pixels, y growing downward. Do not edit one language's expectations without the other.",
  "cases": [
    {
      "name": "unrotated",
      "box": { "x": 10, "y": 20, "w": 30, "h": 40, "angle": 0 },
      "corners": [[10, 20], [40, 20], [40, 60], [10, 60]],
      "aabb": { "x": 10, "y": 20, "w": 30, "h": 40 }
    },
    {
      "name": "quarter turn",
      "box": { "x": 10, "y": 20, "w": 30, "h": 40, "angle": 90 },
      "corners": [[45, 25], [45, 55], [5, 55], [5, 25]],
      "aabb": { "x": 5, "y": 25, "w": 40, "h": 30 }
    },
    {
      "name": "square at forty-five",
      "box": { "x": 0, "y": 0, "w": 10, "h": 10, "angle": 45 },
      "corners": [[5, -2.0710678118654755], [12.071067811865476, 5], [5, 12.071067811865476], [-2.0710678118654755, 5]],
      "aabb": { "x": -2.0710678118654755, "y": -2.0710678118654755, "w": 14.142135623730951, "h": 14.142135623730951 }
    },
    {
      "name": "thin box at thirty",
      "box": { "x": 100, "y": 200, "w": 60, "h": 20, "angle": 30 },
      "corners": [[109.019237886467, 186.339745962156], [160.980762113533, 216.339745962156], [150.980762113533, 233.660254037844], [99.019237886467, 203.660254037844]],
      "aabb": { "x": 99.019237886467, "y": 186.339745962156, "w": 61.961524227066, "h": 47.320508075689 }
    }
  ]
}
```

These four expectations were computed from the formula, not typed by hand, and are rounded to 12 decimal places — hence the `abs=1e-9` tolerances in both suites. If you change a box, **regenerate** rather than hand-adjust: an expectation that is merely self-consistent with one implementation proves nothing about the other.

Note the "thin box at thirty" case: its envelope (62 x 47) is more than twice the area of the 60 x 20 box inside it. That is precisely the background-in-the-label problem this whole feature exists to fix, and it is worth having one fixture that shows it.

Add to `frontend/src/editor/geometry.test.ts`:

```ts
import fixtures from "../../../contract/fixtures/oriented-boxes.json";

describe("shared corner fixtures", () => {
  it.each(fixtures.cases)("agrees with the Python implementation for $name", (c) => {
    const got = cornersOf(c.box);
    c.corners.forEach(([x, y], i) => {
      expect(got[i].x).toBeCloseTo(x, 9);
      expect(got[i].y).toBeCloseTo(y, 9);
    });
    const a = aabbOf(c.box);
    expect(a.x).toBeCloseTo(c.aabb.x, 9);
    expect(a.y).toBeCloseTo(c.aabb.y, 9);
    expect(a.w).toBeCloseTo(c.aabb.w, 9);
    expect(a.h).toBeCloseTo(c.aabb.h, 9);
  });
});
```

If `resolveJsonModule` is not already on in `frontend/tsconfig.json`, enable it. If the path escapes the frontend `rootDir`, add a `@contract-fixtures` alias in `vite.config.ts` and `tsconfig.json` pointing at `contract/fixtures` rather than loosening `rootDir`.

Add to `backend/tests/test_geometry.py`:

```python
import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "oriented-boxes.json"


@pytest.mark.parametrize("case", json.loads(FIXTURES.read_text("utf-8"))["cases"], ids=lambda c: c["name"])
def test_agrees_with_the_typescript_implementation(case):
    b = case["box"]
    got = corners_of(b["x"], b["y"], b["w"], b["h"], b["angle"])
    for (gx, gy), (ex, ey) in zip(got, case["corners"], strict=True):
        assert gx == pytest.approx(ex, abs=1e-9)
        assert gy == pytest.approx(ey, abs=1e-9)
    a = case["aabb"]
    assert aabb_of(b["x"], b["y"], b["w"], b["h"], b["angle"]) == pytest.approx(
        (a["x"], a["y"], a["w"], a["h"]), abs=1e-9
    )
```

- [ ] **Step 6: Run both suites against the fixture**

```
pnpm -C frontend test -- geometry
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_geometry.py -v
```

Expected: both PASS, four shared cases each.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor/geometry.ts frontend/src/editor/geometry.test.ts \
  contract/fixtures/oriented-boxes.json backend/tests/test_geometry.py
git commit -m "feat(editor): add OrientedRect and the rotation maths

The TypeScript twin of app/geometry.py. clampOriented keeps angle 0 on
today's fully-inside rule and clamps a rotated box by its centre only.
Both languages are pinned to contract/fixtures/oriented-boxes.json, so
the two implementations cannot drift without a test failing."
```

---

## Task 4: Carry the angle through the command layer

**Files:**
- Modify: `frontend/src/editor/commands.ts:6` (imports), `:102-125` (`cmdUpdateRect`), `:196-203` (`cmdDuplicate`)
- Modify: `frontend/src/editor/useEditorActions.ts:18` (import), `:24` (`commitRect` type), `:64` (binding)
- Test: `frontend/src/editor/commands.test.ts`

**Interfaces:**
- Consumes: `OrientedRect`, `orientedEquals`, `orientedRectOf`, `roundOriented` from Task 3.
- Produces: `cmdUpdateRect(ctx, id, before: OrientedRect, after: OrientedRect): Promise<void>`; `EditorActions.commitRect(id: string, before: OrientedRect, after: OrientedRect): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/editor/commands.test.ts`, following the existing file's context/mock helpers:

The file already has a harness: a module-level `ctx()` returning a `CommandContext` plus a `requests` array recorded by `fakeClient(routes)`, and a `beforeEach` that loads `personBox` and `proposalBox` into the store. Use it exactly as the existing tests do — assert on `c.requests`, not on mock functions.

```ts
  it("sends the angle in the patch body and restores it on undo", async () => {
    const c = ctx();
    const before = { x: 1210.5, y: 802, w: 96, h: 61, angle: 0 };
    const after = { x: 1210.5, y: 802, w: 96, h: 61, angle: 45 };
    await cmdUpdateRect(c, proposalBox.id, before, after);
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: after });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({ angle: 45 });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: before });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({ angle: 0 });
  });

  it("ignores an angle change smaller than the epsilon", async () => {
    const c = ctx();
    await cmdUpdateRect(
      c,
      proposalBox.id,
      { x: 1210.5, y: 802, w: 96, h: 61, angle: 45 },
      { x: 1210.5, y: 802, w: 96, h: 61, angle: 45.01 },
    );
    expect(c.requests).toHaveLength(0);
  });

  it("saves an angle change on a box whose geometry did not move", async () => {
    const c = ctx();
    await cmdUpdateRect(
      c,
      proposalBox.id,
      { x: 1210.5, y: 802, w: 96, h: 61, angle: 45 },
      { x: 1210.5, y: 802, w: 96, h: 61, angle: 46 },
    );
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: { angle: 46 } });
  });

  it("duplicate keeps the original's angle", async () => {
    const c = ctx();
    useEditorStore.getState().upsertBox({ ...personBox, angle: 45 });
    await cmdDuplicate(c, personBox.id);
    expect(c.requests[0]).toMatchObject({
      method: "POST",
      body: { class_id: personBox.class_id, x: 524, y: 312, w: 140, h: 90, angle: 45 },
    });
  });
```

Place these inside the existing `describe("editor commands", ...)` block so they inherit its `beforeEach`. The duplicate test's expected `x`/`y` are `personBox`'s 512/300 plus `duplicateOffset`'s 12 px nudge — confirm that constant in `geometry.ts` before pinning the literals.

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C frontend test -- commands
```

Expected: FAIL — the patch body has no `angle`, and `cmdDuplicate` drops it.

- [ ] **Step 3: Widen `cmdUpdateRect`**

In `frontend/src/editor/commands.ts`, replace the geometry import on line 7. It is currently:

```ts
import { duplicateOffset, rectEquals, rectOf, roundRect, type Rect } from "./geometry";
```

and becomes:

```ts
import { duplicateOffset, orientedEquals, rectOf, roundOriented, type OrientedRect } from "./geometry";
```

`rectEquals` (line 108) and `roundRect` (line 201) are the file's only two uses of those, and both are replaced in this task. `rectOf` stays — `duplicateOffset` still takes a plain `Rect`. `type Rect` has no other use in the file.

Change the signature and the guard:

```ts
export async function cmdUpdateRect(
  ctx: CommandContext,
  id: string,
  before: OrientedRect,
  after: OrientedRect,
): Promise<void> {
  if (orientedEquals(before, after)) return;
```

The rest of the function is unchanged: `after` is already passed straight to `updateBox` as the patch body, so the angle travels with it, and `before` does the same on undo.

- [ ] **Step 4: Keep the angle on duplicate**

Replace the body of `cmdDuplicate`:

```ts
export async function cmdDuplicate(ctx: CommandContext, id: string): Promise<Box | undefined> {
  const { store } = ctx;
  const box = store.getState().boxes[id];
  const image = store.getState().image;
  if (!box || !image) return undefined;
  const moved = duplicateOffset(rectOf(box), image);
  const rect = roundOriented({ ...moved, angle: box.angle });
  return cmdCreateBox(ctx, box.image_id, { class_id: box.class_id, ...rect });
}
```

`duplicateOffset` keeps its axis-aligned nudge; the angle rides along untouched.

- [ ] **Step 5: Widen the action signature**

In `frontend/src/editor/useEditorActions.ts`, change the geometry import to:

```ts
import type { OrientedRect, Rect } from "./geometry";
```

and the interface member:

```ts
  commitRect: (id: string, before: OrientedRect, after: OrientedRect) => Promise<void>;
```

`drawBox` keeps `Rect` — the live draft is always angle 0 (spec 4.4), and the backend defaults `angle` to 0 on create.

- [ ] **Step 6: Run the test to verify it passes**

```
pnpm -C frontend test -- commands
pnpm -C frontend lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor/commands.ts frontend/src/editor/useEditorActions.ts \
  frontend/src/editor/commands.test.ts
git commit -m "feat(editor): carry the angle through the command layer

cmdUpdateRect takes OrientedRect, so undo and redo get rotation for free
from the existing before/after history. Duplicate keeps the angle."
```

---

## Task 5: `shiftHeld` in the store and the rotate hotkeys

Shift does two jobs: it gates the Transformer's snap list (Task 6) and it is *not* a class hotkey. Both need the modifier tracked in the store, the same way `spaceHeld` already is.

**Files:**
- Modify: `frontend/src/store/editor.ts:30` (state), `:97` (initial), `:193` (setter), and the `EditorState` interface
- Modify: `frontend/src/editor/hotkeys.ts` (`EditorAction`, `actionForKey`, `HOTKEY_HELP`)
- Modify: `frontend/src/editor/useEditorHotkeys.ts`
- Test: `frontend/src/editor/hotkeys.test.ts`

**Interfaces:**
- Consumes: `EditorActions` from Task 4.
- Produces: `EditorState.shiftHeld: boolean`; `EditorState.setShiftHeld(held: boolean): void`; `EditorAction` variants `{ type: "rotate"; delta: number }`, `{ type: "shift-down" }`, `{ type: "shift-up" }`; `EditorActions.rotateSelected(delta: number): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/editor/hotkeys.test.ts`:

```ts
describe("rotation keys", () => {
  const down = (key: string, over: Partial<KeyLike> = {}): KeyLike => ({
    type: "keydown",
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

  it("Shift+Right nudges one degree clockwise", () => {
    expect(actionForKey(down("ArrowRight", { shiftKey: true }))).toEqual({ type: "rotate", delta: 1 });
  });

  it("Shift+Left nudges one degree anticlockwise", () => {
    expect(actionForKey(down("ArrowLeft", { shiftKey: true }))).toEqual({ type: "rotate", delta: -1 });
  });

  it("tracks Shift down and up so the canvas can gate its snaps", () => {
    expect(actionForKey(down("Shift", { shiftKey: true }))).toEqual({ type: "shift-down" });
    expect(actionForKey({ ...down("Shift"), type: "keyup" })).toEqual({ type: "shift-up" });
  });

  it("does not fire shift-down once per auto-repeat tick", () => {
    expect(actionForKey({ ...down("Shift", { shiftKey: true }), repeat: true })).toBeNull();
  });

  it("leaves Ctrl+Left/Right as image navigation", () => {
    expect(actionForKey(down("ArrowRight", { ctrlKey: true }))).toEqual({ type: "next" });
    expect(actionForKey(down("ArrowLeft", { ctrlKey: true }))).toEqual({ type: "prev" });
  });

  it("still treats a bare letter as a class hotkey", () => {
    expect(actionForKey(down("3"))).toEqual({ type: "class-key", key: "3" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C frontend test -- hotkeys
```

Expected: FAIL — `Shift+ArrowRight` currently returns `null`.

- [ ] **Step 3: Add the actions to the key map**

In `frontend/src/editor/hotkeys.ts`, add to the `EditorAction` union:

```ts
  | { type: "rotate"; delta: number }
  | { type: "shift-down" }
  | { type: "shift-up" }
```

In `actionForKey`, add a Shift block immediately after the existing `if (e.key === " ") { ... }` block — it must sit **above** the `if (e.type !== "keydown") return null;` line so keyup is seen:

```ts
  if (e.key === "Shift") {
    if (e.type === "keyup") return { type: "shift-up" };
    return e.repeat ? null : { type: "shift-down" };
  }
```

Then replace the existing `if (e.shiftKey) return null;` line with:

```ts
  if (e.shiftKey) {
    // Rotation nudges. A bare letter is a class hotkey (see below), so these need a modifier.
    if (e.key === "ArrowRight") return { type: "rotate", delta: 1 };
    if (e.key === "ArrowLeft") return { type: "rotate", delta: -1 };
    return null;
  }
```

Add to `HOTKEY_HELP`, directly after the `Ctrl+D` entry:

```ts
  { keys: "rotate handle", does: "rotate the selected box; hold Shift to snap to 15°" },
  { keys: "Shift+Right / Shift+Left", does: "rotate the selected box by 1°" },
```

- [ ] **Step 4: Add `shiftHeld` to the store**

In `frontend/src/store/editor.ts`, in the `EditorState` interface directly after `spaceHeld: boolean;`:

```ts
  /** Gates the canvas rotation snaps; tracked exactly as `spaceHeld` is. */
  shiftHeld: boolean;
```

Add the setter to the interface beside `setSpaceHeld`:

```ts
  setShiftHeld: (held: boolean) => void;
```

In the initial state, after `spaceHeld: false,`:

```ts
  shiftHeld: false,
```

And beside `setSpaceHeld` in the store body:

```ts
  setShiftHeld: (held) => set({ shiftHeld: held }),
```

- [ ] **Step 5: Add the rotate action**

In `frontend/src/editor/useEditorActions.ts`, add to the `EditorActions` interface after `duplicateSelected`:

```ts
  rotateSelected: (delta: number) => Promise<void>;
```

and to the returned object, after the `duplicateSelected` binding:

```ts
      rotateSelected: (delta) =>
        queued(async () => {
          const st = state();
          const id = st.selectedId;
          const box = id ? st.boxes[id] : undefined;
          if (!id || !box) return;
          const before = orientedRectOf(box);
          await cmdUpdateRect(ctx, id, before, roundOriented({ ...before, angle: before.angle + delta }));
        }),
```

Add `orientedRectOf` and `roundOriented` to the geometry import (they become value imports, so split them out of the `import type` line).

- [ ] **Step 6: Wire the three actions into the hook**

In `frontend/src/editor/useEditorHotkeys.ts`, add these cases to the switch, beside `space-down` / `space-up`:

```ts
        case "shift-down":
          st.setShiftHeld(true);
          return;
        case "shift-up":
          st.setShiftHeld(false);
          return;
        case "rotate":
          e.preventDefault();
          void actions.rotateSelected(action.delta);
          return;
```

`shift-down` / `shift-up` deliberately do **not** call `preventDefault` — Shift alone has no default to suppress, and swallowing it would break text selection elsewhere.

In the cleanup function, beside the existing `setSpaceHeld(false)`:

```ts
      useEditorStore.getState().setShiftHeld(false);
```

- [ ] **Step 7: Run the tests to verify they pass**

```
pnpm -C frontend test -- hotkeys
pnpm -C frontend test
pnpm -C frontend lint
```

Expected: PASS, including `EditorToolbar.test.tsx` if it asserts on `HOTKEY_HELP` length — update that expectation if so.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/editor/hotkeys.ts frontend/src/editor/hotkeys.test.ts \
  frontend/src/editor/useEditorHotkeys.ts frontend/src/editor/useEditorActions.ts \
  frontend/src/store/editor.ts
git commit -m "feat(editor): track Shift and add the 1-degree rotation nudges

Shift+Left/Right rotate the selected box; Shift itself is tracked in the
store like spaceHeld so the canvas can gate its snap list on it. Bare
letters stay class hotkeys."
```

---

## Task 6: The rotate handle on the canvas

The task the operator actually asked for.

**Files:**
- Modify: `frontend/src/editor/BoxLayer.tsx` (whole file — props, `syncNode` at :50, `commit` at :59, the `Rect` render, the `Text` labels, the `Transformer` at :140)
- Test: `frontend/src/editor/BoxLayer.test.tsx` (**new**)

**Interfaces:**
- Consumes: `OrientedRect`, `cornersOf`, `clampOriented`, `roundOriented`, `orientedRectOf` (Task 3); `shiftHeld` (Task 5); `commitRect` (Task 4).
- Produces: `BoxLayer` prop `onCommitRect: (id: string, before: OrientedRect, after: OrientedRect) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/editor/BoxLayer.test.tsx`. Mock `react-konva` so the shapes render as inspectable DOM — jsdom has no canvas, and the point under test is which props reach Konva, not what Konva paints:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoxLayer } from "./BoxLayer";
import { useEditorStore } from "@/store/editor";
import { classes, imageRow, personBox } from "@/test/fixtures";

vi.mock("react-konva", () => {
  const node = (tag: string) => (props: Record<string, unknown>) => (
    <div
      data-konva={tag}
      data-name={String(props.name ?? "")}
      data-x={String(props.x ?? "")}
      data-y={String(props.y ?? "")}
      data-rotation={String(props.rotation ?? "")}
      data-offset-x={String(props.offsetX ?? "")}
      data-offset-y={String(props.offsetY ?? "")}
      data-rotate-enabled={String(props.rotateEnabled ?? "")}
      data-rotation-snaps={JSON.stringify(props.rotationSnaps ?? null)}
    >
      {props.children as React.ReactNode}
    </div>
  );
  return { Layer: node("layer"), Rect: node("rect"), Text: node("text"), Transformer: node("transformer") };
});

function seed(angle: number, shiftHeld = false) {
  const box = { ...personBox, angle };
  useEditorStore.setState({
    image: imageRow,
    boxes: { [box.id]: box },
    order: [box.id],
    selectedId: box.id,
    shiftHeld,
  });
  return box;
}

describe("BoxLayer rotation", () => {
  it("pivots a box about its centre", () => {
    const box = seed(45);
    render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    const node = document.querySelector(`[data-name="box ${box.id}"]`)!;
    expect(node.getAttribute("data-rotation")).toBe("45");
    expect(node.getAttribute("data-offset-x")).toBe(String(box.w / 2));
    expect(node.getAttribute("data-offset-y")).toBe(String(box.h / 2));
    expect(node.getAttribute("data-x")).toBe(String(box.x + box.w / 2));
    expect(node.getAttribute("data-y")).toBe(String(box.y + box.h / 2));
  });

  it("enables the rotate handle", () => {
    seed(0);
    render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    const tr = document.querySelector('[data-konva="transformer"]')!;
    expect(tr.getAttribute("data-rotate-enabled")).toBe("true");
  });

  it("offers snaps only while Shift is held", () => {
    seed(0, false);
    const { unmount } = render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    expect(
      JSON.parse(document.querySelector('[data-konva="transformer"]')!.getAttribute("data-rotation-snaps")!),
    ).toEqual([]);
    unmount();
    seed(0, true);
    render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    expect(
      JSON.parse(document.querySelector('[data-konva="transformer"]')!.getAttribute("data-rotation-snaps")!),
    ).toEqual([0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]);
  });

  it("anchors the label to the top-most corner of a rotated box", () => {
    // personBox is 140x90 at (512, 300), so its centre is (582, 345). Rotated 90 degrees the
    // footprint becomes 90x140, whose top edge is at 345 - 70 = 275 — above the unrotated 300.
    const box = seed(90);
    render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    const label = document.querySelector('[data-konva="text"]')!;
    expect(Number(label.getAttribute("data-y"))).toBeLessThan(box.y);
  });

  it("leaves an unrotated box's label where it has always been", () => {
    const box = seed(0);
    render(<BoxLayer classes={classes} onCommitRect={vi.fn()} />);
    const label = document.querySelector('[data-konva="text"]')!;
    expect(Number(label.getAttribute("data-x"))).toBe(box.x);
  });
});
```

Before writing this file, open `frontend/src/test/fixtures.ts` and use the names it actually exports for the class list and the image row — this plan assumes `classes` and `imageRow`, and the import must match reality.

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C frontend test -- BoxLayer
```

Expected: FAIL — no rotation, offset or `rotateEnabled` props reach the mocked nodes.

- [ ] **Step 3: Render the rotation**

In `frontend/src/editor/BoxLayer.tsx`, change the geometry import:

```ts
import {
  clampOriented,
  cornersOf,
  MIN_BOX_SIDE,
  orientedRectOf,
  roundOriented,
  type OrientedRect,
} from "./geometry";
```

Change the prop type:

```ts
  onCommitRect: (id: string, before: OrientedRect, after: OrientedRect) => Promise<void>;
```

Read the modifier beside the existing `spaceHeld` selector:

```ts
  const shiftHeld = useEditorStore((s) => s.shiftHeld);
```

Add the snap list beside the other module constants, above the component:

```ts
/**
 * Every 15 degrees. The list runs to 345 even though a stored `angle` is always in [0, 180):
 * Konva's node rotation is free to pass through 180 during a drag, and normalisation happens once
 * on commit. The node and the store are allowed to disagree during a drag and only during a drag.
 */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);
```

In the `Rect` render, replace the four position props with the centre-pivot form and add the rotation:

```tsx
            x={b.x + b.w / 2}
            y={b.y + b.h / 2}
            offsetX={b.w / 2}
            offsetY={b.h / 2}
            width={b.w}
            height={b.h}
            rotation={b.angle}
```

- [ ] **Step 4: Commit the rotation on transform**

Replace `syncNode` and `commit`:

```ts
  /** The Konva node follows the store again: the saved box on success, the old one on failure. */
  const syncNode = (id: string) => {
    const node = nodeRefs.current.get(id);
    const box = useEditorStore.getState().boxes[id];
    if (!node || !box) return;
    node.scale({ x: 1, y: 1 });
    node.setAttrs({
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
      offsetX: box.w / 2,
      offsetY: box.h / 2,
      width: box.w,
      height: box.h,
      rotation: box.angle,
    });
    node.getLayer()?.batchDraw();
  };

  const commit = (id: string, e: KonvaEventObject<Event>) => {
    const box = boxes[id];
    const node = e.target as Konva.Rect;
    if (!box) return;
    // The node is centre-pivoted, so node.x()/y() is the centre; the store wants the unrotated
    // top-left, which is the centre minus half the (scaled) side lengths.
    const w = node.width() * node.scaleX();
    const h = node.height() * node.scaleY();
    const after = clampOriented(
      { x: node.x() - w / 2, y: node.y() - h / 2, w, h, angle: node.rotation() },
      image,
    );
    node.scale({ x: 1, y: 1 });
    node.setAttrs({
      x: after.x + after.w / 2,
      y: after.y + after.h / 2,
      offsetX: after.w / 2,
      offsetY: after.h / 2,
      width: after.w,
      height: after.h,
      rotation: after.angle,
    });
    void onCommitRect(id, orientedRectOf(box), roundOriented(after))
      .catch((err: unknown) => pushLog(`commit rect failed: ${String(err)}`))
      .then(() => syncNode(id));
  };
```

`clampOriented` normalises the angle, so a handle dragged past 180 lands back in range on save.

- [ ] **Step 5: Anchor the label to the top-most corner**

Replace the `Text` block:

```tsx
      {list.map((b) => {
        // A rotated box's unrotated top-left can end up inside or under the shape, so the label
        // hangs off whichever corner is highest on screen.
        const top = cornersOf(orientedRectOf(b)).reduce((a, p) => (p.y < a.y ? p : a));
        return (
          <Text
            key={`label-${b.id}`}
            x={top.x}
            y={top.y - px(14)}
            text={`${nameOf(classes, b.class_id)}${b.confidence !== null ? ` ${Math.round(b.confidence * 100)}%` : ""}`}
            fontSize={px(12)}
            fill={colourOf(classes, b.class_id)}
            listening={false}
          />
        );
      })}
```

- [ ] **Step 6: Enable the handle**

Replace the `Transformer`:

```tsx
        <Transformer
          ref={trRef}
          listening={!spaceHeld}
          rotateEnabled
          rotationSnaps={shiftHeld ? ROTATION_SNAPS : []}
          rotationSnapTolerance={7}
          keepRatio={false}
          ignoreStroke
          anchorSize={8}
          borderEnabled={false}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_BOX_SIDE * scale || newBox.height < MIN_BOX_SIDE * scale ? oldBox : newBox
          }
        />
```

- [ ] **Step 7: Run the tests to verify they pass**

```
pnpm -C frontend test -- BoxLayer
pnpm -C frontend test
pnpm -C frontend lint
pnpm -C frontend build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/editor/BoxLayer.tsx frontend/src/editor/BoxLayer.test.tsx
git commit -m "feat(editor): rotate a box from the canvas

The Transformer's rotate handle is enabled and the Rect is pivoted about
its centre. Shift gates a 15-degree snap list. The class label hangs off
whichever corner is highest on screen, so it stays legible at any angle."
```

---

## Task 7: Angle in the exports

**Files:**
- Modify: `backend/app/exports/rows.py:20-32` (`ExportBox`), `:105-120` (construction)
- Modify: `backend/app/exports/csv_out.py:19-36` (`DETECTIONS_COLUMNS`), `:80-100` (`_write_detections`)
- Modify: `backend/app/exports/coco_out.py:38-55`
- Modify: `backend/app/exports/html_out.py:47-67` (`_dashed_rectangle`), `:108-120` (drawing loop)
- Modify: `backend/app/exports/yolo_out.py:26-27` (`_as_box_dicts`)
- Modify: `backend/tests/test_exports_labels.py:14-30` (`_box` helper needs `angle=0`)
- Test: `backend/tests/test_exports_csv.py`, `backend/tests/test_exports_html.py`, `backend/tests/test_exports_labels.py`

**Interfaces:**
- Consumes: `Box.angle` (Task 1); `corners_of`, `aabb_of` (Task 2).
- Produces: `ExportBox.angle: float`.

**Why `yolo_out` is in this task.** `yolo_out._as_box_dicts` (`:26`) hands `x, y, w, h` to `_label_text`, which is the *unrotated* box. For a rotated box that is not a loose label, it is a **wrong** one — the exported rectangle does not contain the object. Wave 1 keeps the 5-number detect format, so the honest value is the axis-aligned **envelope**, which does contain it. (The spec's section 4.7 omitted this file; it is caught here.)

- [ ] **Step 1: Write the failing tests**

`ExportBox` gains a required field, so **first** add `angle=0,` to the `base` dict in `_box` at `backend/tests/test_exports_labels.py:14` — every existing test in that module constructs boxes through it.

Append to `backend/tests/test_exports_csv.py`:

```python
def test_detections_csv_has_an_angle_column_after_h(handle, two_images, tmp_path):
    """`angle` sits directly after `h` so a reader meets the whole geometry as one block."""
    assert csv_out.DETECTIONS_COLUMNS.index("angle") == csv_out.DETECTIONS_COLUMNS.index("h") + 1
    images, classes = rows.load(handle)
    csv_out.write(images, classes, tmp_path)
    table = list(csv.reader(_read(tmp_path / "detections.csv").splitlines()))
    assert table[0].index("angle") == table[0].index("h") + 1
    # Every box in the fixture is unrotated, so every row reports 0.0.
    assert {r[table[0].index("angle")] for r in table[1:]} == {"0.0"}


def test_detections_csv_reports_a_rotated_angle(handle, two_images, tmp_path):
    with handle.session() as s:
        box = s.execute(select(Box).order_by(Box.created_at)).scalars().first()
        box.angle = 37.5
    images, classes = rows.load(handle)
    csv_out.write(images, classes, tmp_path)
    table = list(csv.reader(_read(tmp_path / "detections.csv").splitlines()))
    assert "37.5" in {r[table[0].index("angle")] for r in table[1:]}
```

Add `from sqlalchemy import select` to that file's imports if it is not already there.

Append to `backend/tests/test_exports_labels.py`:

```python
def test_coco_bbox_is_the_envelope_and_segmentation_is_the_quad(tmp_path):
    """COCO has no rotated-box standard: `bbox` stays axis-aligned for every existing reader,
    and `segmentation` carries the exact rotated shape for anything that understands it."""
    images = [_image(boxes=[_box(x=10, y=20, w=30, h=40, angle=90)])]
    coco_out.write(images, CLASSES, tmp_path)
    ann = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))["annotations"][0]
    # A 30x40 box about centre (25, 40), turned 90 degrees, occupies a 40x30 footprint at (5, 25).
    assert ann["bbox"] == pytest.approx([5.0, 25.0, 40.0, 30.0])
    assert ann["area"] == pytest.approx(30 * 40)  # rotation does not change area
    assert len(ann["segmentation"]) == 1
    assert len(ann["segmentation"][0]) == 8


def test_coco_leaves_an_unrotated_annotation_exactly_as_it_was(tmp_path):
    images = [_image(boxes=[_box(x=10, y=20, w=30, h=40)])]
    coco_out.write(images, CLASSES, tmp_path)
    ann = json.loads((tmp_path / "labels_coco.json").read_text("utf-8"))["annotations"][0]
    assert ann["bbox"] == [10.0, 20.0, 30.0, 40.0]
    assert "segmentation" not in ann


def test_yolo_results_export_writes_the_envelope_of_a_rotated_box(tmp_path):
    """Wave 1 keeps the 5-number detect format, so a rotated box exports as its envelope —
    a loose label that still contains the object, never the unrotated box, which would not."""
    images = [_image(width=100, height=100, boxes=[_box(x=10, y=20, w=30, h=40, angle=90)])]
    yolo_out.write(images, CLASSES, tmp_path)
    line = (tmp_path / "labels_yolo" / "a.txt").read_text("utf-8").strip()
    index, cx, cy, w, h = line.split()
    assert index == "0"
    assert float(cx) == pytest.approx(0.25)  # centre is unchanged by rotation
    assert float(cy) == pytest.approx(0.40)
    assert float(w) == pytest.approx(0.40)  # 40 wide after the turn, not 30
    assert float(h) == pytest.approx(0.30)
```

Confirm `_label_path` puts `images/a.jpg` at `labels_yolo/a.txt` (it strips the leading `images/`) before relying on that path.

- [ ] **Step 2: Run the tests to verify they fail**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_exports_csv.py tests/test_exports_labels.py -v
```

Expected: FAIL — no `angle` column, no `segmentation` key.

- [ ] **Step 3: Carry the angle into the export rows**

In `backend/app/exports/rows.py`, add to `ExportBox` after `h: float`:

```python
    angle: float
```

and to its construction in `load`, after `h=b.h,`:

```python
                    angle=b.angle,
```

- [ ] **Step 4: Add the CSV column**

In `backend/app/exports/csv_out.py`, insert `"angle",` into `DETECTIONS_COLUMNS` directly after `"h",`, and `_num(box.angle),` into the `_write_detections` row directly after `_num(box.h),`.

- [ ] **Step 5: Write the COCO envelope and polygon**

In `backend/app/exports/coco_out.py`, add the import:

```python
from app.geometry import aabb_of, corners_of
```

and replace the annotation construction:

```python
            bx, by, bw, bh = aabb_of(box.x, box.y, box.w, box.h, box.angle)
            ann = {
                "id": ann_id,
                "image_id": image_id,
                "category_id": cat_id,
                # COCO has no rotated-box standard. `bbox` stays the axis-aligned envelope so every
                # existing reader keeps working; `segmentation` carries the exact rotated quad for
                # anything that understands it. Nothing is lost and nothing breaks.
                "bbox": [bx, by, bw, bh],
                # Rotation does not change area, so this stays the true box area, not the envelope's.
                "area": box.w * box.h,
                "iscrowd": 0,
                # Present on every annotation (not only unreviewed ones): a reader must be able to
                # tell an accepted/edited box from an unreviewed proposal without cross-referencing
                # the CSV, especially once include_unreviewed mixes both into this one file.
                "review_state": box.review_state,
            }
            if box.angle:
                ann["segmentation"] = [
                    [c for pt in corners_of(box.x, box.y, box.w, box.h, box.angle) for c in pt]
                ]
```

`segmentation` is omitted entirely for an unrotated box — `bbox` already says everything, and an unconditional polygon would change every existing export for no gain.

- [ ] **Step 6: Export the envelope, not the unrotated box, in the YOLO results export**

In `backend/app/exports/yolo_out.py`, add the import:

```python
from app.geometry import aabb_of
```

and replace `_as_box_dicts`:

```python
def _as_box_dicts(image: ExportImage) -> list[dict]:
    """Rotated boxes export as their axis-aligned envelope.

    Wave 1 keeps the 5-number detect format, and the envelope is the honest value for it: it is a
    loose label, but it still contains the object. Writing the *unrotated* x/y/w/h instead would
    write a rectangle that does not — a wrong label, not merely a loose one. Wave 2 replaces this
    with the 8-corner OBB format and the looseness goes away.
    """
    out = []
    for b in image.boxes:
        x, y, w, h = aabb_of(b.x, b.y, b.w, b.h, b.angle)
        out.append({"class_id": b.class_id, "x": x, "y": y, "w": w, "h": h})
    return out
```

- [ ] **Step 7: Draw the rotated quad in the HTML report**

In `backend/app/exports/html_out.py`, add the import:

```python
from app.geometry import corners_of
```

Generalise `_dashed_rectangle` into `_dashed_polygon` (a rectangle is the 4-corner case):

```python
def _dashed_polygon(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    colour: tuple[int, int, int],
    width: int = 2,
    dash: float = 6,
    gap: float = 4,
) -> None:
    """An unreviewed proposal's outline: a solid polygon would look identical to ground truth."""
    for i, start in enumerate(points):
        end = points[(i + 1) % len(points)]
        span = math.dist(start, end)
        if span == 0:
            continue
        ux, uy = (end[0] - start[0]) / span, (end[1] - start[1]) / span
        travelled = 0.0
        while travelled < span:
            seg = min(dash, span - travelled)
            a = (start[0] + ux * travelled, start[1] + uy * travelled)
            b = (start[0] + ux * (travelled + seg), start[1] + uy * (travelled + seg))
            draw.line([a, b], fill=colour, width=width)
            travelled += dash + gap
```

Add `import math` at the top if it is not already there, and replace the drawing loop body:

```python
    for box in boxes:
        colour = colour_by_id.get(box.class_id, (255, 0, 0))
        pts = [
            (px * total_x, py * total_y)
            for px, py in corners_of(box.x, box.y, box.w, box.h, box.angle)
        ]
        label = name_by_id.get(box.class_id, box.class_id)
        if box.review_state == "unreviewed":
            _dashed_polygon(draw, pts, colour)
            label = f"{label} ?"
        else:
            draw.polygon(pts, outline=colour, width=2)
        anchor = min(pts, key=lambda p: p[1])
        draw.text((anchor[0] + 2, max(0, anchor[1] - 11)), label, fill=colour)
```

- [ ] **Step 8: Run the tests to verify they pass**

```
cd backend; .\.venv\Scripts\python.exe -m pytest tests/test_exports_csv.py tests/test_exports_html.py tests/test_exports_labels.py tests/test_exports_job.py -v
```

Expected: PASS. Existing golden expectations that list CSV columns need the new `angle` column added — that is the correct fix, not a reason to move the column.

- [ ] **Step 9: Run the full backend suite**

```
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/app/exports/rows.py backend/app/exports/csv_out.py \
  backend/app/exports/coco_out.py backend/app/exports/html_out.py backend/tests/
git commit -m "feat(exports): carry the box angle into every export format

CSV gains an angle column. COCO keeps an axis-aligned bbox for existing
readers and adds a 4-corner segmentation polygon when the box is rotated.
The HTML report draws the rotated quad."
```

---

## Task 8: Say plainly that Wave 1 does not train on the angle

Without this, the UI implies rotation reaches the model. It does not, until Wave 2.

**Files:**
- Modify: `frontend/src/datasets/NewDatasetForm.tsx`
- Test: `frontend/src/datasets/NewDatasetForm.test.tsx`

**Interfaces:**
- Consumes: `Alert` from `@/ui`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/datasets/NewDatasetForm.test.tsx`:

```tsx
it("warns that a frozen dataset does not yet carry box rotation", () => {
  renderForm();
  expect(screen.getByText(/rotation/i)).toBeInTheDocument();
});
```

Reuse whatever render helper the file already defines instead of `renderForm` if it differs.

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C frontend test -- NewDatasetForm
```

Expected: FAIL — no matching text.

- [ ] **Step 3: Add the line**

In `frontend/src/datasets/NewDatasetForm.tsx`, directly above the submit `Button` row:

```tsx
          <Alert tone="info">
            Box rotation is saved with your labels but is not yet part of a frozen dataset — this
            dataset trains on upright boxes. Rotated training arrives with oriented-box support.
          </Alert>
```

Make sure `Alert` is in the `@/ui` import — the file already imports it for the error case.

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm -C frontend test -- NewDatasetForm
pnpm -C frontend lint
```

Expected: PASS.

- [ ] **Step 5: Run the full gate**

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/datasets/NewDatasetForm.tsx frontend/src/datasets/NewDatasetForm.test.tsx
git commit -m "feat(datasets): say that a frozen dataset does not carry rotation yet

Wave 1 stores the angle but materialises upright labels. The operator is
told before spending an afternoon rotating, not after. This line is
deleted in wave 2."
```

---

## Operator walkthrough ("how to test this")

Required by `AGENTS.md` before the branch is done. Numbered, from a built app:

1. Open a project with at least one imported image and press **E** to open the editor on it.
2. Drag on the image to draw a box. It appears upright, as before.
3. Click the box. A **rotate handle** now appears above it, separate from the corner resize handles.
4. Drag the rotate handle. The box turns about its own centre, and the class label stays above the box's highest corner.
5. Hold **Shift** while dragging the handle. The box snaps every 15 degrees. Release Shift and it turns freely again.
6. With the box selected, press **Shift+Right** four times. The box turns 4 degrees clockwise. **Shift+Left** turns it back.
7. Press **Ctrl+Z**. The rotation undoes one step at a time. **Ctrl+Y** redoes it.
8. Press **Ctrl+D**. The duplicate appears offset down-right at **the same angle**.
9. Press **Ctrl+Right** to the next image and **Ctrl+Left** back. The rotated box is still rotated — it was saved.
10. Rotate a box near the right edge of the image until it hangs over the edge. It stays put; it is not shoved or shrunk. Drag it until its *centre* passes the edge and it is pulled back.
11. Export results as CSV. `detections.csv` has an **angle** column after `h`, carrying the degrees you set.
12. Export as COCO. In `labels_coco.json`, a rotated annotation has an axis-aligned `bbox` **and** a `segmentation` polygon of 8 numbers; an unrotated one has `bbox` only.
13. Export as YOLO labels. A rotated box's `.txt` line carries the **envelope** — wider and shorter than the box you drew, but still containing the machine. This is the looseness Wave 2 removes.
14. Export the HTML report. Thumbnails draw rotated boxes as tilted quads, dashed for unreviewed proposals.
15. Open **New dataset**. The info line states that this dataset trains on upright boxes.

Step 15 is the honest limit of Wave 1: rotation is stored, shown and exported, but not yet trained on.
