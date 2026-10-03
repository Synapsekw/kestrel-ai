# Asset findings J4: grouping, merge, split, regroup and the asset finding service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Asset findings work end to end in the backend:
- `POST /findings` takes an `asset` anchor with sightings and draws one box per sighting through the existing annotation path.
- Sightings group into findings with the `asset_group` job (Regroup), and the operator can merge and split by hand.
- Deleting a box or an image removes its sightings; a finding left with none is closed with a comment, never deleted.
- The register can filter and sort by the asset fields.

**Architecture:**
- `backend/app/asset_review/group.py`:
  - the pure `group_sightings` (union-find with a spatial hash, a port of kit `records.py` lines 142 to 160);
  - `apply_groups` with the Regroup rules of spec §6.4;
  - `merge` and `split`.
- `backend/app/asset_review/jobs_group.py`: the `asset_group` job and `submit_group`. `backend/app/asset_review/group_router.py`: the Regroup route.
- `backend/app/findings/sightings.py` (new) is the one place that:
  - adds and removes sightings;
  - picks the representative sighting;
  - writes a finding's derived asset columns;
  - closes an emptied finding.
- The findings package learns the `asset` anchor:
  - `anchors.py`: resolve and immutability;
  - `service.py`: create, type change, delete;
  - `annotations.py`: box and image hooks;
  - `query.py`: filters and sorts;
  - `router.py` and `schemas.py`: create, merge, split, sightings;
  - `backfill.py` and `thumbnails.py`.
- `findings/counts.py` stays the only writer of `finding_count`. Every create, close and delete here goes through `service.create_in_session`, `service.patch_in_session` or `service.delete_in_session`, which call `counts.change`.

**Tech Stack:** FastAPI, SQLAlchemy (SQLite), pytest. No new dependency.

**Spec sections covered:** §4 decisions A1, A2, A3; §5.5 and §5.6 (behaviour; D1 owns the columns); §6.4; §8 rows `POST /findings` (asset), `POST /findings/{id}/merge`, `POST /findings/{id}/split`, `GET /findings/{id}/sightings`, `POST /asset-models/{id}/findings/regroup`, `GET /findings` filters and sorts; §9 register gallery thumbnails (the representative crop); §12 "Grouping" tests.

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`.

**Needs:**
- C0 merged, for the contract and the 501 stubs this unit removes.
- D1 merged, for migration 0016, the ORM classes and `FindingOut`'s asset fields. Read "Index notes" N1 first: J4 needs two things from D1 that the spec table does not spell out.
- P1 merged, for `profiles.resolve`, `ReviewConfig`, `Frame` and `derive`.

**Worktree:** `scripts\start-task.ps1 -Name af-j4`.

---

## Budget and execution DAG

**Background jobs:**
- `asset_group` is the only long piece of work. Regroup starts it, and so do J3 (after `asset_place`) and J5 (after import).
- Merge and split are synchronous routes (index amendment): they touch at most a few dozen rows.

**Bounded reads:**
- `group.load_items` reads scalar columns only (id, class, placement, centre, tag): one row per sighting of one asset model (1,441 for DAMAC).
- The representative lookup for a register page reads only the sightings of that page's findings, at most 500.
- The thumbnail reads one image per crop, then the cache, as today.
- Nothing here opens a photo set, a mask or a mesh.

**Tasks:**

| Task | Builds | Depends on |
| --- | --- | --- |
| 1 | Pure `group_sightings` | none (pure) |
| 2 | `findings/sightings.py`, asset anchor, `POST /findings` asset, representative, `GET /findings/{id}/sightings`, thumbnails | D1, P1 |
| 3 | `apply_groups`, `merge`, `split`, `asset_group` job, merge, split and Regroup routes (Review Focus 1) | 1, 2 |
| 4 | Box and image hooks, backfill exclusion, adoption guard (Review Focus 4) | 2, 3 (`split_in_session`) |
| 5 | List filters `asset_model_id`, `zone`, `side`, `component`, `placed`; `anchor_kind=asset`; sorts `-height`, `zone` | 2 |
| 6 | Unit gate | all |

**Parallel batches:**
1. Tasks 1 and 2.
2. Tasks 3 and 5.
3. Task 4.
4. Task 6.

**Critical path:** 2, 3, 4, 6.

Tasks 3 and 5 both edit `findings/router.py` in different functions. If they run as parallel subagents, merge Task 5 after Task 3.

---

### Task 1: Pure grouping (`group_sightings`)

**Files:**
- Create: `backend/app/asset_review/group.py`
- Test: `backend/tests/test_asset_group_pure.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `app.asset_review.group.GroupItem(id: str, type_id: str, center: tuple[float, float, float] | None = None, group_tag: str | None = None, image_id: str | None = None)` (frozen dataclass)
  - `app.asset_review.group.group_sightings(items: Sequence[GroupItem], cluster_m: float) -> list[list[str]]` (region unit). Each group's ids are sorted. Groups come placed first, then highest centre first, ties by the smallest id. Raises `ValueError` when `cluster_m` is not a finite positive number.
  - `app.asset_review.group.group_by_photo(items: Sequence[GroupItem]) -> list[list[str]]` (photo unit, coordinator ruling from J5 N3/N7). Every sighting on one photo forms one group, whatever the distance, tag or placement. The key is `(image_id, type_id)`, because a finding has one type. Groups use the same order as `group_sightings`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_asset_group_pure.py`:

```python
"""Pure grouping (spec 2026-10-02-asset-findings §6.4, §12 "Grouping"): union-find over sightings of
one type, joined by distance or by a shared tag; a spatial hash keeps it O(n)."""

import math
import random

import pytest

from app.asset_review.group import GroupItem, group_by_photo, group_sightings


def _item(sid, center=None, *, type_id="crack", tag=None, image_id=None) -> GroupItem:
    return GroupItem(id=sid, type_id=type_id, center=center, group_tag=tag, image_id=image_id)


def test_photo_unit_two_photos_a_tenth_of_a_metre_apart_stay_two_groups():
    items = [_item("a", (0.0, 10.0, 0.0), image_id="p1"), _item("b", (0.1, 10.0, 0.0), image_id="p2")]
    assert group_by_photo(items) == [["a"], ["b"]]


def test_photo_unit_five_region_sightings_on_one_photo_are_one_group():
    items = [
        _item("a", (0.0, 10.0, 0.0), image_id="p1"),
        _item("b", (8.0, 2.0, 0.0), image_id="p1"),
        _item("c", None, image_id="p1"),
        _item("d", (0.0, 30.0, 5.0), image_id="p1", tag="X"),
        _item("e", None, image_id="p1", tag="Y"),
    ]
    assert group_by_photo(items) == [["a", "b", "c", "d", "e"]]


def test_photo_unit_ignores_tags_across_photos_and_orders_placed_first_highest_first():
    items = [
        _item("low", (0.0, 3.0, 0.0), image_id="p1", tag="T"),
        _item("loose", None, image_id="p2", tag="T"),
        _item("high", (0.0, 25.0, 0.0), image_id="p3"),
    ]
    assert group_by_photo(items) == [["high"], ["low"], ["loose"]]


def test_a_chain_joins_through_the_middle_sighting():
    items = [_item("a", (0.0, 0.0, 0.0)), _item("b", (0.6, 0.0, 0.0)), _item("c", (1.2, 0.0, 0.0))]
    assert group_sightings(items, 0.75) == [["a", "b", "c"]]


def test_two_types_never_join_however_close():
    items = [_item("a", (0.0, 5.0, 0.0)), _item("b", (0.1, 5.0, 0.0), type_id="rust")]
    assert sorted(group_sightings(items, 0.75)) == [["a"], ["b"]]


def test_a_tag_joins_far_and_unplaced_sightings_of_one_type():
    items = [
        _item("a", (0.0, 1.0, 0.0), tag="D07"),
        _item("b", None, tag="D07"),
        _item("c", (50.0, 1.0, 0.0), tag="D07"),
        _item("d", None, tag="D07", type_id="rust"),
    ]
    assert group_sightings(items, 0.75) == [["a", "b", "c"], ["d"]]


def test_an_unplaced_sighting_is_a_singleton():
    items = [_item("a"), _item("b")]
    assert group_sightings(items, 0.75) == [["a"], ["b"]]


def test_groups_come_placed_first_then_highest_first():
    items = [
        _item("low", (0.0, 3.0, 0.0)),
        _item("loose"),
        _item("high", (0.0, 25.0, 0.0)),
        _item("mid", (0.0, 12.0, 0.0)),
    ]
    assert group_sightings(items, 0.75) == [["high"], ["mid"], ["low"], ["loose"]]


def test_the_distance_is_inclusive_and_three_dimensional():
    items = [_item("a", (0.0, 0.0, 0.0)), _item("b", (0.0, 0.0, 0.75)), _item("c", (0.0, 0.76, 0.75))]
    assert group_sightings(items, 0.75) == [["c"], ["a", "b"]]


@pytest.mark.parametrize("bad", [0.0, -1.0, math.inf, math.nan])
def test_cluster_m_must_be_a_positive_number(bad):
    with pytest.raises(ValueError):
        group_sightings([_item("a", (0.0, 0.0, 0.0))], bad)


def _brute(items: list[GroupItem], cluster_m: float) -> set[frozenset[str]]:
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            i = parent[i]
        return i

    for i, a in enumerate(items):
        for j in range(i + 1, len(items)):
            b = items[j]
            if a.type_id != b.type_id:
                continue
            near = a.center is not None and b.center is not None and math.dist(a.center, b.center) <= cluster_m
            tagged = a.group_tag is not None and a.group_tag == b.group_tag
            if near or tagged:
                parent[find(j)] = find(i)
    groups: dict[int, set[str]] = {}
    for i, it in enumerate(items):
        groups.setdefault(find(i), set()).add(it.id)
    return {frozenset(g) for g in groups.values()}


def test_the_spatial_hash_matches_brute_force():
    rng = random.Random(7)
    items = []
    for i in range(400):
        center = None if rng.random() < 0.1 else tuple(rng.uniform(-10.0, 10.0) for _ in range(3))
        tag = f"T{rng.randrange(5)}" if rng.random() < 0.05 else None
        items.append(_item(f"s{i:03d}", center, type_id=rng.choice(["crack", "rust"]), tag=tag))
    got = {frozenset(g) for g in group_sightings(items, 1.3)}
    assert got == _brute(items, 1.3)
```

- [ ] **Step 2: Run them and see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_group_pure.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.asset_review.group'`.

- [ ] **Step 3: Implement**

`backend/app/asset_review/group.py`:

```python
"""Grouping sightings into findings (spec 2026-10-02-asset-findings §6.4; decisions A1 and A3).

`group_sightings` is the pure port of the kit's `records.py` lines 142 to 160. It runs union-find
over sightings of one type. Two sightings join when their placed centres are at most `cluster_m`
apart, or when they share a `group_tag`. A spatial hash with `cluster_m` cells keeps it O(n): two
centres within `cluster_m` always sit in neighbouring cells. The kit compared every pair.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

Vec3 = tuple[float, float, float]
_NEIGHBOURS = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)]


@dataclass(frozen=True)
class GroupItem:
    """One sighting as grouping sees it: its id, its type (its box's class) and, when it is placed,
    its centre in the asset frame."""

    id: str
    type_id: str
    center: Vec3 | None = None
    group_tag: str | None = None
    image_id: str | None = None  # the photo; the photo unit groups by it


def _ordered(items: Sequence[GroupItem], members: list[list[int]]) -> list[list[str]]:
    """Placed groups first, then by their highest centre, highest first; ties by the smallest id."""

    def order(group: list[int]) -> tuple[bool, float, str]:
        heights = [items[i].center[1] for i in group if items[i].center is not None]
        return (not heights, -max(heights) if heights else 0.0, min(items[i].id for i in group))

    return [sorted(items[i].id for i in g) for g in sorted(members, key=order)]


def group_by_photo(items: Sequence[GroupItem]) -> list[list[str]]:
    """The photo unit (review `finding_unit == "photo"`, e.g. the stack profile): one finding per
    photo, so every sighting on one image forms one group. Distance and tags are ignored, and
    unplaced sightings follow their photo. The key also holds the type, because a finding has one
    type."""
    members: dict[tuple[str | None, str], list[int]] = defaultdict(list)
    for i, item in enumerate(items):
        key = (item.image_id, item.type_id) if item.image_id is not None else (f"#{item.id}", item.type_id)
        members[key].append(i)
    return _ordered(items, list(members.values()))


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        parent = self.parent
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(self, i: int, j: int) -> None:
        a, b = self.find(i), self.find(j)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def _cell(center: Vec3, size: float) -> tuple[int, int, int]:
    return (math.floor(center[0] / size), math.floor(center[1] / size), math.floor(center[2] / size))


def group_sightings(items: Sequence[GroupItem], cluster_m: float) -> list[list[str]]:
    """Groups of sighting ids, each sorted.

    Groups come placed first, then by their highest centre, highest first, so numbers given in this
    order read top-down. Ties go to the smallest id, so the order is deterministic. An unplaced
    sighting is a group of its own unless a tag joins it."""
    if not (math.isfinite(cluster_m) and cluster_m > 0):
        raise ValueError("cluster_m must be a positive number of metres")
    uf = _UnionFind(len(items))
    cells: dict[tuple[str, int, int, int], list[int]] = defaultdict(list)
    for i, item in enumerate(items):
        if item.center is None:
            continue
        cx, cy, cz = _cell(item.center, cluster_m)
        for dx, dy, dz in _NEIGHBOURS:
            for j in cells.get((item.type_id, cx + dx, cy + dy, cz + dz), ()):
                if math.dist(item.center, items[j].center) <= cluster_m:
                    uf.union(i, j)
        cells[(item.type_id, cx, cy, cz)].append(i)
    tagged: dict[tuple[str, str], int] = {}
    for i, item in enumerate(items):
        if item.group_tag:
            first = tagged.setdefault((item.type_id, item.group_tag), i)
            if first != i:
                uf.union(i, first)
    members: dict[int, list[int]] = defaultdict(list)
    for i in range(len(items)):
        members[uf.find(i)].append(i)
    return _ordered(items, list(members.values()))
```

If `backend/app/asset_review/__init__.py` does not exist yet (C0 or P1 normally creates it), create it with the single line `"""Asset review: profiles, frame, poses, placement, grouping, kit import (spec 2026-10-02-asset-findings)."""`.

- [ ] **Step 4: Run them and see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_group_pure.py -q`
Expected: PASS (14 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_review/group.py backend/tests/test_asset_group_pure.py
git commit -m "feat(asset-review): pure sighting grouping with a spatial hash (J4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `backend/app/asset_review/__init__.py` to `git add` only if this task created it.)

---

### Task 2: Sightings, the asset anchor, `POST /findings` with sightings, the representative

**Files:**
- Create: `backend/app/findings/sightings.py`
- Modify: `backend/app/findings/anchors.py` (`AnchorIn`, `_EMPTY`, `KINDS`, new `_asset`, `resolve`, `repatch`)
- Modify: `backend/app/findings/service.py` (`_create_asset`, `create_finding`, `patch_in_session`, `delete_in_session`)
- Modify: `backend/app/findings/schemas.py` (`AnchorKind`, `SightingIn`, `AssetAnchorIn`, `FindingAnchorIn`, `FindingOut.from_row`, `FindingSightingOut`, `FindingSightingList`)
- Modify: `backend/app/findings/router.py` (`list_findings`, `_detail`, `create_finding`, new `list_finding_sightings`)
- Modify: `backend/app/findings/thumbnails.py` (`finding_thumbnail`)
- Modify: `backend/app/asset_review/stubs.py` (remove `listFindingSightings`)
- Create: `backend/tests/asset_findings_helpers.py`
- Test: `backend/tests/test_asset_findings_create.py`

**Interfaces:**
- Consumes:
  - D1: ORM `FindingSighting` with:
    - `id`, `finding_id` (nullable, see N1), `asset_model_id` (see N1);
    - `image_id`, `annotation_id`, `severity`, `group_tag`, `placement`;
    - `cx`, `cy`, `cz`, `nx`, `ny`, `nz`, `part`, `coverage`, `patch_path`, `placed_version`, `created_at`.
  - D1: `Finding` gains:
    - `asset_model_id`, `asset_version`;
    - `ax`, `ay`, `az`, `an_x`, `an_y`, `an_z`;
    - `placement`, `height_m`, `bearing_deg`, `side`, `zone`, `component`, `sighting_count`.
  - D1: `AssetModel.frame`, `AssetModel.review` (JSON); the anchor CHECK's `asset` branch; `FindingOut` with the asset fields and an `asset` branch in `anchor_of`.
  - P1: `app.asset_review.derive.derive(center, normal, review, frame) -> Derived(height_m, bearing_deg, side, zone)`; `app.asset_review.profiles.ReviewConfig`, `resolve`; `app.asset_review.frame.Frame`.
  - Existing: `app.imagery.annotations.create_shape_in_session`, `reclass_in_session`, `delete_box_in_session`; `app.imagery.summary.touch`.
- Produces:
  - `app.findings.sightings`:
    - `add_sighting(s, handle, *, asset_model_id: str, finding_id: str | None, image_id: str, type_id: str, box: dict | None = None, points: list[list[float]] | None = None, severity: int | None = None, group_tag: str | None = None) -> FindingSighting` (J5 uses it with `finding_id=None`)
    - `refresh(s, finding: Finding) -> FindingSighting | None`
    - `pick_representative(rows) -> FindingSighting | None`
    - `sort_key(row) -> tuple`
    - `representatives(s, finding_ids) -> dict[str, dict]`
    - `of_finding(s, finding_id) -> list[FindingSighting]`
    - `of_box(s, box_id) -> FindingSighting | None`
    - `box_ids(s, finding_id) -> list[str]`
    - `remove(s, *, project_id, catalogue, rows, reason) -> list[str]`
    - `close_with_comment(s, *, project_id, catalogue, finding, text, author="Kestrel") -> None`
    - constants `PLACED`, `SYSTEM_AUTHOR`, `BOX_GONE`, `NOT_A_SIGHTING`, `PHOTOS_GONE`
  - `AnchorIn(kind="asset", asset_model_id=..., sightings=[{image_id, box, points}])`.
  - HTTP: `POST /findings` with `anchor.kind = asset` → 201 `FindingDetail`; `GET /findings/{findingId}/sightings` → 200 `FindingSightingList`.

- [ ] **Step 1: Check that D1 and P1 delivered what this unit consumes**

Run (from `backend/`):

```powershell
& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -c "from app.db.models import Finding, FindingSighting, AssetModel; c = FindingSighting.__table__.c; assert c.finding_id.nullable, 'N1: finding_id must be nullable'; assert 'asset_model_id' in c, 'N1: finding_sighting needs asset_model_id'; need = {'asset_model_id','asset_version','ax','ay','az','an_x','an_y','an_z','placement','height_m','bearing_deg','side','zone','component','sighting_count'}; assert need <= set(Finding.__table__.c.keys()), need - set(Finding.__table__.c.keys()); assert {'frame','review'} <= set(AssetModel.__table__.c.keys()); from app.asset_review.derive import derive; from app.asset_review.frame import Frame; from app.asset_review.profiles import ReviewConfig, resolve; print('ok')"
```

Expected: `ok`. If an `N1` assertion fails, stop and raise it with the controller: J4 cannot group ungrouped sightings without those two columns (Index notes N1). If only an import fails, the producing unit has not merged yet: rebase onto `main` once it has.

- [ ] **Step 2: Write the shared test helpers**

`backend/tests/asset_findings_helpers.py`:

```python
"""Shared helpers for the asset findings tests (plan 2026-10-03-asset-findings-j4). Hand-made rows
only: no customer data (index Global Constraints)."""

from sqlalchemy import select

from app.db.models import AssetModel, Box, Finding, FindingCount, FindingSighting, Image, Source
from app.findings import counts, sightings

API = "/api/v1"
FRAME = {
    "origin": {"lat": 25.0, "lon": 55.0, "ground_alt_m": 3.0},
    "north_offset_deg": 0.0,
    "height_m": 30.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 2.0], [30.0, 1.0]],
    "levels": [],
    "presets": [],
}
RECT = {"x": 10.0, "y": 20.0, "w": 30.0, "h": 40.0, "angle": 0.0}


def review_dict(profile_id: str = "telecom_tower", height_m: float = 30.0) -> dict:
    from app.asset_review.profiles import resolve

    return resolve(profile_id, height_m).model_dump(mode="json")


def make_model(handle, *, name: str = "Tower", review: bool = True, profile_id: str = "telecom_tower") -> str:
    """A ready asset model row with the fixture frame and, unless `review=False`, a resolved profile
    (telecom tower by default: region unit; `profile_id="stack"` is the photo unit). Without a
    review, grouping is region-unit with max(0.75, 0.02 H) = 0.75 m."""
    from app.asset_review.frame import Frame

    Frame.model_validate(FRAME)  # the fixture frame must stay valid for P1's model
    with handle.session() as s:
        row = AssetModel(
            name=name,
            status="ready",
            current_version=1,
            frame=dict(FRAME),
            review=review_dict(profile_id) if review else None,
        )
        s.add(row)
        s.flush()
        return row.id


def make_photos(client, project: dict, import_source, tmp_path, make_jpeg, n: int = 3) -> list[str]:
    """`n` real 320x240 photos imported into `project`; returns their image ids."""
    folder = tmp_path / "photos"
    for i in range(n):
        make_jpeg(folder / f"P_{i:04d}.jpg", 320, 240, seed=i + 1)
    import_source(project["id"], folder)
    items = client.get(f"{API}/projects/{project['id']}/images").json()["items"]
    assert len(items) == n
    return [i["id"] for i in items]


def post_asset(client, project_id: str, type_id: str, model_id: str, photo_ids: list[str], **body) -> dict:
    """`POST /findings` with one rectangle sighting per photo."""
    anchor = {
        "kind": "asset",
        "asset_model_id": model_id,
        "sightings": [{"image_id": pid, "box": RECT} for pid in photo_ids],
    }
    r = client.post(f"{API}/projects/{project_id}/findings", json={"type_id": type_id, "anchor": anchor, **body})
    assert r.status_code == 201, r.text
    return r.json()


def sightings_of(handle, finding_id: str) -> list[FindingSighting]:
    with handle.session() as s:
        rows = sightings.of_finding(s, finding_id)
        for r in rows:
            s.expunge(r)
    return rows


def by_photo(handle, finding_id: str) -> dict[str, FindingSighting]:
    return {r.image_id: r for r in sightings_of(handle, finding_id)}


def update_sighting(handle, sighting_id: str, **fields) -> None:
    with handle.session() as s:
        row = s.get(FindingSighting, sighting_id)
        for k, v in fields.items():
            setattr(row, k, v)


def place(handle, sighting_id: str, center, normal=(1.0, 0.0, 0.0), **fields) -> None:
    """What J3's `asset_place` writes for a point placement."""
    (cx, cy, cz), (nx, ny, nz) = center, normal
    update_sighting(
        handle, sighting_id, placement="point", cx=cx, cy=cy, cz=cz, nx=nx, ny=ny, nz=nz, placed_version=1, **fields
    )


def refresh_finding(handle, finding_id: str) -> None:
    with handle.session() as s:
        sightings.refresh(s, s.get(Finding, finding_id))


def finding_row(handle, finding_id: str) -> Finding | None:
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        if row is not None:
            s.expunge(row)
    return row


def set_finding(handle, finding_id: str, **fields) -> None:
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        for k, v in fields.items():
            setattr(row, k, v)


def seed_images(handle, n: int) -> list[str]:
    """`n` image rows without files (grouping never opens a photo)."""
    with handle.session() as s:
        src = Source(folder="C:/flights/tower", site="T")
        s.add(src)
        s.flush()
        ids = []
        for i in range(n):
            image = Image(path=f"images/tower_{i:03d}.jpg", width=4000, height=3000, source_id=src.id)
            s.add(image)
            s.flush()
            ids.append(image.id)
        return ids


def seed_sighting(
    handle,
    *,
    model_id: str,
    image_id: str,
    type_id: str,
    center=None,
    severity: int | None = 1,
    tag: str | None = None,
    coverage: float | None = None,
) -> str:
    """An ungrouped sighting with its person-drawn box, as J5's import leaves it; placed at `center`
    (normal +X) when given."""
    with handle.session() as s:
        box = Box(
            image_id=image_id,
            class_id=type_id,
            x=100.0,
            y=100.0,
            w=50.0,
            h=50.0,
            provenance_kind="person",
            review_state="accepted",
        )
        s.add(box)
        s.flush()
        row = FindingSighting(
            asset_model_id=model_id,
            finding_id=None,
            image_id=image_id,
            annotation_id=box.id,
            severity=severity,
            group_tag=tag,
            placement="point" if center is not None else "pending",
            coverage=coverage,
        )
        if center is not None:
            row.cx, row.cy, row.cz = center
            row.nx, row.ny, row.nz = 1.0, 0.0, 0.0
            row.placed_version = 1
        s.add(row)
        s.flush()
        return row.id


def finding_of_sighting(handle, sighting_id: str) -> Finding:
    with handle.session() as s:
        fid = s.get(FindingSighting, sighting_id).finding_id
        row = s.get(Finding, fid)
        s.expunge(row)
    return row


def assert_counts_true(handle) -> None:
    """`finding_count` says what a recount from the finding table says (counts.py stays the only
    writer, and every write here went through it)."""

    def snapshot(s) -> dict:
        return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}

    with handle.session() as s:
        stored = snapshot(s)
        counts.recount(s)
        s.flush()
        fresh = snapshot(s)
        s.rollback()
    assert stored == fresh
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_asset_findings_create.py`:

```python
"""Asset findings: create with sightings, the representative sighting, the sightings list, type
changes, delete, thumbnail (spec 2026-10-02-asset-findings §5.5, §5.6, §6.4, §8; A1, A2, A4)."""

import pytest
from asset_findings_helpers import (
    API,
    RECT,
    assert_counts_true,
    by_photo,
    finding_row,
    make_model,
    make_photos,
    place,
    post_asset,
    refresh_finding,
    sightings_of,
    update_sighting,
)
from findings_helpers import add_type, insert_cloud, use_types

from app.findings import service
from app.findings.anchors import AnchorIn


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def _boxes(client, ctx, photo_id: str) -> list[dict]:
    return client.get(f"{ctx['base']}/images/{photo_id}/boxes").json()["items"]


def test_post_asset_finding_draws_one_box_per_sighting(client, handle, ctx):
    poly = [[50.0, 50.0], [120.0, 50.0], [120.0, 110.0], [50.0, 110.0]]
    anchor = {
        "kind": "asset",
        "asset_model_id": ctx["model"],
        "sightings": [
            {"image_id": ctx["photos"][0], "box": RECT},
            {"image_id": ctx["photos"][1], "box": RECT, "points": poly},
        ],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 201, r.text
    f = r.json()
    assert (f["anchor"]["kind"], f["data_type"], f["data_id"]) == ("asset", "asset_model", ctx["model"])
    assert (f["number"], f["severity"], f["sighting_count"], f["placement"]) == (1, 2, 2, "none")
    assert (f["lon"], f["lat"]) == (55.0, 25.0)  # from the frame origin, so Overview pins keep working
    assert f["representative"]["image_id"] in ctx["photos"][:2]
    assert [b["shape"] for b in _boxes(client, ctx, ctx["photos"][0])] == ["box"]
    assert [b["shape"] for b in _boxes(client, ctx, ctx["photos"][1])] == ["polygon"]
    rows = sightings_of(handle, f["id"])
    assert sorted(r.placement for r in rows) == ["pending", "pending"]
    assert {r.asset_model_id for r in rows} == {ctx["model"]}
    assert {r.severity for r in rows} == {2}
    # The boxes are sightings of this finding, not image findings of their own.
    assert [g["id"] for g in client.get(f"{ctx['base']}/findings").json()["items"]] == [f["id"]]
    assert_counts_true(handle)


def test_an_unknown_asset_model_is_404_and_draws_nothing(client, ctx):
    anchor = {"kind": "asset", "asset_model_id": "nope", "sightings": [{"image_id": ctx["photos"][0], "box": RECT}]}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 404, r.text
    assert _boxes(client, ctx, ctx["photos"][0]) == []


def test_an_object_type_is_refused_before_a_box_is_drawn(client, project, ctx):
    truck = project["classes"][3]["id"]
    anchor = {
        "kind": "asset",
        "asset_model_id": ctx["model"],
        "sightings": [{"image_id": ctx["photos"][0], "box": RECT}],
    }
    r = client.post(f"{ctx['base']}/findings", json={"type_id": truck, "anchor": anchor})
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_a_defect"
    assert _boxes(client, ctx, ctx["photos"][0]) == []


def test_an_asset_anchor_needs_a_sighting(client, ctx):
    anchor = {"kind": "asset", "asset_model_id": ctx["model"], "sightings": []}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 422


def test_the_representative_gives_the_anchor_and_the_derived_fields(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"])
    s = by_photo(handle, f["id"])
    first, second, third = (s[p] for p in ctx["photos"])
    place(handle, first.id, (3.0, 5.0, 0.0), severity=1, coverage=0.5)
    update_sighting(handle, second.id, severity=3)  # the highest grade, but not placed
    place(handle, third.id, (0.0, 12.0, 5.0), normal=(0.0, 0.0, 1.0), severity=3, coverage=0.1)
    refresh_finding(handle, f["id"])
    row = finding_row(handle, f["id"])
    assert (row.ax, row.ay, row.az) == (0.0, 12.0, 5.0)
    assert (row.an_x, row.an_y, row.an_z) == (0.0, 0.0, 1.0)
    assert row.placement == "point"
    assert row.height_m == pytest.approx(12.0)
    assert row.bearing_deg == pytest.approx(90.0)  # atan2(z, x): plant east
    assert row.side == "E"
    assert row.zone is not None
    assert row.severity == 2  # a refresh never touches the operator's severity
    got = client.get(f"{ctx['base']}/findings/{f['id']}").json()
    assert got["representative"] == {"image_id": ctx["photos"][2], "annotation_id": third.annotation_id}
    # Equal severity, both placed: the larger coverage wins.
    place(handle, second.id, (1.0, 20.0, 0.0), severity=3, coverage=0.9)
    refresh_finding(handle, f["id"])
    assert finding_row(handle, f["id"]).ay == 20.0


def test_an_unplaced_finding_has_no_height_zone_or_side(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    row = finding_row(handle, f["id"])
    assert (row.placement, row.ax, row.height_m, row.zone, row.side) == ("none", None, None, None, None)


def test_sightings_route_lists_the_representative_first(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    s = by_photo(handle, f["id"])
    update_sighting(handle, s[ctx["photos"][1]].id, severity=3)
    refresh_finding(handle, f["id"])
    r = client.get(f"{ctx['base']}/findings/{f['id']}/sightings")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["id"] for i in items] == [s[ctx["photos"][1]].id, s[ctx["photos"][0]].id]
    assert [i["representative"] for i in items] == [True, False]
    assert items[0]["placement"] == "pending" and items[0]["center"] is None


def test_an_image_finding_is_one_implicit_sighting(client, handle, ctx):
    r = client.post(
        f"{ctx['base']}/images/{ctx['photos'][0]}/boxes",
        json={"class_id": ctx["crack"], "x": 10, "y": 20, "w": 30, "h": 40},
    )
    assert r.status_code == 201, r.text
    box_id = r.json()["box"]["id"]
    [f] = client.get(f"{ctx['base']}/findings").json()["items"]
    [one] = client.get(f"{ctx['base']}/findings/{f['id']}/sightings").json()["items"]
    assert (one["image_id"], one["annotation_id"], one["representative"]) == (ctx["photos"][0], box_id, True)
    cloud = service.create_finding(
        handle, type_id=ctx["crack"], anchor=AnchorIn(kind="cloud", cloud_id=insert_cloud(handle), x=1.0, y=2.0, z=3.0)
    )
    assert client.get(f"{ctx['base']}/findings/{cloud.id}/sightings").json()["items"] == []


def test_changing_the_type_moves_every_sighting_box(client, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    r = client.patch(f"{ctx['base']}/findings/{f['id']}", json={"type_id": rust["id"]})
    assert r.status_code == 200, r.text
    for p in ctx["photos"][:2]:
        assert [b["class_id"] for b in _boxes(client, ctx, p)] == [rust["id"]]


def test_an_asset_anchor_cannot_be_patched(client, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.patch(f"{ctx['base']}/findings/{f['id']}", json={"anchor": {"x": 1.0}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "anchor_immutable"


def test_deleting_an_asset_finding_deletes_its_boxes(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    assert client.delete(f"{ctx['base']}/findings/{f['id']}").status_code == 204
    for p in ctx["photos"][:2]:
        assert _boxes(client, ctx, p) == []
    assert sightings_of(handle, f["id"]) == []
    assert_counts_true(handle)


def test_an_asset_finding_thumbnail_crops_its_representative(client, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.get(f"{ctx['base']}/findings/{f['id']}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
```

Check the box route's response shape before running: `grep -n "class BoxWriteResult" -A6 backend/app/imagery/schemas*.py`. If the created box is not under `box`, change `r.json()["box"]["id"]` in `test_an_image_finding_is_one_implicit_sighting` to the field it uses.

- [ ] **Step 4: Run them and see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_create.py -q`
Expected: FAIL. The first errors are `ModuleNotFoundError: No module named 'app.findings.sightings'` from the helpers, then 422 on `"kind": "asset"` once the module exists.

- [ ] **Step 5: Write `findings/sightings.py`**

`backend/app/findings/sightings.py`:

```python
"""Sightings of asset findings (spec 2026-10-02-asset-findings §5.5, §5.6, §6.4; decisions A1, A2, A4).

A sighting is one box (box, rbox, polygon or point) on one photo. The box row stays the geometry,
and `image_summary` still counts it.

This module is the one place that adds and removes sightings. It is also the one place that writes
a finding's derived asset columns from its representative sighting. A finding left with no sighting
is closed with a comment, never deleted.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.db.models import AssetModel, Finding, FindingSighting
from app.findings import comments, events, service

PLACED = ("point", "patch")
SYSTEM_AUTHOR = "Kestrel"
BOX_GONE = "Closed by Kestrel: the last photo box behind this finding was deleted."
NOT_A_SIGHTING = "Closed by Kestrel: its last photo box is no longer a defect sighting."
PHOTOS_GONE = "Closed by Kestrel: the photos behind this finding were deleted."


def is_placed(row: FindingSighting) -> bool:
    return row.placement in PLACED and row.cx is not None


def sort_key(row: FindingSighting) -> tuple:
    """Sorts the representative first (spec §6.4): the highest severity, then placed, then the
    largest coverage. Ties go to the older sighting, then the id, so the choice is stable."""
    return (
        -(row.severity if row.severity is not None else 0),
        0 if is_placed(row) else 1,
        -(row.coverage or 0.0),
        row.created_at,
        row.id,
    )


def pick_representative(rows: Sequence[FindingSighting]) -> FindingSighting | None:
    return min(rows, key=sort_key) if rows else None


def of_finding(s: Session, finding_id: str) -> list[FindingSighting]:
    q = (
        select(FindingSighting)
        .where(FindingSighting.finding_id == finding_id)
        .order_by(FindingSighting.created_at, FindingSighting.id)
    )
    return list(s.execute(q).scalars())


def of_box(s: Session, box_id: str) -> FindingSighting | None:
    return s.execute(select(FindingSighting).where(FindingSighting.annotation_id == box_id)).scalar_one_or_none()


def box_ids(s: Session, finding_id: str) -> list[str]:
    return list(
        s.execute(select(FindingSighting.annotation_id).where(FindingSighting.finding_id == finding_id)).scalars()
    )


def representatives(s: Session, finding_ids: Iterable[str]) -> dict[str, dict]:
    """`{finding_id: {image_id, annotation_id}}` for the asset findings among `finding_ids` (one
    register page, at most 500). One read of their sightings."""
    ids = list(dict.fromkeys(finding_ids))
    if not ids:
        return {}
    by: dict[str, list[FindingSighting]] = {}
    for row in s.execute(select(FindingSighting).where(FindingSighting.finding_id.in_(ids))).scalars():
        by.setdefault(row.finding_id, []).append(row)
    out = {}
    for fid, rows in by.items():
        rep = pick_representative(rows)
        out[fid] = {"image_id": rep.image_id, "annotation_id": rep.annotation_id}
    return out


def add_sighting(
    s: Session,
    handle,
    *,
    asset_model_id: str,
    finding_id: str | None,
    image_id: str,
    type_id: str,
    box: dict | None = None,
    points: list[list[float]] | None = None,
    severity: int | None = None,
    group_tag: str | None = None,
) -> FindingSighting:
    """Draw the sighting's box through the annotation service (its shape rules, cap and area), with
    no finding hook, then add the sighting row as `pending` (not placed yet). With `points` it is a
    polygon; otherwise `box` is the rectangle `{x, y, w, h, angle}` in image pixels. J5's import
    passes `finding_id=None`: grouping assigns it."""
    from app.imagery import annotations as boxes  # imagery imports this package's hooks
    from app.imagery import summary

    if points is not None:
        row, _ = boxes.create_shape_in_session(s, handle, image_id, type_id, shape="polygon", points=points)
    else:
        row, _ = boxes.create_shape_in_session(s, handle, image_id, type_id, shape="box", **(box or {}))
    summary.touch(s, image_id)
    sighting = FindingSighting(
        asset_model_id=asset_model_id,
        finding_id=finding_id,
        image_id=image_id,
        annotation_id=row.id,
        severity=severity,
        group_tag=group_tag,
        placement="pending",
    )
    s.add(sighting)
    s.flush()
    return sighting


def _derived(model: AssetModel | None, center, normal) -> dict:
    out = {"height_m": None, "bearing_deg": None, "side": None, "zone": None}
    if center is None:
        return out  # unplaced: no height, zone or side, never the camera target (plan R7)
    if model is None or model.review is None or model.frame is None:
        out["height_m"] = float(center[1])
        return out
    from app.asset_review.derive import derive
    from app.asset_review.frame import Frame
    from app.asset_review.profiles import ReviewConfig

    d = derive(center, normal, ReviewConfig.model_validate(model.review), Frame.model_validate(model.frame))
    return {"height_m": d.height_m, "bearing_deg": d.bearing_deg, "side": d.side, "zone": d.zone}


def refresh(s: Session, finding: Finding) -> FindingSighting | None:
    """Recompute `sighting_count` and the anchor point, normal, placement, component and derived
    fields from the representative sighting. Severity, status and note are the operator's and are
    never touched here. Returns the representative."""
    rows = of_finding(s, finding.id)
    rep = pick_representative(rows)
    placed = rep is not None and is_placed(rep)
    center = (rep.cx, rep.cy, rep.cz) if placed else None
    normal = (rep.nx, rep.ny, rep.nz) if placed and rep.nx is not None else None
    model = s.get(AssetModel, finding.asset_model_id) if finding.asset_model_id else None
    finding.sighting_count = len(rows)
    finding.ax, finding.ay, finding.az = center if center else (None, None, None)
    finding.an_x, finding.an_y, finding.an_z = normal if normal else (None, None, None)
    finding.placement = rep.placement if placed else "none"
    finding.component = rep.part if rep is not None else None
    if placed and rep.placed_version is not None:
        finding.asset_version = rep.placed_version
    for key, value in _derived(model, center, normal).items():
        setattr(finding, key, value)
    finding.updated_at = utcnow()
    return rep


def close_with_comment(
    s: Session, *, project_id: str, catalogue, finding: Finding, text: str, author: str = SYSTEM_AUTHOR
) -> None:
    """Close `finding` through the service (counts and the `finding.status` activity) and say why in
    its thread. Its note, comments and photos stay; nothing is deleted."""
    if finding.status != "closed":
        service.patch_in_session(
            s, project_id=project_id, catalogue=catalogue, finding_id=finding.id, fields={"status": "closed"}
        )
    comments.add(s, project_id=project_id, finding_id=finding.id, text=text, author=author)


def remove(s: Session, *, project_id: str, catalogue, rows: Sequence[FindingSighting], reason: str) -> list[str]:
    """Delete these sighting rows and refresh each finding they belonged to. The caller deletes
    their boxes after this. A finding left with none is closed, with `reason` as a comment.
    Returns the ids of the findings that changed."""
    touched = sorted({r.finding_id for r in rows if r.finding_id})
    for r in rows:
        s.delete(r)
    s.flush()
    for fid in touched:
        f = s.get(Finding, fid)
        if f is None:
            continue
        refresh(s, f)
        if f.sighting_count == 0:
            close_with_comment(s, project_id=project_id, catalogue=catalogue, finding=f, text=reason)
    events.mark_changed(s, project_id, touched)
    return touched
```

- [ ] **Step 6: Teach the anchors the `asset` kind**

In `backend/app/findings/anchors.py`:

1. Change the docstring's first sentence to "exactly one of an image annotation, a map geometry in the map's CRS, a cloud point in the cloud's CRS, or an asset model with its sightings (spec 2026-10-02-asset-findings §5.5)".
2. Import `AssetModel` in the models import: `from app.db.models import AssetModel, Box, Finding, GeoMap, Image, PointCloud`.
3. Replace `KINDS` and `_EMPTY`:

```python
KINDS = ("image", "map", "cloud", "asset")
_EMPTY = dict.fromkeys(
    (
        "image_id",
        "annotation_id",
        "map_id",
        "geometry",
        "cloud_id",
        "x",
        "y",
        "z",
        "uncertainty_m",
        "asset_model_id",
        "asset_version",
    )
)
```

4. Add two fields at the end of `AnchorIn`:

```python
    asset_model_id: str | None = None
    sightings: list[dict] | None = None  # [{image_id, box, points}]: POST /findings draws them
```

5. Add `_asset` after `_cloud`:

```python
def _asset(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    model = s.get(AssetModel, a.asset_model_id) if a.asset_model_id else None
    if model is None:
        raise not_found("asset model", str(a.asset_model_id))
    if not _finite(lon, lat):
        origin = (model.frame or {}).get("origin") or {}
        lon, lat = origin.get("lon"), origin.get("lat")
        lon, lat = (float(lon), float(lat)) if _finite(lon, lat) else (None, None)
    return {
        **_EMPTY,
        "anchor_kind": "asset",
        "asset_model_id": model.id,
        "asset_version": model.current_version,
        "lon": lon,
        "lat": lat,
        "data_type": "asset_model",
        "data_id": model.id,
    }
```

6. In `resolve`, before the final `raise`, add:

```python
    if anchor.kind == "asset":
        return _asset(s, anchor, lon, lat)
```

7. In `repatch`, after the image branch, add:

```python
    if row.anchor_kind == "asset":
        raise AppError("anchor_immutable", "An asset finding moves with its sightings; edit their boxes.", 422)
```

- [ ] **Step 7: Teach the service to create, retype and delete asset findings**

In `backend/app/findings/service.py`:

1. Add `_create_asset` after `_image_annotation`:

```python
def _create_asset(s: Session, handle, kw: dict) -> Finding:
    """`POST /findings` on an asset model: the finding first, then one box and one `pending`
    sighting per entry, drawn through the annotation service. Nothing is placed here; the
    `asset_place` job places pending sightings."""
    from app.findings import sightings  # sightings imports this module

    anchor: AnchorIn = kw["anchor"]
    if not anchor.sightings:
        raise AppError("validation_error", "an asset anchor needs at least one sighting", 422)
    defect_type(s, handle.catalogue, kw["type_id"])  # refuse an object type before a box is drawn
    row = create_in_session(s, project_id=handle.id, catalogue=handle.catalogue, **kw)
    for entry in anchor.sightings:
        sightings.add_sighting(
            s,
            handle,
            asset_model_id=row.asset_model_id,
            finding_id=row.id,
            image_id=entry["image_id"],
            type_id=row.type_id,
            box=entry.get("box"),
            points=entry.get("points"),
            severity=row.severity,
        )
    sightings.refresh(s, row)
    return row
```

2. Replace the body of `create_finding`:

```python
def create_finding(handle, **kw) -> Finding:
    """`create_in_session` in its own transaction (the HTTP route). An image anchor may draw or adopt
    its box first (spec section 8.3). An asset anchor draws one box per sighting (asset findings
    spec §8)."""
    with handle.session() as s:
        if kw["anchor"].kind == "image":
            kw["anchor"] = _image_annotation(s, handle, kw["anchor"], kw["type_id"])
        if kw["anchor"].kind == "asset":
            row = _create_asset(s, handle, kw)
        else:
            row = create_in_session(s, project_id=handle.id, catalogue=handle.catalogue, **kw)
        s.flush()
        s.expunge(row)
    return row
```

3. In `patch_in_session`, replace the `if pt is not None:` block:

```python
    if pt is not None:
        row.type_id = pt.type_id
        if row.anchor_kind == "image" and row.annotation_id:
            from app.imagery import annotations as boxes

            boxes.reclass_in_session(s, row.annotation_id, pt.type_id)
        elif row.anchor_kind == "asset":
            from app.findings import sightings
            from app.imagery import annotations as boxes

            for box_id in sightings.box_ids(s, row.id):  # every sighting box carries the finding's type
                boxes.reclass_in_session(s, box_id, pt.type_id)
```

4. Replace `delete_in_session`:

```python
def delete_in_session(s: Session, *, project_id: str, finding_id: str, delete_annotation: bool = True) -> str:
    """Delete one finding. Its attachment and comment rows go by ON DELETE CASCADE. The caller moves
    its files to the trash after commit (`trash.move`).

    With `delete_annotation`, an image finding's box goes too: an annotation on a defect type IS the
    finding's geometry (section 8.5). The same holds for an asset finding's sighting boxes. The box
    hooks pass False, since they are deleting or changing that box themselves."""
    row = get_or_404(s, finding_id)
    if row.anchor_kind == "map":
        from app.detect import map_findings  # detect's review imports this module

        map_findings.on_finding_deleting(s, finding_id)  # its detection becomes rejected (M §9.3)
    box_ids = [row.annotation_id] if row.annotation_id else []
    if row.anchor_kind == "asset":
        from app.findings import sightings

        for sighting in sightings.of_finding(s, finding_id):
            box_ids.append(sighting.annotation_id)
            s.delete(sighting)
    counts.change(s, counts.key_of(row), None)
    s.delete(row)
    s.flush()  # the finding and its sightings go before the boxes they reference
    if delete_annotation:
        from app.imagery import annotations as boxes  # boxes imports this package's hooks

        for box_id in box_ids:
            box = s.get(Box, box_id)
            if box is not None:
                boxes.delete_box_in_session(s, box)
    events.mark_changed(s, project_id, [finding_id])
    return finding_id
```

- [ ] **Step 8: Schemas**

In `backend/app/findings/schemas.py`:

1. Make sure `AnchorKind = Literal["image", "map", "cloud", "asset"]`. D1 may have done it already; leave it if so.
2. After `CloudAnchorIn`, add:

```python
class SightingIn(BaseModel):
    """One sighting of a new asset finding: a rectangle in image pixels, or a polygon when `points`
    is given (its envelope then comes from the points)."""

    image_id: str
    box: BoxGeometry
    points: list[list[float]] | None = Field(None, min_length=3)


class AssetAnchorIn(BaseModel):
    kind: Literal["asset"]
    asset_model_id: str
    sightings: list[SightingIn] = Field(min_length=1, max_length=200)
```

3. Replace `FindingAnchorIn`:

```python
FindingAnchorIn = Annotated[
    ImageAnchorIn | MapAnchorIn | CloudAnchorIn | AssetAnchorIn, Field(discriminator="kind")
]
```

4. In `FindingOut`:
   - If it has no `representative` field (D1 normally adds it), add `representative: dict[str, str] | None = None` after `sighting_count`.
   - Change the signature to `def from_row(cls, r: Finding, representative: dict | None = None) -> "FindingOut":`.
   - Pass `representative=representative` in the constructor call, replacing any `representative=None` D1 wrote.

5. After `FindingPage`, add the sighting shapes:

```python
class FindingSightingOut(BaseModel):
    id: str
    finding_id: str | None
    image_id: str
    annotation_id: str | None
    severity: int | None
    group_tag: str | None
    placement: Literal["point", "patch", "none", "pending"]
    center: list[float] | None
    normal: list[float] | None
    part: str | None
    coverage: float | None
    placed_version: int | None
    representative: bool
    created_at: datetime

    @classmethod
    def from_row(cls, r, *, representative: bool) -> "FindingSightingOut":
        return cls(
            id=r.id,
            finding_id=r.finding_id,
            image_id=r.image_id,
            annotation_id=r.annotation_id,
            severity=r.severity,
            group_tag=r.group_tag,
            placement=r.placement,
            center=[r.cx, r.cy, r.cz] if r.cx is not None else None,
            normal=[r.nx, r.ny, r.nz] if r.nx is not None else None,
            part=r.part,
            coverage=r.coverage,
            placed_version=r.placed_version,
            representative=representative,
            created_at=r.created_at,
        )

    @classmethod
    def implicit(cls, f: Finding) -> "FindingSightingOut":
        """An image finding presented as its one implicit sighting (decision A2)."""
        return cls(
            id=f.id,
            finding_id=f.id,
            image_id=f.image_id,
            annotation_id=f.annotation_id,
            severity=f.severity,
            group_tag=None,
            placement="none",
            center=None,
            normal=None,
            part=None,
            coverage=None,
            placed_version=None,
            representative=True,
            created_at=f.created_at,
        )


class FindingSightingList(BaseModel):
    items: list[FindingSightingOut]
```

6. Compare these fields with C0's schemas: `grep -n "    FindingSighting:" -A30 contract/openapi.yaml`. The contract wins. If a property name or nullability differs, change the model to match the contract, not the other way round, and note it in the ledger.

- [ ] **Step 9: Router**

In `backend/app/findings/router.py`:

1. Import `sightings` with the other findings modules: `from app.findings import activity, attachments, comments, jobs, query, service, sightings, thumbnails`. Add `FindingSightingList` and `FindingSightingOut` to the schemas import.
2. Replace `_detail`:

```python
def _detail(handle: ProjectHandle, finding_id: str) -> FindingDetail:
    row, n_att, n_com = service.get_finding(handle, finding_id)
    rep = None
    if row.anchor_kind == "asset":
        with handle.session() as s:
            rep = sightings.representatives(s, [finding_id]).get(finding_id)
    out = FindingOut.from_row(row, representative=rep)
    return FindingDetail(**out.model_dump(), attachment_count=n_att, comment_count=n_com)
```

3. In `list_findings`, replace the `with` block:

```python
    with handle.session() as s:
        rows, nxt = query.list_findings(s, filters, sort=sort, cursor=cursor, limit=limit)
        reps = sightings.representatives(s, [r.id for r in rows if r.anchor_kind == "asset"])
        items = [FindingOut.from_row(r, representative=reps.get(r.id)) for r in rows]
```

4. In `create_finding`, replace the last two lines:

```python
    row = service.create_finding(handle, **kw)
    return _detail(handle, row.id)
```

5. Add the sightings route right after `get_finding_thumbnail`:

```python
@router.get("/findings/{findingId}/sightings", response_model=FindingSightingList)
def list_finding_sightings(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FindingSightingList:  # noqa: N803
    """An asset finding's sightings, representative first. An image finding is its one implicit
    sighting; a map or cloud finding has none (decision A2)."""
    with handle.session() as s:
        f = service.get_or_404(s, findingId)
        if f.anchor_kind == "image":
            return FindingSightingList(items=[FindingSightingOut.implicit(f)])
        rows = sorted(sightings.of_finding(s, f.id), key=sightings.sort_key)
        items = [FindingSightingOut.from_row(r, representative=i == 0) for i, r in enumerate(rows)]
    return FindingSightingList(items=items)
```

- [ ] **Step 10: The thumbnail crops the representative sighting**

In `backend/app/findings/thumbnails.py`, change the docstring's first sentence to "for an image anchor a 160x120 crop around its annotation, and for an asset anchor around its representative sighting's box (asset findings spec §9)". In `finding_thumbnail`, replace the two lines that read `box` and `image`:

```python
        box_id, image_id = f.annotation_id, f.image_id
        if f.anchor_kind == "asset":
            from app.findings import sightings

            rep = sightings.representatives(s, [f.id]).get(f.id)
            if rep is not None:
                box_id, image_id = rep["annotation_id"], rep["image_id"]
        box = s.get(Box, box_id) if box_id else None
        image = s.get(Image, image_id) if image_id else None
```

- [ ] **Step 11: Remove the `listFindingSightings` stub**

Open `backend/app/asset_review/stubs.py` and delete the tuple whose operationId is `listFindingSightings`. If C0 grouped J4's tuples in a `J4_STUBS` list, delete only that tuple now; Task 3 deletes the rest. If `backend/tests/test_contract.py` names the stub by hand instead of deriving `EXPECTED_STUBS` from `stubs.py`, delete it there too.

- [ ] **Step 12: Run the tests and see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_create.py tests/test_findings_service.py tests/test_findings_api.py tests/test_findings_invariant.py tests/test_findings_files.py -q`
Expected: PASS. The existing findings tests must stay green: image, map and cloud behaviour is unchanged.

Then: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q`
Expected: PASS. If schemathesis reports a refusal status that C0 did not declare for `listFindingSightings` (for example 404), add it to the contract in its own commit, regenerate with `pnpm -C contract generate`, and note it in the ledger (index "File ownership").

- [ ] **Step 13: Commit**

```bash
git add backend/app/findings/sightings.py backend/app/findings/anchors.py backend/app/findings/service.py backend/app/findings/schemas.py backend/app/findings/router.py backend/app/findings/thumbnails.py backend/app/asset_review/stubs.py backend/tests/asset_findings_helpers.py backend/tests/test_asset_findings_create.py
# plus backend/tests/test_contract.py only if Step 11 changed it
git commit -m "feat(findings): asset anchor with sightings, representative, sightings route (J4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Regroup, merge and split (Review Focus 1)

**Files:**
- Modify: `backend/app/asset_review/group.py` (append `GroupResult`, `load_items`, `cluster_m_for`, `apply_groups`, `merge`, `split`, `split_in_session`)
- Create: `backend/app/asset_review/jobs_group.py`
- Create: `backend/app/asset_review/group_router.py`
- Modify: `backend/app/api.py` (register `app.asset_review.group_router`)
- Modify: `backend/app/findings/activity.py` (`KINDS`)
- Modify: `backend/app/findings/schemas.py` (`FindingMergeIn`, `FindingSplitIn`)
- Modify: `backend/app/findings/router.py` (merge and split routes)
- Modify: `backend/app/asset_review/stubs.py` (remove `mergeFinding`, `splitFinding`, `regroupAssetFindings`)
- Modify: `contract/openapi.yaml` (the `Activity.kind` description only); regenerate `contract/client/schema.d.ts`
- Test: `backend/tests/test_asset_group_apply.py`, `backend/tests/test_asset_findings_merge_split.py`

**Interfaces:**
- Consumes:
  - Task 1: `GroupItem`, `group_sightings`.
  - Task 2: `sightings.refresh`, `sightings.of_finding`, `sightings.close_with_comment`, `sightings.PLACED`, `sightings.SYSTEM_AUTHOR`.
  - Existing: `service.create_in_session`, `numbers.allocate`, `numbers.format_number`, `activity.record`, `events.mark_changed`.
- Produces:
  - `GroupResult(created: int, kept: int, merged: int, split: int)` (dataclass)
  - `load_items(s, asset_model_id: str) -> list[GroupItem]` (with `image_id`)
  - `cluster_m_for(model: AssetModel) -> float`
  - `groups_for_model(model: AssetModel, items: Sequence[GroupItem]) -> list[list[str]]`: `group_by_photo(items)` when `(model.review or {}).get("finding_unit") == "photo"`, else `group_sightings(items, cluster_m_for(model))`. The job and every Regroup go through this, so the photo unit never clusters by distance or tag.
  - `apply_groups(s, handle, asset_model_id: str, groups: Sequence[Sequence[str]]) -> GroupResult`
  - `merge(s, handle, finding_id: str, into_id: str, *, author: str = "Kestrel") -> Finding` (returns the survivor)
  - `split(s, handle, finding_id: str, sighting_ids: Sequence[str]) -> Finding` (returns the new finding)
  - `split_in_session(s, *, project_id, catalogue, finding_id, sighting_ids, type_id=None) -> Finding`
  - `app.asset_review.jobs_group.GROUP_JOB = "asset_group"`; `submit_group(handle, runner, asset_model_id: str) -> Job` (409 `job_running` while one runs for that model). J3 and J5 call it.
  - HTTP:
    - `POST /asset-models/{assetModelId}/findings/regroup` → 202 `JobRef`;
    - `POST /findings/{findingId}/merge` `{into}` → 200 `Finding`;
    - `POST /findings/{findingId}/split` `{sighting_ids}` → 201 `Finding`.
  - Activity kinds `finding.merged`, `finding.split`, `findings.grouped`.

**The Regroup rules** (spec §6.4), as `apply_groups` implements them:
1. Each existing finding has a **home group**: the group that holds most of its sightings. Ties go to the group that comes first, which is the higher one.
2. A group's **candidates** are the findings whose home it is.
   - No candidate: a new finding. If any of its sightings came from an existing finding, that counts as a split; otherwise it counts as created.
   - One or more candidates: the lowest number survives (kept). If that survivor already holds exactly the group's sightings and there is no other candidate, nothing is written, not even `updated_at`.
3. Every other candidate is **merged away**: closed with the comment "Merged into F-xxxx by Regroup." and a `finding.merged` activity. Nothing is deleted.
4. A survivor keeps its id, number, status, severity, note, comments and attachments. Only its sightings and derived fields change.
5. New findings take a consecutive block of numbers in group order (placed first, highest first), so they read top-down. Their severity is the maximum over their sightings; it is set only on creation.
6. **Photo unit** (coordinator ruling, J5 N3/N7): when the model's `review.finding_unit` is `"photo"`, the groups come from `group_by_photo`, so there is one finding per photo, and rules 1 to 5 apply to those groups unchanged. Two photos 0.1 m apart stay two findings, and an unplaced sighting stays with its photo.

- [ ] **Step 1: Write the failing Review Focus tests and the other grouping tests**

`backend/tests/test_asset_group_apply.py`:

```python
"""Regroup (spec 2026-10-02-asset-findings §6.4; decision A3; index Review Focus 1): numbers,
statuses, notes, comments and photos survive; a merged-away finding is closed with a comment naming
the survivor; a split creates a new finding; nothing is deleted."""

from asset_findings_helpers import (
    assert_counts_true,
    finding_of_sighting,
    finding_row,
    make_model,
    place,
    seed_images,
    seed_sighting,
)
from sqlalchemy import select

from app.asset_review import group
from app.db.models import Activity, AssetModel, FindingAttachment, FindingComment
from app.findings import attachments, comments, service


def _regroup(handle, model_id: str) -> group.GroupResult:
    """What the `asset_group` job does, synchronously."""
    with handle.session() as s:
        groups = group.groups_for_model(s.get(AssetModel, model_id), group.load_items(s, model_id))
    with handle.session() as s:
        return group.apply_groups(s, handle, model_id, groups)


def test_photo_unit_two_photos_close_together_stay_two_findings(handle, crack):
    mid = make_model(handle, profile_id="stack")
    img = seed_images(handle, 2)
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=crack["id"], center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=crack["id"], center=(0.1, 10.0, 0.0), tag="D1")
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    assert finding_of_sighting(handle, a).id != finding_of_sighting(handle, b).id


def test_photo_unit_one_photo_with_five_sightings_is_one_finding_and_regroup_keeps_it(handle, crack):
    mid = make_model(handle, profile_id="stack")
    [photo] = seed_images(handle, 1)
    centres = [(0.0, 10.0, 0.0), (6.0, 2.0, 0.0), None, (0.0, 28.0, 3.0), None]
    ids = [
        seed_sighting(handle, model_id=mid, image_id=photo, type_id=crack["id"], center=c, severity=1 + (i % 2))
        for i, c in enumerate(centres)
    ]
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    f = finding_of_sighting(handle, ids[0])
    assert {finding_of_sighting(handle, sid).id for sid in ids} == {f.id}
    assert (f.number, f.sighting_count, f.severity) == (1, 5, 2)
    service.patch_finding(handle, f.id, {"status": "reviewed", "note": "soot band"})
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 0)
    kept = finding_row(handle, f.id)
    assert (kept.number, kept.status, kept.note, kept.sighting_count) == (1, "reviewed", "soot band", 5)
    assert_counts_true(handle)


def _tally(r: group.GroupResult) -> tuple[int, int, int, int]:
    return (r.created, r.kept, r.merged, r.split)


def _comment_texts(handle, finding_id: str) -> list[str]:
    with handle.session() as s:
        q = select(FindingComment.text).where(FindingComment.finding_id == finding_id)
        return list(s.execute(q.order_by(FindingComment.created_at, FindingComment.id)).scalars())


def _kinds(handle, subject_id: str) -> set[str]:
    with handle.session() as s:
        return set(s.execute(select(Activity.kind).where(Activity.subject_id == subject_id)).scalars())


def test_first_run_numbers_top_down_with_unplaced_last(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 5)
    t = crack["id"]
    low = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 3.0, 0.0))
    loose = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, severity=2)
    high = seed_sighting(handle, model_id=mid, image_id=img[2], type_id=t, center=(0.0, 25.0, 0.0))
    pair_a = seed_sighting(handle, model_id=mid, image_id=img[3], type_id=t, center=(0.0, 12.0, 0.0))
    pair_b = seed_sighting(handle, model_id=mid, image_id=img[4], type_id=t, center=(0.2, 12.0, 0.0), severity=3)
    assert _tally(_regroup(handle, mid)) == (4, 0, 0, 0)
    numbers = {k: finding_of_sighting(handle, v).number for k, v in
               {"high": high, "pair": pair_a, "low": low, "loose": loose}.items()}
    assert numbers == {"high": 1, "pair": 2, "low": 3, "loose": 4}
    pair = finding_of_sighting(handle, pair_b)
    assert (pair.number, pair.severity, pair.sighting_count) == (2, 3, 2)  # the maximum, on creation
    unplaced = finding_of_sighting(handle, loose)
    assert (unplaced.placement, unplaced.height_m, unplaced.severity) == ("none", None, 2)
    with handle.session() as s:
        assert "findings.grouped" in set(s.execute(select(Activity.kind)).scalars())
    assert_counts_true(handle)


def test_regroup_preserves_operator_edits(handle, crack, tmp_path, make_jpeg):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 4)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0), severity=1)
    seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(0.3, 10.0, 0.0), severity=2)
    c = seed_sighting(handle, model_id=mid, image_id=img[2], type_id=t, center=(0.0, 20.0, 0.0), severity=1)
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    top, pair = finding_of_sighting(handle, c), finding_of_sighting(handle, a)
    assert (top.number, pair.number, pair.severity) == (1, 2, 2)

    # The operator reviews the pair: status, severity, note, a comment and a site photo.
    service.patch_finding(handle, pair.id, {"status": "reviewed", "severity": 3, "note": "bolt sheared"})
    with handle.session() as s:
        comments.add(s, project_id=handle.id, finding_id=pair.id, text="check on next visit", author="Dan")
    attachments.add(handle, pair.id, str(make_jpeg(tmp_path / "site.jpg", 64, 48)))
    top_updated = finding_row(handle, top.id).updated_at

    # A new sighting of the same defect arrives (a later import), then Regroup.
    d = seed_sighting(handle, model_id=mid, image_id=img[3], type_id=t, center=(0.5, 10.0, 0.0), severity=1)
    assert _tally(_regroup(handle, mid)) == (0, 2, 0, 0)
    kept = finding_row(handle, pair.id)
    assert (kept.number, kept.status, kept.severity, kept.note) == (2, "reviewed", 3, "bolt sheared")
    assert kept.sighting_count == 3 and finding_of_sighting(handle, d).id == pair.id
    assert _comment_texts(handle, pair.id) == ["check on next visit"]
    with handle.session() as s:
        n_photos = len(list(s.execute(select(FindingAttachment.id).where(FindingAttachment.finding_id == pair.id))))
    assert n_photos == 1
    # The finding whose sightings did not change is not written at all.
    assert finding_row(handle, top.id).updated_at == top_updated
    # Running Regroup again changes nothing.
    assert _tally(_regroup(handle, mid)) == (0, 2, 0, 0)
    assert finding_row(handle, pair.id).severity == 3
    assert_counts_true(handle)


def test_regroup_merge_closes_with_comment(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(5.0, 9.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    first, second = finding_of_sighting(handle, a), finding_of_sighting(handle, b)
    assert (first.number, second.number) == (1, 2)
    service.patch_finding(handle, second.id, {"note": "loose panel"})
    with handle.session() as s:
        comments.add(s, project_id=handle.id, finding_id=second.id, text="seen from the north too", author="Dan")

    place(handle, b, (0.4, 10.0, 0.0))  # a recomputed placement puts b beside a: one defect after all
    assert _tally(_regroup(handle, mid)) == (0, 1, 1, 0)
    survivor = finding_of_sighting(handle, b)
    assert (survivor.id, survivor.number, survivor.sighting_count) == (first.id, 1, 2)
    gone = finding_row(handle, second.id)
    assert gone is not None  # closed, never deleted
    assert (gone.status, gone.sighting_count, gone.note) == ("closed", 0, "loose panel")
    assert gone.closed_at is not None
    assert _comment_texts(handle, second.id) == ["seen from the north too", "Merged into F-0001 by Regroup."]
    assert {"finding.merged", "finding.status"} <= _kinds(handle, second.id)
    assert_counts_true(handle)


def test_regroup_split_creates_a_new_finding_and_keeps_the_old_one(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(0.3, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    old = finding_of_sighting(handle, a)
    place(handle, b, (0.0, 2.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 1)
    assert finding_of_sighting(handle, a).id == old.id
    new = finding_of_sighting(handle, b)
    assert new.id != old.id and new.number == 2
    assert finding_row(handle, old.id).sighting_count == 1
    assert "finding.split" in _kinds(handle, old.id)
    assert_counts_true(handle)


def test_a_sighting_deleted_since_grouping_is_skipped(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 1)
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=crack["id"], center=(0.0, 1.0, 0.0))
    with handle.session() as s:
        result = group.apply_groups(s, handle, mid, [["missing-id"], [a]])
    assert _tally(result) == (1, 0, 0, 0)
```

`backend/tests/test_asset_findings_merge_split.py`:

```python
"""Merge, split and the Regroup route (spec 2026-10-02-asset-findings §8; index amendment: merge and
split are synchronous routes, Regroup is the job)."""

import pytest
from asset_findings_helpers import (
    API,
    assert_counts_true,
    by_photo,
    finding_row,
    make_model,
    make_photos,
    place,
    post_asset,
)
from findings_helpers import add_type, use_types


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def test_merge_moves_the_sightings_and_closes_the_source(client, handle, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    b = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][1:3])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": b["id"]})
    assert r.status_code == 200, r.text
    assert (r.json()["id"], r.json()["sighting_count"]) == (b["id"], 3)
    src = client.get(f"{ctx['base']}/findings/{a['id']}").json()
    assert (src["status"], src["sighting_count"]) == ("closed", 0)
    texts = [c["text"] for c in client.get(f"{ctx['base']}/findings/{a['id']}/comments").json()["items"]]
    assert texts == ["Merged into F-0002."]
    kinds = {x["kind"] for x in client.get(f"{ctx['base']}/activity", params={"subject_id": a["id"]}).json()["items"]}
    assert "finding.merged" in kinds
    assert_counts_true(handle)


def test_merge_refuses_itself_another_model_or_another_type(client, handle, project, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": a["id"]})
    assert r.status_code == 422
    other = post_asset(client, ctx["pid"], ctx["crack"], make_model(handle, name="Stack"), ctx["photos"][1:2])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": other["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "merge_mismatch"
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    rusty = post_asset(client, ctx["pid"], rust["id"], ctx["model"], ctx["photos"][2:3])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": rusty["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "merge_mismatch"
    assert client.get(f"{ctx['base']}/findings/{a['id']}").json()["status"] == "open"


def test_split_makes_a_new_finding_from_the_chosen_sightings(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"])
    s = by_photo(handle, f["id"])
    chosen = [s[ctx["photos"][1]].id, s[ctx["photos"][2]].id]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": chosen})
    assert r.status_code == 201, r.text
    new = r.json()
    assert (new["number"], new["sighting_count"], new["type_id"]) == (2, 2, ctx["crack"])
    assert finding_row(handle, f["id"]).sighting_count == 1
    kinds = {x["kind"] for x in client.get(f"{ctx['base']}/activity", params={"subject_id": f["id"]}).json()["items"]}
    assert "finding.split" in kinds
    assert_counts_true(handle)


def test_split_refuses_all_or_foreign_sightings(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    other = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][2:3])
    every = [r.id for r in by_photo(handle, f["id"]).values()]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": every})
    assert r.status_code == 422 and r.json()["error"]["code"] == "split_all"
    foreign = [r.id for r in by_photo(handle, other["id"]).values()]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": foreign})
    assert r.status_code == 422
    assert finding_row(handle, f["id"]).sighting_count == 2


def test_regroup_route_runs_the_job(client, handle, wait_job, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    b = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][1:2])
    place(handle, by_photo(handle, a["id"])[ctx["photos"][0]].id, (0.0, 10.0, 0.0))
    place(handle, by_photo(handle, b["id"])[ctx["photos"][1]].id, (0.2, 10.0, 0.0))
    r = client.post(f"{ctx['base']}/asset-models/{ctx['model']}/findings/regroup")
    assert r.status_code == 202, r.text
    job = wait_job(ctx["pid"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert {k: job["result"][k] for k in ("created", "kept", "merged", "split")} == {
        "created": 0, "kept": 1, "merged": 1, "split": 0
    }
    assert client.get(f"{ctx['base']}/findings/{b['id']}").json()["status"] == "closed"
    assert_counts_true(handle)


def test_regroup_route_404s_on_an_unknown_model(client, ctx):
    r = client.post(f"{ctx['base']}/asset-models/nope/findings/regroup")
    assert r.status_code == 404
```

- [ ] **Step 2: Run them and see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_group_apply.py tests/test_asset_findings_merge_split.py -q`
Expected: FAIL. `AttributeError: module 'app.asset_review.group' has no attribute 'load_items'`, and 501 from the stubbed routes.

- [ ] **Step 3: Activity kinds**

In `backend/app/findings/activity.py`, replace `KINDS`:

```python
KINDS = (
    "finding.created",
    "finding.status",
    "finding.severity",
    "finding.comment",
    "finding.merged",
    "finding.split",
    "findings.grouped",
    "data.imported",
    "job.finished",
    "detections.accepted",
)
```

In `contract/openapi.yaml`, find the `Activity` schema's `kind` line (`grep -n "detections.accepted\`\"" contract/openapi.yaml`). Replace its description with:

```yaml
        kind: { type: string, description: "`finding.created`, `finding.status`, `finding.severity`, `finding.comment`, `finding.merged`, `finding.split`, `findings.grouped`, `data.imported`, `job.finished` or `detections.accepted`" }
```

Then run `pnpm -C contract generate`. `findings.grouped` has no finding subject: its `subject_id` is the asset model id, and the Overview feed links only `finding.*` kinds.

- [ ] **Step 4: Append grouping writes, merge and split to `group.py`**

Replace the import block of `backend/app/asset_review/group.py` with:

```python
from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from operator import attrgetter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AssetModel, Box, Finding, FindingSighting
from app.errors import AppError, not_found
from app.findings import activity, events, service, sightings
from app.findings.anchors import AnchorIn
from app.findings.numbers import allocate, format_number
```

Extend the module docstring with:

```
`apply_groups` writes groups as findings under the Regroup rules, in the caller's transaction.
`merge` and `split` are the operator's explicit actions. They are synchronous routes because they
touch a few dozen rows. Grouping never runs on an edit (decision A3): only the `asset_group` job
(import, Regroup, after `asset_place`) calls `apply_groups`.
```

Append:

```python
MIN_CLUSTER_M = 0.75
CLUSTER_SHARE_OF_HEIGHT = 0.02


@dataclass
class GroupResult:
    created: int = 0  # new findings from sightings no finding held
    kept: int = 0  # groups whose finding survived (unchanged or not)
    merged: int = 0  # findings closed because their group's survivor has a lower number
    split: int = 0  # new findings made from sightings another finding held


def cluster_m_for(model: AssetModel) -> float:
    """The review's `cluster_m`, else max(0.75, 0.02 H) (spec §6.4)."""
    review = model.review or {}
    if review.get("cluster_m"):
        return float(review["cluster_m"])
    height = float((model.frame or {}).get("height_m") or 0.0)
    return max(MIN_CLUSTER_M, CLUSTER_SHARE_OF_HEIGHT * height)


def load_items(s: Session, asset_model_id: str) -> list[GroupItem]:
    """One model's sightings as grouping sees them. Scalar columns only, one row per sighting
    (bounded: 1,441 rows for DAMAC). The type is the box's class."""
    q = (
        select(
            FindingSighting.id,
            Box.class_id,
            FindingSighting.placement,
            FindingSighting.cx,
            FindingSighting.cy,
            FindingSighting.cz,
            FindingSighting.group_tag,
            FindingSighting.image_id,
        )
        .join(Box, Box.id == FindingSighting.annotation_id)
        .where(FindingSighting.asset_model_id == asset_model_id)
        .order_by(FindingSighting.created_at, FindingSighting.id)
    )
    return [
        GroupItem(
            id=sid,
            type_id=class_id,
            center=(cx, cy, cz) if placement in sightings.PLACED and cx is not None else None,
            group_tag=tag,
            image_id=image_id,
        )
        for sid, class_id, placement, cx, cy, cz, tag, image_id in s.execute(q).all()
    ]


def groups_for_model(model: AssetModel, items: Sequence[GroupItem]) -> list[list[str]]:
    """The photo unit groups by photo (one finding per photo, coordinator ruling from J5 N3/N7).
    The region unit, or a model with no review, clusters by distance and tag (spec §6.4)."""
    if (model.review or {}).get("finding_unit") == "photo":
        return group_by_photo(items)
    return group_sightings(items, cluster_m_for(model))


def _new_finding(
    s: Session,
    *,
    project_id: str,
    catalogue,
    asset_model_id: str,
    members: Sequence[FindingSighting],
    type_id: str,
    number: int | None = None,
    record_activity: bool = True,
) -> Finding:
    """A finding for `members`. Its severity is their maximum, set only here, on creation (spec
    §6.4); with no graded sighting it is the type's default."""
    levels = [m.severity for m in members if m.severity is not None]
    extra = {"severity": max(levels)} if levels else {}
    return service.create_in_session(
        s,
        project_id=project_id,
        catalogue=catalogue,
        type_id=type_id,
        anchor=AnchorIn(kind="asset", asset_model_id=asset_model_id),
        number=number,
        record_activity=record_activity,
        **extra,
    )


def _close_merged(
    s: Session, *, project_id: str, catalogue, loser: Finding, survivor: Finding, text: str, author: str
) -> None:
    activity.record(
        s,
        "finding.merged",
        loser.id,
        f"{format_number(loser.number)} merged into {format_number(survivor.number)}",
        {"into": survivor.id},
    )
    sightings.close_with_comment(
        s, project_id=project_id, catalogue=catalogue, finding=loser, text=text, author=author
    )


def apply_groups(s: Session, handle, asset_model_id: str, groups: Sequence[Sequence[str]]) -> GroupResult:
    """Write `groups` (from `group_sightings`) as findings, under the Regroup rules of spec §6.4 (see
    plan J4 Task 3). One transaction: the caller's. A sighting deleted since the groups were
    computed is dropped, and a group left empty is skipped."""
    model = s.get(AssetModel, asset_model_id)
    if model is None:
        raise not_found("asset model", asset_model_id)
    rows: dict[str, FindingSighting] = {}
    type_of: dict[str, str] = {}
    q = (
        select(FindingSighting, Box.class_id)
        .join(Box, Box.id == FindingSighting.annotation_id)
        .where(FindingSighting.asset_model_id == asset_model_id)
    )
    for sighting, class_id in s.execute(q).all():
        rows[sighting.id] = sighting
        type_of[sighting.id] = class_id
    live = [[sid for sid in g if sid in rows] for g in groups]
    live = [g for g in live if g]
    findings = {
        f.id: f
        for f in s.execute(
            select(Finding).where(Finding.anchor_kind == "asset", Finding.asset_model_id == asset_model_id)
        ).scalars()
    }
    current: dict[str, set[str]] = defaultdict(set)
    for sid, row in rows.items():
        if row.finding_id:
            current[row.finding_id].add(sid)
    share: dict[str, Counter] = defaultdict(Counter)
    for gi, g in enumerate(live):
        for sid in g:
            if rows[sid].finding_id:
                share[rows[sid].finding_id][gi] += 1
    homes: dict[int, list[Finding]] = defaultdict(list)
    for fid, per_group in share.items():
        home = max(sorted(per_group), key=per_group.__getitem__)  # most sightings; ties: the higher group
        homes[home].append(findings[fid])

    result = GroupResult()
    touched: set[str] = set()
    merges: list[tuple[Finding, Finding]] = []
    fresh: list[tuple[list[str], set[str]]] = []
    for gi, g in enumerate(live):
        candidates = sorted(homes.get(gi, []), key=attrgetter("number"))
        if not candidates:
            fresh.append((g, {rows[sid].finding_id for sid in g if rows[sid].finding_id}))
            continue
        survivor, *losers = candidates
        result.kept += 1
        if not losers and current[survivor.id] == set(g):
            continue  # the same sightings: nothing is written, not even updated_at
        for sid in g:
            if rows[sid].finding_id:
                touched.add(rows[sid].finding_id)
            rows[sid].finding_id = survivor.id
        touched.add(survivor.id)
        merges += [(loser, survivor) for loser in losers]

    first = allocate(s, count=len(fresh)) if fresh else 0  # one block: new numbers read top-down
    for i, (g, sources) in enumerate(fresh):
        members = [rows[sid] for sid in g]
        new = _new_finding(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            asset_model_id=asset_model_id,
            members=members,
            type_id=type_of[g[0]],
            number=first + i,
            record_activity=False,  # one `findings.grouped` row instead of hundreds
        )
        findings[new.id] = new
        for m in members:
            m.finding_id = new.id
        touched |= sources | {new.id}
        if sources:
            result.split += 1
            for src in sorted(sources):
                activity.record(
                    s,
                    "finding.split",
                    src,
                    f"{format_number(new.number)} split from {format_number(findings[src].number)} by Regroup",
                    {"new_id": new.id},
                )
        else:
            result.created += 1
    s.flush()
    for fid in sorted(touched):
        sightings.refresh(s, findings[fid])
    for loser, survivor in merges:
        _close_merged(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            loser=loser,
            survivor=survivor,
            text=f"Merged into {format_number(survivor.number)} by Regroup.",
            author=sightings.SYSTEM_AUTHOR,
        )
        result.merged += 1
    activity.record(
        s,
        "findings.grouped",
        asset_model_id,
        f"Grouped sightings on {model.name}: {result.created} new, {result.kept} kept, "
        f"{result.merged} merged, {result.split} split",
        asdict(result),
    )
    events.mark_changed(s, handle.id, touched)
    return result


def _asset_finding(s: Session, finding_id: str) -> Finding:
    f = service.get_or_404(s, finding_id)
    if f.anchor_kind != "asset":
        raise AppError(
            "not_an_asset_finding",
            f"{format_number(f.number)} is not on an asset model; only asset findings merge and split.",
            422,
            {"finding_id": f.id},
        )
    return f


def merge(s: Session, handle, finding_id: str, into_id: str, *, author: str = sightings.SYSTEM_AUTHOR) -> Finding:
    """The operator merges `finding_id` into `into_id`. Every sighting moves to the survivor. The
    source is closed with a comment naming the survivor and keeps its note, comments and photos.
    Returns the survivor."""
    if finding_id == into_id:
        raise AppError("validation_error", "A finding cannot be merged into itself.", 422)
    src, dst = _asset_finding(s, finding_id), _asset_finding(s, into_id)
    if src.asset_model_id != dst.asset_model_id:
        raise AppError("merge_mismatch", "Both findings must be on the same asset model.", 422)
    if src.type_id != dst.type_id:
        raise AppError("merge_mismatch", "Both findings must have the same type.", 422)
    for row in sightings.of_finding(s, src.id):
        row.finding_id = dst.id
    s.flush()
    sightings.refresh(s, dst)
    sightings.refresh(s, src)
    _close_merged(
        s,
        project_id=handle.id,
        catalogue=handle.catalogue,
        loser=src,
        survivor=dst,
        text=f"Merged into {format_number(dst.number)}.",
        author=author,
    )
    events.mark_changed(s, handle.id, [src.id, dst.id])
    return dst


def split_in_session(
    s: Session,
    *,
    project_id: str,
    catalogue,
    finding_id: str,
    sighting_ids: Sequence[str],
    type_id: str | None = None,
) -> Finding:
    """Move `sighting_ids` out of `finding_id` into a new finding, of `type_id` (default: the
    source's type). The source keeps at least one sighting. Returns the new finding."""
    src = _asset_finding(s, finding_id)
    ids = list(dict.fromkeys(sighting_ids))
    owned = {r.id: r for r in sightings.of_finding(s, src.id)}
    foreign = [i for i in ids if i not in owned]
    if not ids or foreign:
        raise AppError(
            "validation_error", "Every sighting must belong to this finding.", 422, {"sighting_ids": foreign}
        )
    if len(ids) == len(owned):
        raise AppError("split_all", "Leave at least one sighting on the finding; a split takes some, not all.", 422)
    members = [owned[i] for i in ids]
    new = _new_finding(
        s,
        project_id=project_id,
        catalogue=catalogue,
        asset_model_id=src.asset_model_id,
        members=members,
        type_id=type_id or src.type_id,
    )
    for m in members:
        m.finding_id = new.id
    s.flush()
    sightings.refresh(s, new)
    sightings.refresh(s, src)
    activity.record(
        s,
        "finding.split",
        src.id,
        f"{format_number(new.number)} split from {format_number(src.number)}",
        {"new_id": new.id, "sightings": len(members)},
    )
    events.mark_changed(s, project_id, [src.id, new.id])
    return new


def split(s: Session, handle, finding_id: str, sighting_ids: Sequence[str]) -> Finding:
    return split_in_session(
        s, project_id=handle.id, catalogue=handle.catalogue, finding_id=finding_id, sighting_ids=sighting_ids
    )
```

- [ ] **Step 5: The job and `submit_group`**

`backend/app/asset_review/jobs_group.py`:

```python
"""`asset_group` (spec 2026-10-02-asset-findings §6.4): group an asset model's sightings into findings.

It runs at import, on Regroup, and after `asset_place` (J3 and J5 call `submit_group`). One
transaction writes the result, so a cancel or a crash leaves the findings as they were. The generic
orphan sweep (`app/jobs/startup.py`) closes an interrupted row, and nothing else needs settling.
"""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy import select

from app.asset_review import group
from app.db.models import AssetModel, Job
from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

GROUP_JOB = "asset_group"
LIVE_STATES = ("queued", "running")


@register_job_type(GROUP_JOB)
def run_group(ctx) -> dict:
    mid = ctx.params["asset_model_id"]
    ctx.progress(0, "Reading the sightings")
    with ctx.project.session() as s:
        model = s.get(AssetModel, mid)
        if model is None:
            raise JobFailure("The asset model was deleted before its findings could be grouped.")
        items = group.load_items(s, mid)
        s.expunge(model)
    ctx.check_cancelled()
    ctx.progress(0.3, f"Grouping {len(items):,} sightings")
    groups = group.groups_for_model(model, items)
    ctx.check_cancelled()
    ctx.progress(0.6, f"Writing {len(groups):,} findings")
    with ctx.project.session() as s:
        result = group.apply_groups(s, ctx.project, mid, groups)
    ctx.progress(1, f"{result.created} new, {result.kept} kept, {result.merged} merged, {result.split} split")
    return {**asdict(result), "asset_model_id": mid, "sightings": len(items), "groups": len(groups)}


def live_group_job(handle, asset_model_id: str) -> str | None:
    with handle.session() as s:
        rows = s.execute(select(Job.id, Job.params).where(Job.type == GROUP_JOB, Job.state.in_(LIVE_STATES)))
        for job_id, params in rows.all():
            if (params or {}).get("asset_model_id") == asset_model_id:
                return job_id
    return None


def submit_group(handle, runner, asset_model_id: str) -> Job:
    """Queue `asset_group` for one model, or 409 `job_running` with the live one's id."""
    live = live_group_job(handle, asset_model_id)
    if live is not None:
        raise AppError(
            "job_running", "The findings on this asset model are already being grouped.", 409, {"job_id": live}
        )
    return runner.submit(handle, GROUP_JOB, {"asset_model_id": asset_model_id})
```

- [ ] **Step 6: The Regroup route**

`backend/app/asset_review/group_router.py`:

```python
"""Regroup (spec 2026-10-02-asset-findings §8): `POST /asset-models/{assetModelId}/findings/regroup`
starts `asset_group`. Merge and split live on the findings router."""

from fastapi import APIRouter, Depends, Request

from app.asset_models import store
from app.asset_review import jobs_group
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


@router.post("/asset-models/{assetModelId}/findings/regroup", response_model=JobRef, status_code=202)
def regroup_asset_findings(
    assetModelId: str,  # noqa: N803
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> JobRef:
    with handle.session() as s:
        store.get_model(s, assetModelId)  # 404 for an unknown model
    job = jobs_group.submit_group(handle, request.app.state.jobs, assetModelId)
    return JobRef(job=JobOut.from_row(job, handle.id))
```

In `backend/app/api.py`, add one line to the guarded `for _module in (...)` tuple that holds `"app.asset_models.router"`, directly after `"app.asset_models.runs"`:

```python
    "app.asset_review.group_router",  # asset findings J4: Regroup (spec 2026-10-02-asset-findings §6.4)
```

If C0 registered `app.asset_review.stubs` in that same tuple, keep `group_router` above it.

- [ ] **Step 7: Merge and split routes**

In `backend/app/findings/schemas.py`, after `FindingSightingList`:

```python
class FindingMergeIn(BaseModel):
    into: str


class FindingSplitIn(BaseModel):
    sighting_ids: list[str] = Field(min_length=1, max_length=500)
```

In `backend/app/findings/router.py`:
- add `from app.asset_review import group` after the `fastapi` imports;
- add `FindingMergeIn` and `FindingSplitIn` to the schemas import;
- add after `delete_finding`:

```python
@router.post("/findings/{findingId}/merge", response_model=FindingOut)
def merge_finding(
    findingId: str,  # noqa: N803
    body: FindingMergeIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> FindingOut:
    """Merge this asset finding into `into`; the source is closed with a comment, never deleted."""
    author = comments.author_name(request.app.state.settings.data_dir)
    with handle.session() as s:
        row = group.merge(s, handle, findingId, body.into, author=author)
        rep = sightings.representatives(s, [row.id]).get(row.id)
        return FindingOut.from_row(row, representative=rep)


@router.post("/findings/{findingId}/split", response_model=FindingOut, status_code=201)
def split_finding(
    findingId: str,  # noqa: N803
    body: FindingSplitIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingOut:
    """A new finding from some of this asset finding's sightings."""
    with handle.session() as s:
        row = group.split(s, handle, findingId, body.sighting_ids)
        rep = sightings.representatives(s, [row.id]).get(row.id)
        return FindingOut.from_row(row, representative=rep)
```

Check the success codes C0 declared: `grep -n "operationId: mergeFinding\|operationId: splitFinding" -A24 contract/openapi.yaml | grep -n '"20'`. This plan assumes 200 for merge and 201 for split. If C0 declared otherwise, use C0's codes and change the two `status_code` assertions in the tests to match.

- [ ] **Step 8: Remove the three stubs**

In `backend/app/asset_review/stubs.py`, delete the tuples for `mergeFinding`, `splitFinding` and `regroupAssetFindings`. If J4's list is now empty, leave it as `[]` with its comment. Other units' lists stay. Mirror the removal in `backend/tests/test_contract.py` only if it names stubs by hand.

- [ ] **Step 9: Run them and see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_group_pure.py tests/test_asset_group_apply.py tests/test_asset_findings_merge_split.py tests/test_asset_findings_create.py tests/test_contract.py -q`
Expected: PASS, including `test_regroup_preserves_operator_edits` and `test_regroup_merge_closes_with_comment`. If schemathesis reports an undeclared refusal (404, 409 or 422) for `mergeFinding`, `splitFinding` or `regroupAssetFindings`, declare it in the contract in its own commit and regenerate. Never add an exclusion for a 500.

- [ ] **Step 10: Commit**

```bash
git add backend/app/asset_review/group.py backend/app/asset_review/jobs_group.py backend/app/asset_review/group_router.py backend/app/asset_review/stubs.py backend/app/api.py backend/app/findings/activity.py backend/app/findings/schemas.py backend/app/findings/router.py contract/openapi.yaml contract/client/schema.d.ts backend/tests/test_asset_group_apply.py backend/tests/test_asset_findings_merge_split.py
git commit -m "feat(asset-review): asset_group job, Regroup rules, merge and split (J4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Box and image hooks (Review Focus 4)

**Files:**
- Modify: `backend/app/findings/annotations.py` (`on_box_changed`, `on_box_deleting`, `on_images_deleting`, new `_sighting_box_changed`)
- Modify: `backend/app/findings/anchors.py` (`_image`: a sighting box cannot be adopted)
- Modify: `backend/app/findings/backfill.py` (`_candidates`)
- Test: `backend/tests/test_asset_findings_hooks.py`

**Interfaces:**
- Consumes:
  - Task 2: `sightings.of_box`, `of_finding`, `remove`, `refresh`, and the `BOX_GONE`, `NOT_A_SIGHTING` and `PHOTOS_GONE` texts.
  - Task 3: `group.split_in_session`.
- Produces (behaviour, through the existing box and image routes):
  - **Box delete:** the sighting goes. A finding left with none is closed with a comment, never deleted.
  - **Image bulk delete:** every sighting on those images goes first, by the same rule.
  - **Box geometry edit:** the sighting becomes `placement = "pending"`. J3's only-dirty run places it again.
  - **Box rejected, unreviewed or reclassed to an object type:** the sighting goes, by the same rule.
  - **Box reclassed to another defect type:** it splits out into a new finding of that type. When it is the finding's only sighting, the finding's type follows instead.
  - A sighting box never becomes an image finding: not through `on_box_changed`, not through the backfill, not through `POST /findings` adoption (409 `conflict`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_asset_findings_hooks.py`:

```python
"""Deleting the box behind a sighting, or the image (spec 2026-10-02-asset-findings §5.6; index
Review Focus 4): the sighting goes; a finding left with none is closed, not deleted. A sighting box is
never an image finding."""

import pytest
from asset_findings_helpers import (
    API,
    RECT,
    assert_counts_true,
    by_photo,
    finding_row,
    make_model,
    make_photos,
    place,
    post_asset,
    sightings_of,
)
from findings_helpers import add_type, use_types

from app.db.models import Box
from app.findings import annotations, sightings
from app.findings.backfill import findings_from_annotations


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def _box_of(handle, finding_id: str, photo_id: str) -> str:
    return by_photo(handle, finding_id)[photo_id].annotation_id


def _comments(client, ctx, finding_id: str) -> list[str]:
    return [c["text"] for c in client.get(f"{ctx['base']}/findings/{finding_id}/comments").json()["items"]]


def _all_findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def test_box_delete_closes_empty_finding(client, handle, ctx):
    p0, p1 = ctx["photos"][:2]
    alone = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    pair = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])

    assert client.delete(f"{ctx['base']}/boxes/{_box_of(handle, alone['id'], p0)}").status_code == 204
    closed = client.get(f"{ctx['base']}/findings/{alone['id']}").json()
    assert (closed["status"], closed["sighting_count"]) == ("closed", 0)
    assert _comments(client, ctx, alone["id"]) == [sightings.BOX_GONE]
    kinds = {a["kind"] for a in client.get(f"{ctx['base']}/activity", params={"subject_id": alone["id"]}).json()["items"]}
    assert "finding.status" in kinds

    assert client.delete(f"{ctx['base']}/boxes/{_box_of(handle, pair['id'], p0)}").status_code == 204
    still = client.get(f"{ctx['base']}/findings/{pair['id']}").json()
    assert (still["status"], still["sighting_count"]) == ("open", 1)
    assert still["representative"]["image_id"] == p1
    assert [f["id"] for f in _all_findings(client, ctx)] == [alone["id"], pair["id"]]  # nothing deleted
    assert_counts_true(handle)


def test_image_delete_closes_empty_findings(client, handle, ctx):
    p0, p1 = ctx["photos"][:2]
    alone = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    pair = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])
    r = client.post(f"{ctx['base']}/images/bulk-delete", json={"image_ids": [p0]})
    assert r.status_code == 200, r.text
    a = client.get(f"{ctx['base']}/findings/{alone['id']}").json()
    b = client.get(f"{ctx['base']}/findings/{pair['id']}").json()
    assert (a["status"], a["sighting_count"]) == ("closed", 0)
    assert (b["status"], b["sighting_count"]) == ("open", 1)
    assert _comments(client, ctx, alone["id"]) == [sightings.PHOTOS_GONE]
    assert [r.image_id for r in sightings_of(handle, pair["id"])] == [p1]
    assert len(_all_findings(client, ctx)) == 2  # closed, never deleted
    assert_counts_true(handle)


def test_a_box_edit_marks_its_sighting_pending_and_makes_no_image_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    sighting = by_photo(handle, f["id"])[p0]
    place(handle, sighting.id, (0.0, 12.0, 5.0))
    r = client.patch(f"{ctx['base']}/boxes/{sighting.annotation_id}", json={"x": 12.0})
    assert r.status_code == 200, r.text
    assert by_photo(handle, f["id"])[p0].placement == "pending"
    assert finding_row(handle, f["id"]).placement == "none"
    assert [g["id"] for g in _all_findings(client, ctx)] == [f["id"]]


def test_reclassing_one_of_several_sighting_boxes_splits_it_out(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0, p1 = ctx["photos"][:2]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0, p1])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p1)}", json={"class_id": rust["id"]})
    assert r.status_code == 200, r.text
    [old, new] = _all_findings(client, ctx)
    assert (old["id"], old["type_id"], old["sighting_count"]) == (f["id"], ctx["crack"], 1)
    assert (new["type_id"], new["sighting_count"], new["number"]) == (rust["id"], 1, 2)
    assert_counts_true(handle)


def test_reclassing_the_only_sighting_box_moves_the_finding_type(client, handle, project, ctx):
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p0)}", json={"class_id": rust["id"]})
    assert r.status_code == 200, r.text
    [only] = _all_findings(client, ctx)
    assert (only["id"], only["type_id"], only["sighting_count"]) == (f["id"], rust["id"], 1)
    assert_counts_true(handle)


def test_a_sighting_box_reclassed_to_an_object_type_leaves_its_finding(client, handle, project, ctx):
    truck = project["classes"][3]["id"]
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    r = client.patch(f"{ctx['base']}/boxes/{_box_of(handle, f['id'], p0)}", json={"class_id": truck})
    assert r.status_code == 200, r.text
    got = client.get(f"{ctx['base']}/findings/{f['id']}").json()
    assert (got["status"], got["sighting_count"]) == ("closed", 0)
    assert _comments(client, ctx, f["id"]) == [sightings.NOT_A_SIGHTING]
    assert_counts_true(handle)


def test_a_rejected_sighting_box_leaves_its_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    with handle.session() as s:
        box = s.get(Box, _box_of(handle, f["id"], p0))
        box.review_state = "rejected"
        assert annotations.on_box_changed(s, handle.id, handle.catalogue, box) == []
    assert finding_row(handle, f["id"]).status == "closed"
    assert sightings_of(handle, f["id"]) == []
    assert_counts_true(handle)


def test_the_backfill_skips_sighting_boxes(client, handle, ctx):
    post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    assert findings_from_annotations(handle) == 0
    assert len(_all_findings(client, ctx)) == 1


def test_a_sighting_box_cannot_be_adopted_as_an_image_finding(client, handle, ctx):
    p0 = ctx["photos"][0]
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], [p0])
    anchor = {"kind": "image", "image_id": p0, "annotation_id": _box_of(handle, f["id"], p0)}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_drawing_on_a_photo_still_makes_an_image_finding(client, ctx):
    """The ordinary box path is unchanged: a person's defect box beside a sighting is an image finding."""
    post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.post(f"{ctx['base']}/images/{ctx['photos'][0]}/boxes", json={"class_id": ctx["crack"], **RECT})
    assert r.status_code == 201, r.text
    kinds = sorted(f["anchor"]["kind"] for f in _all_findings(client, ctx))
    assert kinds == ["asset", "image"]
```

- [ ] **Step 2: Run them and see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_hooks.py -q`
Expected: FAIL. `test_box_delete_closes_empty_finding` and `test_image_delete_closes_empty_findings` fail on the foreign key from `finding_sighting.annotation_id` (IntegrityError, a 500), because the hooks do not know sightings yet. `test_a_box_edit_marks_its_sighting_pending_and_makes_no_image_finding` fails because an image finding is created.

- [ ] **Step 3: The hooks**

In `backend/app/findings/annotations.py`:

1. Change the module docstring's second paragraph to:

```
The box service (app/datasets/boxes.py) calls these hooks inside its own transaction, after it has
changed the box row. Each hook that deletes findings returns their ids, so the caller can move their
photos to the trash after the commit.

A box that is a sighting of an asset finding (asset findings spec §5.6) is never an image finding.
Its hooks change or remove the sighting. An asset finding left with no sighting is closed, never
deleted.
```

2. Replace the imports block:

```python
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Box, Finding, FindingSighting, ProjectType
from app.errors import AppError
from app.findings import activity, events, numbers, service, sightings
from app.findings.anchors import AnchorIn
```

3. Add `_sighting_box_changed` above `on_box_changed`:

```python
def _sighting_box_changed(
    s: Session, project_id: str, catalogue, box: Box, sighting: FindingSighting, previous_class_id: str | None
) -> None:
    """A sighting's box changed:

    - no longer ground truth, or now an object type: the sighting goes (the finding is closed when
      it was the last one);
    - reclassed to another defect type: it splits out into a finding of that type, or, when it is
      the only sighting, the finding's type follows;
    - otherwise (a geometry edit): the sighting is `pending` until `asset_place` places it again."""
    if box.review_state not in GROUND_TRUTH or not _is_defect(s, box.class_id):
        sightings.remove(s, project_id=project_id, catalogue=catalogue, rows=[sighting], reason=sightings.NOT_A_SIGHTING)
        return
    f = s.get(Finding, sighting.finding_id) if sighting.finding_id else None
    reclassed = previous_class_id is not None and previous_class_id != box.class_id
    if reclassed and f is not None and f.type_id != box.class_id:
        if len(sightings.of_finding(s, f.id)) > 1:
            from app.asset_review import group  # group imports this package

            group.split_in_session(
                s,
                project_id=project_id,
                catalogue=catalogue,
                finding_id=f.id,
                sighting_ids=[sighting.id],
                type_id=box.class_id,
            )
        else:
            service.patch_in_session(
                s, project_id=project_id, catalogue=catalogue, finding_id=f.id, fields={"type_id": box.class_id}
            )
        return
    sighting.placement = "pending"
    sighting.placed_version = None
    if f is not None:
        s.flush()
        sightings.refresh(s, f)
        events.mark_changed(s, project_id, [f.id])
```

4. In `on_box_changed`, insert these lines as the first statements of the body, before `f = finding_of(s, box.id)`:

```python
    sighting = sightings.of_box(s, box.id)
    if sighting is not None:
        _sighting_box_changed(s, project_id, catalogue, box, sighting, previous_class_id)
        return []
```

Also add this line to its docstring list: `- a sighting's box -> its sighting changes or goes (asset findings spec §5.6); never an image finding`.

5. Replace `on_box_deleting` and `on_images_deleting`:

```python
def on_box_deleting(s: Session, project_id: str, box: Box) -> list[str]:
    sighting = sightings.of_box(s, box.id)
    if sighting is not None:
        sightings.remove(s, project_id=project_id, catalogue=None, rows=[sighting], reason=sightings.BOX_GONE)
        return []
    f = finding_of(s, box.id)
    if f is None:
        return []
    return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]


def on_images_deleting(s: Session, project_id: str, image_ids: Iterable[str]) -> list[str]:
    """Before `images.bulk_delete` removes boxes with one SQL DELETE.

    Asset sightings on these images go first; an asset finding left with none is closed, never
    deleted. Image findings on them are deleted, since their box is their geometry. Returns the
    deleted findings' ids for the trash."""
    image_ids = list(image_ids)
    gone = list(s.execute(select(FindingSighting).where(FindingSighting.image_id.in_(image_ids))).scalars())
    if gone:
        sightings.remove(s, project_id=project_id, catalogue=None, rows=gone, reason=sightings.PHOTOS_GONE)
    ids = list(
        s.execute(select(Finding.id).where(Finding.anchor_kind == "image", Finding.image_id.in_(image_ids))).scalars()
    )
    for fid in ids:
        service.delete_in_session(s, project_id=project_id, finding_id=fid, delete_annotation=False)
    return ids
```

`catalogue=None` is safe on these paths: `sightings.remove` only closes findings (a status change), and `patch_in_session` reads the catalogue only for severity and type changes.

- [ ] **Step 4: A sighting box cannot be adopted, and the backfill skips it**

In `backend/app/findings/anchors.py`:
- add `FindingSighting` to the models import;
- in `_image`, insert after the `taken` check (before `return`):

```python
    owner = s.execute(
        select(FindingSighting.finding_id).where(FindingSighting.annotation_id == box.id)
    ).first()
    if owner is not None:
        raise AppError(
            "conflict", "That annotation is a sighting of an asset finding.", 409, {"finding_id": owner.finding_id}
        )
```

In `backend/app/findings/backfill.py`, import `FindingSighting` with the models and replace `_candidates`:

```python
def _candidates(type_ids: Sequence[str]):
    has_finding = select(Finding.id).where(Finding.annotation_id == Box.id).exists()
    is_sighting = select(FindingSighting.id).where(FindingSighting.annotation_id == Box.id).exists()
    return select(Box).where(
        Box.class_id.in_(list(type_ids)),
        or_(Box.review_state.in_(annotations.GROUND_TRUTH), Box.provenance_kind == "person"),
        ~has_finding,
        ~is_sighting,  # an asset finding's sighting box is that finding's geometry already
    )
```

- [ ] **Step 5: Run them and see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_hooks.py tests/test_findings_invariant.py tests/test_findings_backfill.py tests/test_asset_findings_create.py tests/test_asset_group_apply.py -q`
Expected: PASS, including `test_box_delete_closes_empty_finding` and `test_image_delete_closes_empty_findings`. The existing invariant and backfill tests stay green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/findings/annotations.py backend/app/findings/anchors.py backend/app/findings/backfill.py backend/tests/test_asset_findings_hooks.py
git commit -m "feat(findings): box and image deletes close emptied asset findings (J4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Register filters and sorts

**Files:**
- Modify: `backend/app/findings/query.py` (`SORTS`, `SORT_KEYS`, `FindingFilters`, `_where`, `_cursor_key`, `list_findings`)
- Modify: `backend/app/findings/router.py` (`list_findings` parameters)
- Test: `backend/tests/test_asset_findings_query.py`

**Interfaces:**
- Consumes: Task 2 (`POST /findings` asset); the D1 columns.
- Produces:
  - `GET /findings` takes:
    - `asset_model_id`;
    - `zone`, `side` and `component` (each repeatable);
    - `placed` (bool);
    - `anchor_kind=asset` (the register's "source");
    - `sort=-height`: highest first, no height last, ties by number;
    - `sort=zone`: zone id ascending, no zone last, ties by number.
  - `FindingFilters` gains `asset_model_id: str | None`, `zone`, `side` and `component` as `list[str] | None`, and `placed: bool | None`. U4 builds its query string from these names.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_asset_findings_query.py`:

```python
"""The register's asset filters and sorts (spec 2026-10-02-asset-findings §8 `GET /findings`): keyset
paging holds for the new sorts, and no-height or no-zone findings sort last."""

import pytest
from asset_findings_helpers import API, make_model, make_photos, post_asset, set_finding
from findings_helpers import insert_cloud

from app.findings import service
from app.findings.anchors import AnchorIn

SHAPE = {
    "F1": ("m1", 25.0, "antenna", "N", "mast", "point"),
    "F2": ("m1", 12.0, "body", "E", "leg", "patch"),
    "F3": ("m1", None, None, None, None, "none"),
    "F4": ("m1", 3.0, "base", "E", "leg", "point"),
    "F5": ("m2", 40.0, "body", "W", "flue", "patch"),
}


@pytest.fixture
def five(client, handle, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    photos = make_photos(client, project, import_source, tmp_path, make_jpeg, n=1)
    models = {"m1": make_model(handle, name="Tower"), "m2": make_model(handle, name="Stack")}
    ids = {}
    for key, (m, height, zone, side, component, placement) in SHAPE.items():
        f = post_asset(client, project["id"], crack["id"], models[m], photos)
        set_finding(handle, f["id"], height_m=height, zone=zone, side=side, component=component, placement=placement)
        ids[key] = f["id"]
    cloud = AnchorIn(kind="cloud", cloud_id=insert_cloud(handle), x=1.0, y=2.0, z=3.0)
    ids["C"] = service.create_finding(handle, type_id=crack["id"], anchor=cloud).id
    return {"base": f"{API}/projects/{project['id']}", "ids": ids, **models}


def _names(five, items) -> list[str]:
    back = {v: k for k, v in five["ids"].items()}
    return [back[f["id"]] for f in items]


def _list(client, five, **params) -> list[str]:
    r = client.get(f"{five['base']}/findings", params={"sort": "number", **params})
    assert r.status_code == 200, r.text
    return _names(five, r.json()["items"])


def _walk(client, five, sort: str, **params) -> list[str]:
    out, cursor = [], None
    while True:
        q = {"sort": sort, "limit": 2, **params}
        if cursor:
            q["cursor"] = cursor
        r = client.get(f"{five['base']}/findings", params=q)
        assert r.status_code == 200, r.text
        page = r.json()
        out += _names(five, page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            return out


def test_filters_by_model_zone_side_and_component(client, five):
    assert _list(client, five, asset_model_id=five["m1"]) == ["F1", "F2", "F3", "F4"]
    assert _list(client, five, zone="body") == ["F2", "F5"]
    assert _list(client, five, zone=["body", "base"], asset_model_id=five["m1"]) == ["F2", "F4"]
    assert _list(client, five, side="E") == ["F2", "F4"]
    assert _list(client, five, component="leg") == ["F2", "F4"]


def test_placed_filter(client, five):
    assert _list(client, five, placed="true") == ["F1", "F2", "F4", "F5"]
    assert _list(client, five, placed="false") == ["F3"]  # the cloud finding is not an unplaced asset one


def test_source_asset(client, five):
    assert _list(client, five, anchor_kind="asset") == ["F1", "F2", "F3", "F4", "F5"]
    assert _list(client, five, anchor_kind="cloud") == ["C"]


def test_sort_by_height_pages_highest_first_and_no_height_last(client, five):
    assert _walk(client, five, "-height", anchor_kind="asset") == ["F5", "F1", "F2", "F4", "F3"]


def test_sort_by_zone_pages_with_no_zone_last(client, five):
    assert _walk(client, five, "zone", anchor_kind="asset") == ["F1", "F4", "F2", "F5", "F3"]


def test_a_cursor_from_another_sort_is_refused(client, five):
    r = client.get(f"{five['base']}/findings", params={"sort": "-height", "limit": 2})
    cursor = r.json()["next_cursor"]
    r = client.get(f"{five['base']}/findings", params={"sort": "zone", "cursor": cursor})
    assert r.status_code == 422
```

- [ ] **Step 2: Run them and see them fail**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_query.py -q`
Expected: FAIL. The new filters are ignored (wrong lists), and `sort=-height` is 422.

- [ ] **Step 3: Implement in `query.py`**

In `backend/app/findings/query.py`:

1. Replace `SORTS` and `SORT_KEYS`, and add two constants:

```python
SORTS = ("-severity", "number", "-updated_at", "type", "-height", "zone")
SORT_KEYS = {"-severity": ("s",), "number": (), "-updated_at": ("u",), "type": ("t",), "-height": ("h",), "zone": ("z",)}
NO_HEIGHT = -1.0e12  # a finding with no height (unplaced, or not an asset finding) sorts last
NO_ZONE = "\uffff"  # after every zone id in SQLite's binary text order
```

2. Add these fields at the end of `FindingFilters`:

```python
    asset_model_id: str | None = None  # asset findings spec §8
    zone: list[str] | None = None
    side: list[str] | None = None
    component: list[str] | None = None
    placed: bool | None = None  # true: point or patch; false: asset findings with no placement
```

3. In `_where`, before `text = (f.q or "").strip()`:

```python
    if f.asset_model_id:
        q = q.where(Finding.asset_model_id == f.asset_model_id)
    if f.zone:
        q = q.where(Finding.zone.in_(f.zone))
    if f.side:
        q = q.where(Finding.side.in_(f.side))
    if f.component:
        q = q.where(Finding.component.in_(f.component))
    if f.placed is True:
        q = q.where(Finding.placement.in_(("point", "patch")))
    elif f.placed is False:
        q = q.where(Finding.anchor_kind == "asset", or_(Finding.placement.is_(None), Finding.placement == "none"))
```

4. In `_cursor_key`, before `return {}`:

```python
    if sort == "-height":
        return {"h": NO_HEIGHT if row.height_m is None else row.height_m}
    if sort == "zone":
        return {"z": NO_ZONE if row.zone is None else row.zone}
```

5. In `list_findings`, insert two branches before the final `else:` (the `type` sort):

```python
    elif sort == "-height":
        hv = func.coalesce(Finding.height_m, NO_HEIGHT)
        if c:
            q = q.where(or_(hv < c["h"], and_(hv == c["h"], Finding.number > c["n"])))
        q = q.order_by(hv.desc(), Finding.number.asc())
    elif sort == "zone":
        zv = func.coalesce(Finding.zone, NO_ZONE)
        if c:
            q = q.where(or_(zv > c["z"], and_(zv == c["z"], Finding.number > c["n"])))
        q = q.order_by(zv.asc(), Finding.number.asc())
```

- [ ] **Step 4: Router parameters**

In `backend/app/findings/router.py` `list_findings`:
- change `anchor_kind: list[Literal["image", "map", "cloud"]] | None = Query(None)` to `anchor_kind: list[Literal["image", "map", "cloud", "asset"]] | None = Query(None)`;
- change `sort` to `sort: Literal["-severity", "number", "-updated_at", "type", "-height", "zone"] = "-severity"`;
- add after `has_location: bool | None = None,`:

```python
    asset_model_id: str | None = None,
    zone: list[str] | None = Query(None),
    side: list[str] | None = Query(None),
    component: list[str] | None = Query(None),
    placed: bool | None = None,
```

- pass the five into `query.FindingFilters(...)`: `asset_model_id=asset_model_id, zone=zone, side=side, component=component, placed=placed`.

Compare with the contract: `grep -n "operationId: listFindings" -A40 contract/openapi.yaml`. If C0 declared `zone`, `side` or `component` as a single string rather than an array, keep the backend's `list[str]`: a single value still parses, and the contract test only checks that the route exists.

- [ ] **Step 5: Run them and see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_findings_query.py tests/test_findings_query.py tests/test_findings_api.py tests/test_contract.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/findings/query.py backend/app/findings/router.py backend/tests/test_asset_findings_query.py
git commit -m "feat(findings): asset filters and height and zone sorts in the register (J4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Unit gate

**Files:** none new. Fix only what the gate reports, in the file it names.

- [ ] **Step 1: Confirm every J4 stub is gone**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -c "import app.asset_review.stubs as m; names = {t[2] for t in m.STUBS}; left = names & {'listFindingSightings','mergeFinding','splitFinding','regroupAssetFindings'}; assert not left, left; print('ok')"` (from `backend/`).
Expected: `ok`. If C0's module exposes the tuples under another name than `STUBS`, read the module and check by eye that those four operationIds are absent.

- [ ] **Step 2: Run the full gate** (AGENTS.md)

```powershell
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest
cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. If `ruff format --check` fails, run `.\.venv\Scripts\python.exe -m ruff format` on the files this unit touched only, re-run, and commit by path. The `cargo test` line runs only when `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists; a fresh worktree skips it.

- [ ] **Step 3: Packaging check**

This unit adds routes and renames none, so `backend/scripts/*.ps1` and `backend/kestrel_backend.spec` need no change. Confirm with `git diff main --stat -- backend/scripts backend/kestrel_backend.spec`, which should print nothing.

- [ ] **Step 4: Land**

Run `scripts\finish-task.ps1`. On PowerShell 5.1, where it fails, use the manual fallback: merge `task/af-j4` into `main` with `--no-ff`, re-run the gate on `main`, remove the worktree, and delete the branch.

**Operator walkthrough** (for the session note; the UI arrives with U2, U3 and U4):
1. `pnpm -C frontend dev`, open a project with photos, and create an asset model.
2. In the API docs (`/docs` on the sidecar), `POST /findings` with an `asset` anchor and two sightings on two photos. Expect one finding, `sighting_count` 2, and two boxes in the image view.
3. Delete one of the two boxes in the image view. Expect the finding still open with `sighting_count` 1.
4. Delete the other box. Expect the finding closed (not gone) in the register, with the comment "Closed by Kestrel: the last photo box behind this finding was deleted."
5. Create two findings with one sighting each, then `POST /findings/{a}/merge` with `{into: b}`. Expect `a` closed with "Merged into F-xxxx.".
6. `POST /asset-models/{id}/findings/regroup`. Expect a job in the Jobs panel that succeeds with created, kept, merged and split counts.

---

## Self-review

**Spec coverage for J4:**
- §6.4 union-find with tag joins, unplaced singletons and the spatial hash: Task 1.
- §6.4 first-run order, the Regroup keep, merge and split rules, severity only on creation, and the representative rule: Tasks 2 and 3.
- §5.5 asset anchor, `lon` and `lat` from the frame origin, `sighting_count` and the derived fields: Task 2.
- §5.6 box delete through `findings/annotations.py`, closed never deleted: Task 4.
- A1: sightings are the evidence. A2: an image finding is one implicit sighting (Task 2 route). A3: grouping only in the job, merge and split explicit: Task 3.
- §8: `POST /findings` asset, merge, split, sightings, Regroup, and the `GET /findings` filters and sorts: Tasks 2, 3 and 5.
- §9: the gallery thumbnail from the representative crop: Task 2.
- §12 "Grouping" tests: chain, tag join and unplaced singleton (Task 1); Regroup keeps numbers, statuses and comments (Task 3).

**Review Focus pinned here:**
- `test_regroup_preserves_operator_edits` and `test_regroup_merge_closes_with_comment` (Task 3).
- `test_box_delete_closes_empty_finding` and `test_image_delete_closes_empty_findings` (Task 4).

**Counts:** every finding write in this unit goes through `service.create_in_session`, `patch_in_session` or `delete_in_session`. Each test that writes ends with `assert_counts_true`, which compares `finding_count` with a recount.

**Placeholders:** none. The only conditional steps match C0's declared success codes and schema field names, or D1's `representative` field, and each says exactly what to do in either case.

---

## Index notes

- **N1 (needs D1; a spec gap).** Spec §5.6 gives `finding_sighting` no model link and does not say that `finding_id` may be null. But spec §6.5 has J5 create sightings before `asset_group` creates their findings ("On first run: creates findings"). J4 therefore needs D1's migration 0016 to:
  - make `finding_sighting.finding_id` **nullable** (an ungrouped sighting; FK `finding.id` ON DELETE CASCADE stays);
  - add `finding_sighting.asset_model_id` (String(36), NOT NULL, FK `asset_model.id`, indexed `(asset_model_id, finding_id)`), so grouping and placement can select one model's sightings.

  Task 2 Step 1 checks both and stops if either is missing.
- **N2 (D1 and J4 boundary in `findings/schemas.py`).**
  - J4 adds the request and response shapes of its own routes: `SightingIn`, `AssetAnchorIn` in `FindingAnchorIn`, `FindingSightingOut`, `FindingSightingList`, `FindingMergeIn` and `FindingSplitIn`.
  - J4 also adds the `representative` keyword to D1's `FindingOut.from_row`. The representative has no column: it is computed from the sightings by one rule (`sightings.pick_representative`), batched per page.
  - D1 keeps the asset fields and `anchor_of`'s `asset` branch.
- **N3 (for J3).**
  - A sighting needs placing when `placement = 'pending'`. New sightings start pending, and J4 sets pending again on a box geometry edit. J3's `only_dirty` should select on that.
  - J3 enqueues grouping with `app.asset_review.jobs_group.submit_group(handle, runner, asset_model_id)`.
  - J3 must not write the finding's derived columns; `sightings.refresh` does that after grouping.
- **N4 (for J5).** Create sightings with `app.findings.sightings.add_sighting(s, handle, asset_model_id=..., finding_id=None, image_id=..., type_id=..., box=... or points=..., severity=..., group_tag=...)`, then call `submit_group`. The box is a person-drawn accepted box, and the backfill skips it.
- **N5 (for D1's 409 `has_findings`).** Ungrouped sightings reference a model without any finding. D1's delete refusal should also refuse while any `finding_sighting` row has that `asset_model_id`. Otherwise a cascade would leave their defect boxes behind with no finding.
- **N6 (files beyond the index's J4 list).** J4 also edits:
  - `findings/backfill.py`, so the backfill never turns a sighting box into an image finding;
  - `findings/thumbnails.py`, for the representative crop U4's gallery shows;
  - `findings/activity.py`, for the kinds `finding.merged`, `finding.split` and `findings.grouped`;
  - the `Activity.kind` description in `contract/openapi.yaml`, a description-only change committed with its regenerated client, under the index rule that a later unit may add to the contract in its own commit.
- **N7 (P1 names assumed).** `ReviewConfig` is importable from `app.asset_review.profiles`. `derive(...)` returns an object with `height_m`, `bearing_deg`, `side` and `zone` attributes. Compass side labels are the kit's `N`, `NE`, `E` and so on.
- **N9 (photo unit, coordinator ruling from J5 N3/N7).**
  - When `review.finding_unit == "photo"`, grouping is `group_by_photo`: one group per photo, ignoring distance and tags, and unplaced sightings follow their photo.
  - `groups_for_model` picks the grouping for the job and for Regroup.
  - The group key is `(image_id, type_id)`, so a photo holding two defect types gives two findings, because a finding has one type. The ruling's cases are all one type (EBSM gives one sighting per photo), so this matches it.
  - Tests: three pure tests in Task 1; in Task 3, `test_photo_unit_two_photos_close_together_stay_two_findings` and `test_photo_unit_one_photo_with_five_sightings_is_one_finding_and_regroup_keeps_it`.
- **N8 (numbers).** `findings/numbers.py` needs no change. `apply_groups` reserves one consecutive block with `numbers.allocate(s, count=n)` and passes `number=` to `create_in_session`, so new numbers read top-down.
