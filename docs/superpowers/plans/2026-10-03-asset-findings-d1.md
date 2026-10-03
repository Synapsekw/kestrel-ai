# Asset findings D1: migration 0016, models, finding output, photo review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data layer of the asset findings phase:
- project migration `0016` and its ORM classes, with the `asset` anchor in the finding CHECK;
- finding answers that read the new columns;
- the photo review status API, with `image.marked_empty` kept in step;
- the `review_status` filter on the image index;
- the `has_findings` refusal on asset model delete.

Every later backend unit (J1 to J5) writes into these tables.

**Architecture:**
- **Migration `0016`** (`backend/app/db/migrations/versions/0016_asset_findings.py`):
  - `asset_model.frame` and `review` are plain `ADD COLUMN`s.
  - `finding` is rebuilt in Alembic batch mode (`recreate="always"`). That is how catalogue `0003` re-created its CHECK; 0010 created this CHECK inside `create_table`, so it has no re-create to copy. The rebuild adds:
    - the asset columns;
    - the fourth `ck_finding_anchor` branch and `ck_finding_placement`;
    - a foreign key to `asset_model`;
    - two indexes.
  - Three new tables: `image_pose`, `image_review`, `finding_sighting`.
  - Per the coordinator ruling (J4 N1), `finding_sighting.finding_id` is nullable and the table carries `asset_model_id NOT NULL` (FK RESTRICT, indexed).
- **The rebuild runs with foreign keys off.** This was found while planning and proven in a scratch run. `open_project_db` turns `PRAGMA foreign_keys=ON` on the very connection Alembic uses. With it on, SQLite's `DROP TABLE finding` (a step of every batch rebuild) first runs an implicit `DELETE FROM finding`. That deletes every `finding_comment`, `finding_attachment` and `cloud_view` row and nulls `cloud_measurement.finding_id`. A naive batch migration loses the operator's comments silently, and a test in the style of the 0015 tests would still pass. Task 1 pins this with a 0015 and a 0014 project that hold findings with children, and records an ADR.
- **Copy-first.** Today `open_project_db` takes a copy only when the upgrade crosses `0010`, so a 0015 project would reach 0016 with no copy. Task 2 adds `REBUILD_GUARDS = ("0016",)` to `app/migration/backup.py`: opening a project at 0010 to 0015 first writes `backups/project.db.r0016-<stamp>.bak`.
- **Finding answers.** After C0, `FindingOut` already has every new field, filled with placeholders. D1 makes `from_row` read the columns and adds the asset branch of `anchor_of`. The asset branch of `representative_of` belongs to J4 (coordinator ruling).
- **Photo review.**
  - `app/asset_review/review_status.py` (`get_review`, `set_status`) and `app/asset_review/review_router.py` serve `GET` and `PUT /images/{imageId}/review`.
  - `set_status` marks or clears `image.marked_empty` through a new `app.datasets.empties.apply_mark`, by the Data Manager's own rules: 409 while the photo has accepted boxes, and pending proposals rejected.
  - In the other direction, `empties.follow_review` moves an existing review row when the mark changes in the Data Manager.
  - One **effective status** helper, `app/asset_review/effective.py`, gives a photo's status:
    `COALESCE(image_review.status, CASE WHEN image.marked_empty THEN 'none' ELSE 'not_assessed' END)`.
  - Both the GET and the image index's `review_status` filter use that helper, so they always agree (coordinator ruling). The filter takes over U4 Task 8.

**Tech Stack:** FastAPI, SQLAlchemy 2.0.54, Alembic 1.20.0 (batch mode reflects named CHECK constraints), SQLite 3.53, pytest.

**Spec sections covered:**
- §5.1 (the columns only; J1 owns validation and `PATCH`), §5.2, §5.3, §5.4.
- §5.5 (the schema; J4 owns the anchor service), §5.6.
- §8: `GET`/`PUT /images/{id}/review` and the `Finding` columns.
- §9: the register's photo outcome chips need the image index `review_status` filter.
- §12: "CHECK constraint: every anchor kind accepted, every mixed state rejected".
- The index amendment "asset model delete answers 409 `has_findings`".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** C0 merged to `main`. C0 provides:
- the contract;
- the 501 stubs in `backend/app/asset_review/stubs.py` (`D1_STUBS`);
- `FindingOut` with the new fields and `representative_of`;
- `AssetModelOut.frame` and `review`, and `AssetModelVersionOut.kind` with `imported`;
- the `review_status` parameter on `getImageIndex`.

Nothing else.

**Worktree:** `scripts\start-task.ps1 -Name af-d1`

---

## Ownership and hand-offs

- **D1 owns** `backend/app/db/models.py` and migration `0016` (index, "File ownership").
- **J4 owns** `backend/app/findings/service.py`, `anchors.py` and `query.py` and their **logic**. D1 does not touch them. D1 adds the columns and makes `FindingOut.from_row` read them; nothing more. J4 does:
  - creating, patching and closing asset findings;
  - `anchors.repatch` for `asset` (today it would fall through to the cloud branch);
  - `delete_for_anchor`;
  - box and image deletes that remove sightings (`findings/annotations.py`);
  - the asset branch of `representative_of`;
  - the `anchor_kind=asset` filter and the `asset_model_id`, `zone`, `side`, `component` and `placed` filters, with the `-height` and `zone` sorts;
  - `lon`/`lat` from the frame origin.
- **J1 owns** `PATCH /asset-models/{id}` for `frame` and `review`. D1 stores the columns; C0's `AssetModelOut` already reads them through `from_attributes`.
- `finding.data_type` and `asset_model_version.kind` are plain string columns with no CHECK. The values `asset_model` and `imported` need no schema change.
- **U5** keeps the Overview `photo_review` counts. D1 does not touch `backend/app/overview/`.
- **U4** skips its Task 8. D1 Task 6 implements the backend `review_status` filter.

## Budget and execution DAG

**Background jobs:** none. Nothing in D1 is long work:
- The migration runs inside the project open, as every revision does.
- The rebuild is one `INSERT INTO ... SELECT` inside SQLite; no row passes through Python.
- The copy uses SQLite's online backup API, as the foundation copy does.

**Bounded reads:**
- `GET /images/{id}/review` reads one row.
- `follow_review()` updates in chunks of 500 (`empties.CHUNK_SIZE`).
- The `review_status` filter adds one correlated lookup per image row on the `image_review` primary key, inside the index's existing capped query (`INDEX_CAP`).
- The delete check is two `COUNT`s on indexed columns.

**DAG:**

```
Task 1 (migration, ORM) ──┬──> Task 2 (copy-first guard)
                          ├──> Task 3 (delete 409 has_findings)
                          ├──> Task 4 (finding answers read the columns)
                          └──> Task 5 (photo review API) ──> Task 6 (index review_status filter)
Tasks 2 to 6 ──> Task 7 (gate, merge)
```

- Tasks 2, 3, 4 and 5 touch disjoint files. They may be dispatched in parallel after Task 1. Each is small, so serial in one worktree is the default.
- Task 6's test uses Task 5's `set_status`.
- **Critical path:** Task 1, Task 5, Task 6, Task 7.

## What D1 reads from C0

These come from `docs/superpowers/plans/2026-10-03-asset-findings-c0.md`, Tasks 1 to 3:
- `ImageReview {image_id, status, note, coverage: number|null, uncertain_coverage: number|null, updated_at: date-time|null}`, where null means never reviewed.
- `ImageReviewPut {status, note?}` (`additionalProperties: false`, note at most 4,000 characters).
- `ImageReviewStatus: [finding, none, uncertain, not_assessed]`.
- `FindingAssetAnchor {kind: asset, asset_model_id, asset_version: int|null, point: number[3]|null, normal: number[3]|null}`.
- `deleteAssetModel` 409: `has_findings` with details `{count}`, "while any finding or ungrouped sighting references it".
- `imageReviewStatus` on `getImageIndex`.
- The stubs: `D1_STUBS` in `backend/app/asset_review/stubs.py` holds `getImageReview` and `putImageReview`. `tests/test_contract.py::EXPECTED_STUBS` reads the lists, so D1 only deletes its tuples. Its router module goes in `app/api.py` above `"app.asset_review.stubs"`.

---

### Task 1: Migration 0016 and the ORM classes

**Files:**
- Create: `backend/app/db/migrations/versions/0016_asset_findings.py`
- Modify: `backend/app/db/models.py`: `ANCHOR_CHECK` (line 678), `Finding` (line 691), `AssetModel` (line 861) and `AssetModelVersion.kind` (line 886). Three new classes go after `AssetModelRun`.
- Create: `backend/tests/test_migration_0016.py`
- Modify: `backend/tests/test_migration_0010.py::test_0010_freezes_its_anchor_check_instead_of_importing_the_model`
- Modify: `backend/tests/test_migration_0015.py::test_single_head_is_0015`
- Create: `vault/decisions/2026-10-03-gotcha-sqlite-rebuild-cascades-children.md`

**Interfaces:**
- Consumes: revision `0015` (`down_revision`).
- Produces (`app.db.models`):
  - `ANCHOR_CHECK` (four branches) and `FINDING_PLACEMENT_CHECK`.
  - New `Finding` columns:
    - `asset_model_id: str | None` (FK `fk_finding_asset_model`, no ON DELETE);
    - `asset_version: int | None`;
    - `ax, ay, az, an_x, an_y, an_z: float | None`;
    - `placement: str | None` (`point|patch|none`);
    - `height_m, bearing_deg: float | None`;
    - `side, zone, component: str | None`;
    - `sighting_count: int = 0`.
  - `AssetModel.frame` and `AssetModel.review`: `dict | None`.
  - `class ImagePose`: PK `(asset_model_id, image_id)`, both CASCADE.
  - `class ImageReview`: PK `image_id`, CASCADE. With it come `IMAGE_REVIEW_STATUSES` and `IMAGE_REVIEW_STATUS_CHECK`.
  - `class FindingSighting`, with `SIGHTING_PLACEMENT_CHECK`:
    - `finding_id: str | None`, CASCADE;
    - `asset_model_id: str`, RESTRICT;
    - `image_id` and `annotation_id` with no ON DELETE;
    - `annotation_id` unique.
- Produces (migration module): `ANCHOR_CHECK`, `ANCHOR_CHECK_0010`, `FINDING_PLACEMENT_CHECK`, `IMAGE_REVIEW_STATUS_CHECK`, `SIGHTING_PLACEMENT_CHECK`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_migration_0016.py`:

```python
"""Migration 0016 (asset findings spec §5.1 to §5.6).

A project at 0015 or 0014 that already holds findings upgrades through `open_project_db` (foreign
keys on) and keeps every child row: the `finding` rebuild must not cascade comments and
attachments away, nor null a measurement's link. The anchor CHECK takes the asset branch and
rejects every mixed state; the ORM and the migration describe the same tables; an interrupted
rebuild recovers; the downgrade keeps the older findings."""

import importlib.util
import sqlite3

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.asset_models.schemas import AssetModelVersionOut
from app.db.base import Base
from app.db.models import (
    AssetModel,
    AssetModelVersion,
    Box,
    Finding,
    FindingSighting,
    Image,
    ImagePose,
    ImageReview,
    Source,
)
from app.db.session import MIGRATIONS, alembic_config, make_session_factory, open_project_db

REVISION = "0016"
PATH = MIGRATIONS / "versions" / "0016_asset_findings.py"
T0 = "2026-01-01 00:00:00.000000"
NEW_TABLES = {"image_pose": ImagePose, "image_review": ImageReview, "finding_sighting": FindingSighting}
CHANGED = {"finding": Finding, "asset_model": AssetModel}
STRUCTURAL = {
    "add_table",
    "remove_table",
    "add_column",
    "remove_column",
    "add_index",
    "remove_index",
    "add_fk",
    "remove_fk",
}
SEED = f"""
INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at)
  VALUES ('s1', 'C:/flights/a', 'A', '{{}}', 1, 0, '{T0}');
INSERT INTO image (id, path, width, height, source_id, group_key, marked_empty, created_at)
  VALUES ('i1', 'images/a.jpg', 100, 100, 's1', '', 0, '{T0}');
INSERT INTO box (id, image_id, class_id, x, y, w, h, angle, provenance_kind, review_state, created_at)
  VALUES ('b1', 'i1', 't1', 0.5, 0.5, 0.1, 0.1, 0, 'person', 'accepted', '{T0}');
INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)
  VALUES ('pc1', 'Scan', 'ready', 'C:/c.las', 1, '{T0}');
INSERT INTO finding (id, number, type_id, status, note, created_by, anchor_kind, image_id, annotation_id,
  data_type, data_id, created_at, updated_at)
  VALUES ('f1', 1, 't1', 'open', 'on the photo', 'human', 'image', 'i1', 'b1', 'image_set', 's1',
  '{T0}', '{T0}');
INSERT INTO finding (id, number, type_id, status, note, created_by, anchor_kind, map_id, geometry,
  data_type, data_id, created_at, updated_at)
  VALUES ('f2', 2, 't1', 'open', '', 'human', 'map', 'm1', '{{"type": "Point", "coordinates": [0, 0]}}',
  'map', 'm1', '{T0}', '{T0}');
INSERT INTO finding (id, number, type_id, status, note, created_by, anchor_kind, cloud_id, x, y, z,
  data_type, data_id, created_at, updated_at)
  VALUES ('f3', 3, 't1', 'reviewed', '', 'human', 'cloud', 'pc1', 1, 2, 3, 'point_cloud', 'pc1',
  '{T0}', '{T0}');
INSERT INTO finding_comment (id, finding_id, author, text, created_at)
  VALUES ('c1', 'f1', 'D', 'seen twice', '{T0}');
INSERT INTO finding_attachment (id, finding_id, path, original_name, width, height, bytes, created_at)
  VALUES ('a1', 'f2', 'findings/f2/a1.jpg', 'a.jpg', 1, 1, 1, '{T0}');
INSERT INTO cloud_measurement (id, point_cloud_id, kind, name, points, results, created_at, updated_at,
  status, finding_id)
  VALUES ('cm1', 'pc1', 'point', 'P1', '[]', '{{}}', '{T0}', '{T0}', 'ready', 'f3');
"""


def _module():
    spec = importlib.util.spec_from_file_location("rev_0016", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _at(folder, revision: str):
    """A project folder at `revision` (plain Alembic, foreign keys off) holding the SEED rows."""
    folder.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(folder), revision)
    con = sqlite3.connect(folder / "project.db")
    con.executescript(SEED)
    con.commit()
    con.close()
    return folder


def _children(folder) -> tuple:
    con = sqlite3.connect(folder / "project.db")
    try:
        return (
            con.execute("SELECT id, note FROM finding ORDER BY number").fetchall(),
            con.execute("SELECT id, finding_id, text FROM finding_comment").fetchall(),
            con.execute("SELECT id, finding_id FROM finding_attachment").fetchall(),
            con.execute("SELECT id, finding_id FROM cloud_measurement").fetchall(),
        )
    finally:
        con.close()


KEPT = (
    [("f1", "on the photo"), ("f2", ""), ("f3", "")],
    [("c1", "f1", "seen twice")],
    [("a1", "f2")],
    [("cm1", "f3")],
)


def _table(diff) -> str:
    kind = diff[0]
    if kind in ("add_table", "remove_table"):
        return diff[1].name
    if kind in ("add_column", "remove_column"):
        return diff[2]
    if kind in ("add_index", "remove_index", "add_fk", "remove_fk"):
        return diff[1].table.name
    return ""


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # head, with PRAGMA foreign_keys=ON
    yield eng
    eng.dispose()


@pytest.fixture
def factory(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(Source(id="s1", folder="C:/flights/a", site="A"))
        s.flush()
        s.add(Image(id="i1", path="images/a.jpg", width=100, height=100, source_id="s1"))
        s.flush()
        s.add(
            Box(id="b1", image_id="i1", class_id="t1", x=0.5, y=0.5, w=0.1, h=0.1, provenance_kind="person")
        )
        s.add(AssetModel(id="m1", name="Stack", status="ready"))
        s.commit()
    return factory


def test_the_chain_has_one_head_and_0016_is_on_it():
    script = ScriptDirectory.from_config(alembic_config())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}


def test_0016_sits_on_the_asset_models_revision():
    assert _module().down_revision == "0015"


def test_0016_freezes_its_checks_instead_of_importing_the_model():
    from app.db import models

    module = _module()
    assert "from app.db.models" not in PATH.read_text(encoding="utf-8")
    assert module.ANCHOR_CHECK == models.ANCHOR_CHECK
    assert module.FINDING_PLACEMENT_CHECK == models.FINDING_PLACEMENT_CHECK
    assert module.IMAGE_REVIEW_STATUS_CHECK == models.IMAGE_REVIEW_STATUS_CHECK
    assert module.SIGHTING_PLACEMENT_CHECK == models.SIGHTING_PLACEMENT_CHECK


@pytest.mark.parametrize("revision", ["0015", "0014"])
def test_a_project_with_findings_upgrades_and_keeps_every_child_row(tmp_path, revision):
    """0014 too: 0015 runs in the same open and leaves a transaction open, which 0016 must commit
    before PRAGMA foreign_keys can take effect."""
    folder = _at(tmp_path / "old", revision)
    open_project_db(folder).dispose()
    assert _children(folder) == KEPT


def test_foreign_keys_are_on_again_after_the_upgrade(tmp_path):
    folder = _at(tmp_path / "old", "0015")
    eng = open_project_db(folder)
    try:
        with eng.connect() as c:
            assert c.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            assert c.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    finally:
        eng.dispose()


def test_an_interrupted_rebuild_recovers_on_the_next_open(tmp_path):
    folder = _at(tmp_path / "old", "0015")
    con = sqlite3.connect(folder / "project.db")
    con.execute("CREATE TABLE _alembic_tmp_finding (id VARCHAR(36))")  # what a crash mid-rebuild leaves
    con.commit()
    con.close()
    open_project_db(folder).dispose()
    assert _children(folder) == KEPT


def test_the_upgrade_keeps_the_existing_finding_indexes_and_adds_two(engine):
    with engine.connect() as c:
        names = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(finding)")}
        fks = {(r[3], r[2]) for r in c.exec_driver_sql("PRAGMA foreign_key_list(finding)")}
    assert {
        "ux_finding_number",
        "ux_finding_annotation",
        "ix_finding_status_severity_number",
        "ix_finding_type",
        "ix_finding_data",
        "ix_finding_updated",
        "ix_finding_image",
        "ix_finding_location",
        "ix_finding_asset",
        "ix_finding_asset_zone",
    } <= names
    assert fks == {("annotation_id", "box"), ("asset_model_id", "asset_model")}


@pytest.mark.parametrize("table", sorted({**NEW_TABLES, **CHANGED}))
def test_every_model_column_exists(engine, table):
    model = {**NEW_TABLES, **CHANGED}[table]
    with engine.connect() as c:
        have = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
    assert {col.name for col in model.__table__.columns} == have


def test_the_orm_and_the_migration_describe_the_same_tables(engine):
    with engine.connect() as conn:
        diffs = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    ours = {**NEW_TABLES, **CHANGED}
    structural = [d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and _table(d) in ours]
    assert structural == []


def _finding(**kw) -> Finding:
    base = dict(type_id="t1", status="open", note="", data_type="asset_model", data_id="m1")
    return Finding(**{**base, **kw})


ACCEPTED = {
    "image": dict(
        anchor_kind="image", image_id="i1", annotation_id="b1", data_type="image_set", data_id="s1"
    ),
    "map": dict(anchor_kind="map", map_id="g1", geometry={"type": "Point", "coordinates": [0, 0]}),
    "cloud": dict(anchor_kind="cloud", cloud_id="pc1", x=1.0, y=2.0, z=3.0),
    "asset placed": dict(
        anchor_kind="asset", asset_model_id="m1", asset_version=1, ax=1.0, ay=2.0, az=3.0, placement="patch"
    ),
    "asset unplaced": dict(anchor_kind="asset", asset_model_id="m1", placement="none"),
}


@pytest.mark.parametrize("name", sorted(ACCEPTED))
def test_every_anchor_kind_is_accepted(factory, name):
    with factory() as s:
        s.add(_finding(id="f", number=1, **ACCEPTED[name]))
        s.commit()
    with factory() as s:
        assert s.get(Finding, "f").sighting_count == 0


REJECTED = {
    "asset without a model": dict(anchor_kind="asset"),
    "asset with an image": dict(anchor_kind="asset", asset_model_id="m1", image_id="i1"),
    "asset with a cloud point": dict(anchor_kind="asset", asset_model_id="m1", x=1.0, y=1.0, z=1.0),
    "asset with half a point": dict(anchor_kind="asset", asset_model_id="m1", ax=1.0, ay=2.0),
    "image with a model": dict(anchor_kind="image", image_id="i1", annotation_id="b1", asset_model_id="m1"),
    "map with an asset point": dict(
        anchor_kind="map",
        map_id="g1",
        geometry={"type": "Point", "coordinates": [0, 0]},
        ax=1.0,
        ay=1.0,
        az=1.0,
    ),
    "cloud with a model": dict(anchor_kind="cloud", cloud_id="pc1", x=1.0, y=2.0, z=3.0, asset_model_id="m1"),
    "an unknown placement": dict(anchor_kind="asset", asset_model_id="m1", placement="sphere"),
    "an unknown kind": dict(anchor_kind="drawing", asset_model_id="m1"),
}


@pytest.mark.parametrize("name", sorted(REJECTED))
def test_every_mixed_state_is_rejected(factory, name):
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_finding(id="f", number=1, **REJECTED[name]))
        s.commit()


def test_a_finding_cannot_point_at_a_missing_model(factory):
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_finding(id="f", number=1, anchor_kind="asset", asset_model_id="nope"))
        s.commit()


def test_new_tables_take_their_defaults_and_checks(factory):
    with factory() as s:
        s.add(_finding(id="f", number=1, anchor_kind="asset", asset_model_id="m1"))
        s.flush()
        s.add(
            FindingSighting(id="sg", finding_id="f", asset_model_id="m1", image_id="i1", annotation_id="b1")
        )
        s.add(ImageReview(image_id="i1", status="uncertain"))
        s.add(
            ImagePose(
                asset_model_id="m1",
                image_id="i1",
                position=[1, 2, 3],
                target=[0, 1, 0],
                up=[0, 1, 0],
                hfov_deg=70.0,
                vfov_deg=55.0,
                source="kit",
            )
        )
        s.commit()
    with factory() as s:
        sighting, review = s.get(FindingSighting, "sg"), s.get(ImageReview, "i1")
        assert (sighting.placement, sighting.created_at is not None) == ("pending", True)
        assert (review.note, review.coverage, review.updated_at is not None) == ("", None, True)
        assert s.get(ImagePose, ("m1", "i1")).position == [1, 2, 3]
    with factory() as s, pytest.raises(IntegrityError):
        s.add(ImageReview(image_id="i1", status="maybe"))
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.add(
            FindingSighting(id="sg2", finding_id="f", asset_model_id="m1", image_id="i1", annotation_id="b1")
        )  # one per box
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.execute(FindingSighting.__table__.update().values(placement="sphere"))
        s.commit()


def test_deleting_a_model_cascades_its_poses_and_deleting_a_finding_its_sightings(factory):
    with factory() as s:
        s.add(AssetModel(id="m2", name="Tank", status="ready"))
        s.add(_finding(id="f", number=1, anchor_kind="asset", asset_model_id="m1"))
        s.flush()
        s.add(
            FindingSighting(id="sg", finding_id="f", asset_model_id="m1", image_id="i1", annotation_id="b1")
        )
        s.add(
            ImagePose(
                asset_model_id="m2",
                image_id="i1",
                position=[0, 0, 0],
                target=[1, 0, 0],
                up=[0, 1, 0],
                hfov_deg=70.0,
                vfov_deg=55.0,
                source="manual",
            )
        )
        s.commit()
    with factory() as s:
        s.delete(s.get(AssetModel, "m2"))
        s.delete(s.get(Finding, "f"))
        s.commit()
    with factory() as s:
        assert s.query(ImagePose).count() == 0 and s.query(FindingSighting).count() == 0


def test_a_sighting_may_be_ungrouped_and_holds_its_model(factory):
    """A sighting exists before grouping (`finding_id` null), and RESTRICT keeps its model from
    being deleted under it (J4 plan, Index notes N1)."""
    with factory() as s:
        s.add(FindingSighting(id="sg", asset_model_id="m1", image_id="i1", annotation_id="b1"))
        s.commit()
    with factory() as s:
        assert s.get(FindingSighting, "sg").finding_id is None
    with factory() as s, pytest.raises(IntegrityError):
        s.delete(s.get(AssetModel, "m1"))
        s.commit()


def test_imported_is_a_version_kind(factory):
    with factory() as s:
        s.add(
            AssetModelVersion(id="v", model_id="m1", version=1, spec={}, kind="imported", glb_status="ready")
        )
        s.commit()
    with factory() as s:
        assert AssetModelVersionOut.of(s.get(AssetModelVersion, "v")).kind == "imported"


def test_an_asset_model_keeps_its_frame_and_review(factory):
    frame = {"height_m": 74.4, "north_offset_deg": 0.0, "silhouette": [[0, 5.0]], "levels": [], "presets": []}
    with factory() as s:
        s.get(AssetModel, "m1").frame = frame
        s.commit()
    with factory() as s:
        row = s.get(AssetModel, "m1")
        assert (row.frame, row.review) == (frame, None)


def test_0016_downgrades_to_0015_and_keeps_the_older_findings(tmp_path):
    folder = _at(tmp_path / "old", "0015")
    open_project_db(folder).dispose()
    command.downgrade(alembic_config(folder), "0015")
    assert _children(folder) == KEPT
    con = sqlite3.connect(folder / "project.db")
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        finding_cols = {r[1] for r in con.execute("PRAGMA table_info(finding)")}
        model_cols = {r[1] for r in con.execute("PRAGMA table_info(asset_model)")}
    finally:
        con.close()
    assert not set(NEW_TABLES) & tables
    assert not {"asset_model_id", "ax", "zone", "sighting_count"} & finding_cols
    assert not {"frame", "review"} & model_cols
```

- [ ] **Step 2: Run it to see it fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_migration_0016.py -q`

Expected: collection error, `ImportError: cannot import name 'FindingSighting' from 'app.db.models'`.

- [ ] **Step 3: Extend the ORM**

In `backend/app/db/models.py`, replace `ANCHOR_CHECK` (line 678) with the four-branch text, and add the placement CHECK under it:

```python
ANCHOR_CHECK = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'asset' AND asset_model_id IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL AND geometry IS NULL"
    " AND cloud_id IS NULL AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND ((ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (ax IS NOT NULL AND ay IS NOT NULL AND az IS NOT NULL)))"
)
FINDING_PLACEMENT_CHECK = "placement IS NULL OR placement IN ('point', 'patch', 'none')"
```

The three older branches gain `asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL`, so a mixed image, map or cloud row is rejected. Every existing row passes, because the new columns are null.

In `class Finding`, after `closed_at`, add:

```python
    # The asset anchor (spec 2026-10-02-asset-findings-design §5.5, migration 0016). The point and
    # normal come from the representative sighting; the derived fields are written only by the
    # placement and grouping jobs. No ON DELETE on the model: deleting a model that findings point
    # at is refused (409 `has_findings`) before it can reach the foreign key.
    asset_model_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("asset_model.id", name="fk_finding_asset_model"), nullable=True
    )
    asset_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ax: Mapped[float | None] = mapped_column(Float, nullable=True)
    ay: Mapped[float | None] = mapped_column(Float, nullable=True)
    az: Mapped[float | None] = mapped_column(Float, nullable=True)
    an_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    an_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    an_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    placement: Mapped[str | None] = mapped_column(String, nullable=True)  # point | patch | none
    height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    bearing_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    side: Mapped[str | None] = mapped_column(String, nullable=True)
    zone: Mapped[str | None] = mapped_column(String, nullable=True)
    component: Mapped[str | None] = mapped_column(String, nullable=True)
    sighting_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
```

Then, in `Finding`:
1. Change the `anchor_kind` comment to `# image | map | cloud | asset`.
2. Change the `data_type` comment to `# image_set | map | point_cloud | asset_model`.
3. In `__table_args__`, add `CheckConstraint(FINDING_PLACEMENT_CHECK, name="ck_finding_placement"),` after `ck_finding_status`.
4. Add these two lines after `ix_finding_location`:

```python
        Index("ix_finding_asset", "anchor_kind", "asset_model_id"),
        Index("ix_finding_asset_zone", "asset_model_id", "zone"),
```

In `class AssetModel`, before `__table_args__`:

```python
    # Asset findings (spec 2026-10-02-asset-findings-design §5.1, migration 0016). Validated by
    # app.asset_review.frame.Frame and app.asset_review.profiles.ReviewConfig, stored as their dumps.
    frame: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    review: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
```

In `class AssetModelVersion`, change the `kind` comment to `# agent | manual | draft | imported (no CHECK)`.

After `class AssetModelRun` (before `class MapMeasurement`), add:

```python
class ImagePose(Base):
    """Where one photo was taken from, in one asset model's frame (asset findings spec §5.3).
    Metres, Y up, X plant north, Z plant east. `source` is kit | exif_gimbal | exif_axis_aim |
    manual (later metashape, pix4d, fitted): no CHECK, so a later source needs no rebuild."""

    __tablename__ = "image_pose"
    asset_model_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("asset_model.id", ondelete="CASCADE"), primary_key=True
    )
    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("image.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[list] = mapped_column(JSON)  # [x, y, z]
    target: Mapped[list] = mapped_column(JSON)  # [x, y, z]
    up: Mapped[list] = mapped_column(JSON)  # [x, y, z]
    hfov_deg: Mapped[float] = mapped_column(Float)
    vfov_deg: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    sequence: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        Index("ix_image_pose_image", "image_id"),
        Index("ix_image_pose_sequence", "asset_model_id", "sequence", "image_id"),
    )


IMAGE_REVIEW_STATUSES = ("finding", "none", "uncertain", "not_assessed")
IMAGE_REVIEW_STATUS_CHECK = "status IN ('finding', 'none', 'uncertain', 'not_assessed')"


class ImageReview(Base):
    """A photo's review outcome (asset findings spec §5.4, decision A5). Written only through
    `app.asset_review.review_status.set_status`, which keeps `image.marked_empty` in step."""

    __tablename__ = "image_review"
    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("image.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    coverage: Mapped[float | None] = mapped_column(Float, nullable=True)
    uncertain_coverage: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint(IMAGE_REVIEW_STATUS_CHECK, name="ck_image_review_status"),
        Index("ix_image_review_status", "status", "image_id"),
    )


SIGHTING_PLACEMENT_CHECK = "placement IN ('point', 'patch', 'none', 'pending')"


class FindingSighting(Base):
    """One sighting on an asset model: an annotation on one photo (asset findings spec §5.6).
    The box row stays the geometry. `finding_id` is null while the sighting is ungrouped (between
    import or creation and the `asset_group` job). No ON DELETE on `image_id` and `annotation_id`: a
    box or image delete that skips `findings/annotations.py` fails loudly instead of leaving a
    finding wrong. RESTRICT on `asset_model_id`: a model with sightings is never deleted."""

    __tablename__ = "finding_sighting"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    finding_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("finding.id", ondelete="CASCADE"), nullable=True
    )
    asset_model_id: Mapped[str] = mapped_column(String(36), ForeignKey("asset_model.id", ondelete="RESTRICT"))
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id"))
    annotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("box.id"))
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    group_tag: Mapped[str | None] = mapped_column(String, nullable=True)
    placement: Mapped[str] = mapped_column(String, default="pending", server_default="pending")
    cx: Mapped[float | None] = mapped_column(Float, nullable=True)
    cy: Mapped[float | None] = mapped_column(Float, nullable=True)
    cz: Mapped[float | None] = mapped_column(Float, nullable=True)
    nx: Mapped[float | None] = mapped_column(Float, nullable=True)
    ny: Mapped[float | None] = mapped_column(Float, nullable=True)
    nz: Mapped[float | None] = mapped_column(Float, nullable=True)
    part: Mapped[str | None] = mapped_column(String, nullable=True)
    coverage: Mapped[float | None] = mapped_column(Float, nullable=True)
    patch_path: Mapped[str | None] = mapped_column(String, nullable=True)
    placed_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (
        CheckConstraint(SIGHTING_PLACEMENT_CHECK, name="ck_finding_sighting_placement"),
        Index("ux_finding_sighting_annotation", "annotation_id", unique=True),
        Index("ix_finding_sighting_finding", "finding_id", "created_at"),
        Index("ix_finding_sighting_image", "image_id"),
        Index("ix_finding_sighting_model", "asset_model_id", "finding_id"),
    )
```

- [ ] **Step 4: Write the migration**

Create `backend/app/db/migrations/versions/0016_asset_findings.py`:

```python
"""asset findings: asset frame and review, the asset anchor, poses, photo review, sightings

The one project schema change of the asset findings phase (spec 2026-10-02-asset-findings-design
sections 5.1 to 5.6).

- `asset_model` gains `frame` and `review` by plain `ALTER TABLE ... ADD COLUMN`. A batch rebuild of
  `asset_model` would drop the table, and with `foreign_keys=ON` that drop cascades every version
  and run away.
- `finding` is rebuilt in batch mode, because SQLite cannot alter a CHECK: the anchor CHECK gains
  its `asset` branch, plus a placement CHECK, the asset columns, a foreign key to `asset_model` and
  two indexes. The rebuild runs with foreign keys switched off. With them on, SQLite's
  `DROP TABLE finding` runs an implicit `DELETE FROM finding` first, which cascades every comment,
  attachment and cloud view away and nulls `cloud_measurement.finding_id` (ADR
  2026-10-03-gotcha-sqlite-rebuild-cascades-children).
- `image_pose`, `image_review` and `finding_sighting` are new tables.

Copy-first: `open_project_db` backs the database up before this revision runs
(`app.migration.backup.REBUILD_GUARDS`). Every step is safe to meet again, so an open interrupted
half way recovers on the next open instead of failing forever. No row is rewritten.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-03 00:00:00.000000
"""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"  # main's project head at merge time; re-check `alembic heads` before merging
branch_labels = None
depends_on = None

# Frozen here (0010's text, for the downgrade), so a later model edit cannot rewrite history.
ANCHOR_CHECK_0010 = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL)"
)

# Frozen here (the text of app.db.models.ANCHOR_CHECK on 2026-10-03).
ANCHOR_CHECK = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'asset' AND asset_model_id IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL AND geometry IS NULL"
    " AND cloud_id IS NULL AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND ((ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (ax IS NOT NULL AND ay IS NOT NULL AND az IS NOT NULL)))"
)
FINDING_PLACEMENT_CHECK = "placement IS NULL OR placement IN ('point', 'patch', 'none')"
IMAGE_REVIEW_STATUS_CHECK = "status IN ('finding', 'none', 'uncertain', 'not_assessed')"
SIGHTING_PLACEMENT_CHECK = "placement IN ('point', 'patch', 'none', 'pending')"

# (name, type) of the nullable asset columns on `finding` (spec §5.5).
FINDING_COLUMNS = (
    ("asset_model_id", sa.String(36)),
    ("asset_version", sa.Integer()),
    ("ax", sa.Float()),
    ("ay", sa.Float()),
    ("az", sa.Float()),
    ("an_x", sa.Float()),
    ("an_y", sa.Float()),
    ("an_z", sa.Float()),
    ("placement", sa.String()),
    ("height_m", sa.Float()),
    ("bearing_deg", sa.Float()),
    ("side", sa.String()),
    ("zone", sa.String()),
    ("component", sa.String()),
)
NEW_TABLES = ("finding_sighting", "image_review", "image_pose")


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


@contextmanager
def _foreign_keys_off() -> Iterator[None]:
    """Switch foreign keys off for a table rebuild, and back on after it.

    `PRAGMA foreign_keys` is a no-op inside a transaction, and an earlier revision of the same
    upgrade may have left one open (its `alembic_version` UPDATE), so it is committed first. The
    switch is read back: a rebuild with foreign keys still on would delete the children, so it
    stops instead. On success the rebuild is committed before foreign keys are switched back on;
    on failure it is rolled back (the next open meets a clean `finding` again)."""
    raw = op.get_bind().connection.driver_connection
    if raw.in_transaction:
        raw.commit()
    raw.execute("PRAGMA foreign_keys=OFF")
    if raw.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
        raise RuntimeError("Revision 0016 could not switch foreign keys off; the finding table is unchanged.")
    try:
        yield
    except BaseException:
        if raw.in_transaction:
            raw.rollback()
        raw.execute("PRAGMA foreign_keys=ON")
        raise
    if raw.in_transaction:
        raw.commit()
    raw.execute("PRAGMA foreign_keys=ON")


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_finding")  # left by an interrupted rebuild

    have = _columns("asset_model")
    for name in ("frame", "review"):
        if name not in have:
            op.add_column("asset_model", sa.Column(name, sa.JSON(), nullable=True))

    if "asset_model_id" not in _columns("finding"):
        with _foreign_keys_off():
            with op.batch_alter_table("finding", recreate="always") as b:
                for name, type_ in FINDING_COLUMNS:
                    b.add_column(sa.Column(name, type_, nullable=True))
                b.add_column(sa.Column("sighting_count", sa.Integer(), nullable=False, server_default="0"))
                b.create_foreign_key("fk_finding_asset_model", "asset_model", ["asset_model_id"], ["id"])
                b.drop_constraint("ck_finding_anchor", type_="check")
                b.create_check_constraint("ck_finding_anchor", ANCHOR_CHECK)
                b.create_check_constraint("ck_finding_placement", FINDING_PLACEMENT_CHECK)
                b.create_index("ix_finding_asset", ["anchor_kind", "asset_model_id"])
                b.create_index("ix_finding_asset_zone", ["asset_model_id", "zone"])

    op.create_table(
        "image_pose",
        sa.Column(
            "asset_model_id",
            sa.String(36),
            sa.ForeignKey("asset_model.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("position", sa.JSON(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=False),
        sa.Column("up", sa.JSON(), nullable=False),
        sa.Column("hfov_deg", sa.Float(), nullable=False),
        sa.Column("vfov_deg", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("sequence", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        if_not_exists=True,
    )
    op.create_index("ix_image_pose_image", "image_pose", ["image_id"], if_not_exists=True)
    op.create_index(
        "ix_image_pose_sequence", "image_pose", ["asset_model_id", "sequence", "image_id"], if_not_exists=True
    )
    op.create_table(
        "image_review",
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("uncertain_coverage", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(IMAGE_REVIEW_STATUS_CHECK, name="ck_image_review_status"),
        if_not_exists=True,
    )
    op.create_index("ix_image_review_status", "image_review", ["status", "image_id"], if_not_exists=True)
    op.create_table(
        "finding_sighting",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "asset_model_id",
            sa.String(36),
            sa.ForeignKey("asset_model.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id"), nullable=False),
        sa.Column("annotation_id", sa.String(36), sa.ForeignKey("box.id"), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=True),
        sa.Column("group_tag", sa.String(), nullable=True),
        sa.Column("placement", sa.String(), nullable=False, server_default="pending"),
        sa.Column("cx", sa.Float(), nullable=True),
        sa.Column("cy", sa.Float(), nullable=True),
        sa.Column("cz", sa.Float(), nullable=True),
        sa.Column("nx", sa.Float(), nullable=True),
        sa.Column("ny", sa.Float(), nullable=True),
        sa.Column("nz", sa.Float(), nullable=True),
        sa.Column("part", sa.String(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("patch_path", sa.String(), nullable=True),
        sa.Column("placed_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(SIGHTING_PLACEMENT_CHECK, name="ck_finding_sighting_placement"),
        if_not_exists=True,
    )
    op.create_index(
        "ux_finding_sighting_annotation",
        "finding_sighting",
        ["annotation_id"],
        unique=True,
        if_not_exists=True,
    )
    op.create_index(
        "ix_finding_sighting_finding", "finding_sighting", ["finding_id", "created_at"], if_not_exists=True
    )
    op.create_index("ix_finding_sighting_image", "finding_sighting", ["image_id"], if_not_exists=True)
    op.create_index(
        "ix_finding_sighting_model", "finding_sighting", ["asset_model_id", "finding_id"], if_not_exists=True
    )


def downgrade() -> None:
    for table in NEW_TABLES:
        op.drop_table(table)
    op.execute("DELETE FROM finding WHERE anchor_kind = 'asset'")  # foreign keys on: children cascade
    with _foreign_keys_off():
        with op.batch_alter_table("finding", recreate="always") as b:
            b.drop_index("ix_finding_asset_zone")
            b.drop_index("ix_finding_asset")
            b.drop_constraint("ck_finding_placement", type_="check")
            b.drop_constraint("ck_finding_anchor", type_="check")
            b.create_check_constraint("ck_finding_anchor", ANCHOR_CHECK_0010)
            b.drop_constraint("fk_finding_asset_model", type_="foreignkey")
            b.drop_column("sighting_count")
            for name, _ in reversed(FINDING_COLUMNS):
                b.drop_column(name)
    op.drop_column("asset_model", "review")
    op.drop_column("asset_model", "frame")
```

Why each piece is there:
- **`_foreign_keys_off()`** is the reason the parametrized `0014` case passes. Upgrading from 0014, revision 0015's `alembic_version` UPDATE has opened a transaction, and inside one `PRAGMA foreign_keys` is silently a no-op. The guard commits that transaction first, reads the pragma back, and refuses to rebuild while it is still on.
- **The `if "asset_model_id" not in _columns("finding")` check, `DROP TABLE IF EXISTS _alembic_tmp_finding` and `if_not_exists=True`** make the revision safe to meet again. pysqlite autocommits DDL, so a crash can leave the temp table or some new tables behind while `alembic_version` still says 0015. Catalogue `0003`'s `_prepare_rebuild` set this pattern.
- **`op.add_column` on `asset_model`, never batch.** A rebuild of `asset_model` would cascade-delete its versions and runs. It is the same trap.

- [ ] **Step 5: Move the two tests that pinned the old head and the old CHECK**

In `backend/tests/test_migration_0010.py`, replace `test_0010_freezes_its_anchor_check_instead_of_importing_the_model` (the last test in the file) with:

```python
def test_0010_freezes_its_anchor_check_instead_of_importing_the_model():
    """A later model edit must not rewrite 0010's history: the revision carries its own copy of the
    CHECK text. Revision 0016 widened the model's CHECK and froze 0010's text for its downgrade; the
    two frozen copies agree."""
    import importlib.util

    def load(name: str):
        path = MIGRATIONS / "versions" / name
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return path, module

    path, module = load("0010_foundation.py")
    assert "from app.db.models" not in path.read_text(encoding="utf-8")
    _, later = load("0016_asset_findings.py")
    assert module.ANCHOR_CHECK == later.ANCHOR_CHECK_0010
```

In `backend/tests/test_migration_0015.py`, replace `test_single_head_is_0015` with:

```python
def test_the_chain_has_one_head_and_0015_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
```

- [ ] **Step 6: Run the tests to see them pass**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_migration_0016.py -q`

Expected: `35 passed`.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_migration_0010.py tests/test_migration_0011.py tests/test_migration_0012.py tests/test_migration_0013.py tests/test_migration_0014.py tests/test_migration_0015.py tests/test_migration_backup.py -q`

Expected: all pass. `test_0011_downgrades_to_0010` now runs 0016's downgrade on a plain Alembic engine, and passes.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m alembic -c app/db/migrations/alembic.ini heads`

Expected: `0016 (head)`. If `main` gained another project revision since this plan was written, rebase, set `down_revision` to the new head, and rerun.

- [ ] **Step 7: Record the trap as an ADR**

Create `vault/decisions/2026-10-03-gotcha-sqlite-rebuild-cascades-children.md`:

```markdown
---
type: adr
date: 2026-10-03
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: an Alembic batch rebuild of a parent table cascades its children away

## Context

SQLite cannot alter a CHECK or a foreign key, so Alembic's batch mode rebuilds the table: it
creates `_alembic_tmp_<t>`, copies the rows, runs `DROP TABLE <t>` and renames the copy.

`open_project_db` sets `PRAGMA foreign_keys=ON` on every connection, including the one Alembic
migrates with. With foreign keys on, SQLite's `DROP TABLE` first runs an implicit `DELETE FROM`,
which fires every `ON DELETE CASCADE` and `SET NULL` child. Rebuilding `finding` that way deletes
every comment, attachment and cloud view, unlinks every cloud measurement, and raises no error.

Found while planning migration 0016 (asset findings D1), by running the batch rebuild on a scratch
0015 project: the comment count went from 1 to 0.

## Decision

- A revision that rebuilds a table other rows reference does it inside a guard that:
  1. commits any open transaction (the pragma is a no-op inside one);
  2. runs `PRAGMA foreign_keys=OFF`;
  3. reads the pragma back, and refuses to continue if it is still on;
  4. rebuilds;
  5. commits;
  6. switches foreign keys back on.

  Template: `_foreign_keys_off` in `backend/app/db/migrations/versions/0016_asset_findings.py`.
- Its test seeds the children and upgrades through `open_project_db`, never only through
  `command.upgrade`, which runs with foreign keys off and hides the loss. It also upgrades from two
  revisions back, which exercises the open-transaction path.
- A revision that only adds a column uses plain `op.add_column` (`ALTER TABLE ADD COLUMN`), never
  batch mode.
- The revision is listed in `app.migration.backup.REBUILD_GUARDS`, so the project is copied before
  it runs.

## Rationale

The loss is silent: the upgrade succeeds and the parent rows are intact; only the children are
gone. The migration tests before 0016 built old databases with plain Alembic (foreign keys off), so
a test in their style would not have caught it.

## Consequences

- Positive: 0016 keeps every child row, and the guard is reusable.
- Negative: the guard commits mid-upgrade. Each revision is still stamped in order, and 0016 is
  written to be met again after an interruption.
```

- [ ] **Step 8: Lint and commit**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check . ; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .`

Expected: `All checks passed!`, and no file to reformat.

```
git add backend/app/db/migrations/versions/0016_asset_findings.py backend/app/db/models.py backend/tests/test_migration_0016.py backend/tests/test_migration_0010.py backend/tests/test_migration_0015.py vault/decisions/2026-10-03-gotcha-sqlite-rebuild-cascades-children.md
git commit -m "feat(db): migration 0016 for asset findings: asset anchor, poses, photo review, sightings" -m "Rebuilds finding with foreign keys off so comments, attachments and cloud views survive." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Copy the project before a rebuild revision

**Files:**
- Modify: `backend/app/migration/backup.py`:
  - new constants after `BACKUP_LABEL`;
  - `needs_rebuild_backup` after `needs_backup`;
  - `_target` and `backup_project_db` take a label.
- Modify: `backend/app/db/session.py:47-58` (`open_project_db`)
- Modify: `backend/tests/test_migration_backup.py` (an import, and three tests at the end)

**Interfaces:**
- Consumes: revision `0016` (Task 1).
- Produces:
  - `app.migration.backup.FOUNDATION_REVISION = "0010"`
  - `REBUILD_GUARDS: tuple[str, ...] = ("0016",)`
  - `needs_rebuild_backup(current: str | None, script) -> str | None`
  - `backup_project_db(folder: Path, now: datetime | None = None, *, label: str = BACKUP_LABEL) -> Path`. The default keeps every existing caller and test unchanged.
- Behaviour:
  - One open takes at most one copy, and the foundation copy (`v1`) wins when both apply.
  - A database at 0010 to 0015 gets `project.db.r0016-<stamp>.bak`.
  - If that copy fails, the upgrade does not run (`BackupFailed`, as with the foundation copy).
  - A database older than 0010 is not affected: it has no `finding` table yet. This also keeps the many migration tests that patch `BACKUP_BEFORE` to `"0009"` unaffected.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_migration_backup.py`, add `needs_rebuild_backup,` to the `from app.migration.backup import (...)` list, after `needs_backup,`. Then append:

```python
def test_a_rebuild_revision_asks_for_its_own_copy():
    script = project_script()
    assert needs_rebuild_backup("0015", script) == "0016"
    assert needs_rebuild_backup("0010", script) == "0016"
    assert needs_rebuild_backup("0009", script) is None  # the foundation copy covers it; no findings yet
    assert needs_rebuild_backup(None, script) is None
    assert needs_rebuild_backup(head_revision(), script) is None
    assert needs_rebuild_backup("not-a-revision", script) is None


def test_opening_a_0015_project_takes_an_r0016_copy_first(tmp_path):
    folder = at_revision(tmp_path / "p", "0015")
    open_project_db(folder).dispose()
    copy = latest_backup(folder)
    assert copy is not None and copy.name.startswith("project.db.r0016-") and copy.name.endswith(".bak")
    assert quick_check(copy) == "ok" and revision_of(copy) == "0015"
    open_project_db(folder).dispose()  # at head now: no second copy
    assert [p.name for p in (folder / "backups").iterdir()] == [copy.name]


def test_a_failed_rebuild_copy_leaves_the_database_at_0015(tmp_path):
    folder = at_revision(tmp_path / "p", "0015")
    (folder / "backups").write_text("a file where the folder should be", "utf-8")
    with pytest.raises(BackupFailed):
        open_project_db(folder)
    assert revision_of(folder / "project.db") == "0015"
```

- [ ] **Step 2: Run them to see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_migration_backup.py -q`

Expected: collection error, `ImportError: cannot import name 'needs_rebuild_backup'`.

- [ ] **Step 3: Implement the guard**

In `backend/app/migration/backup.py`, after `BACKUP_LABEL = "v1"  # the schema generation the copy holds`:

```python
# The foundation revision itself, never patched by tests (they patch BACKUP_BEFORE): a database
# older than it has no `finding` table yet, and the foundation copy is the one that open takes.
FOUNDATION_REVISION = "0010"
# Revisions that rebuild a table holding the operator's records (0016 rebuilds `finding`). Opening a
# project that will apply one takes a copy labelled `r<revision>` first (asset findings spec §5.5).
REBUILD_GUARDS = ("0016",)
```

After `needs_backup`:

```python
def needs_rebuild_backup(current: str | None, script) -> str | None:
    """The first revision of REBUILD_GUARDS that upgrading from `current` will apply, else None.

    None for a new database, for one older than the foundation (its upgrade takes the foundation
    copy, and it has no findings to lose), and for a revision this chain does not know (a newer
    build's database: Alembic reports that itself)."""
    if current is None:
        return None
    try:
        pending = {rev.revision for rev in script.walk_revisions(base=current, head="heads")}
    except (CommandError, ResolutionError):
        return None
    pending.discard(current)
    if FOUNDATION_REVISION in pending:
        return None
    return next((rev for rev in REBUILD_GUARDS if rev in pending), None)
```

Replace `_target`:

```python
def _target(folder: Path, now: datetime, label: str) -> Path:
    stem = f"{DB_NAME}.{label}-{now.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    path, n = backups_dir(folder) / f"{stem}.bak", 2
    while path.exists() or path.with_name(path.name + ".partial").exists():
        path, n = backups_dir(folder) / f"{stem}-{n}.bak", n + 1
    return path
```

Replace the signature and docstring of `backup_project_db`:

```python
def backup_project_db(folder: Path, now: datetime | None = None, *, label: str = BACKUP_LABEL) -> Path:
    """Write and check `<folder>/backups/project.db.<label>-<UTC stamp>.bak`; raise BackupFailed.
    `label` is `v1` for the foundation copy and `r<revision>` for a rebuild guard's copy."""
```

Inside it, change `target = _target(folder, now or datetime.now(UTC))` to `target = _target(folder, now or datetime.now(UTC), label)`. The `_NAME` pattern already accepts any `[A-Za-z0-9]+` label, so `latest_backup` and `backup_path` see the new copies without change.

In `backend/app/db/session.py`, change the import to `from app.migration.backup import backup_project_db, needs_backup, needs_rebuild_backup`. Change the docstring and the copy step of `open_project_db` to:

```python
    """Create the engine for a project folder and bring its schema to head.

    Copy-first (foundation spec §11.2): when the upgrade will apply the foundation revision, the
    database is backed up before Alembic runs, and a failed backup raises `BackupFailed` with the
    database untouched. A later revision that rebuilds a table of records (`REBUILD_GUARDS`, asset
    findings spec §5.5) takes its own copy the same way; one open takes at most one copy. Every
    path that opens a project comes through here.
    """
    folder = Path(folder)
    current, script = current_revision(folder), project_script()
    if needs_backup(current, script):
        backup_project_db(folder)
    elif (guard := needs_rebuild_backup(current, script)) is not None:
        backup_project_db(folder, label=f"r{guard}")
```

The rest of the function is unchanged.

- [ ] **Step 4: Run them to see them pass, with the migration suites that patch `BACKUP_BEFORE`**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_migration_backup.py tests/test_migration_dry_run.py tests/test_migration_job.py tests/test_migration_projects_api.py tests/test_migration_gate.py tests/test_migration_end_to_end.py tests/test_migration_0016.py -q`

Expected: all pass. `test_a_new_project_and_a_current_one_take_no_backup` still sees no copy, because its "current" project is at 0009 with the guard patched there.

- [ ] **Step 5: Commit**

```
git add backend/app/migration/backup.py backend/app/db/session.py backend/tests/test_migration_backup.py
git commit -m "feat(migration): copy the project before a table-rebuild revision (r0016)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Refuse to delete an asset model that findings or sightings point at

**Files:**
- Modify: `backend/app/asset_models/router.py`:
  - the imports at lines 9 and 28;
  - a `_placed_on` helper above `delete_asset_model`;
  - `delete_asset_model` itself (line 81).
- Modify: `backend/tests/test_asset_models_api.py` (two tests at the end)

**Interfaces:**
- Consumes: `Finding.asset_model_id` and `FindingSighting.asset_model_id` / `finding_id` (Task 1).
- Produces: `DELETE /asset-models/{assetModelId}` answers 409 when either of these holds the model:
  - any finding, of any status, with `asset_model_id` equal to the model;
  - any ungrouped sighting (`finding_id IS NULL`) with `asset_model_id` equal to the model.
  - A grouped sighting belongs to a finding on the same model, so the finding count covers it. The RESTRICT foreign key backs this up.

  The body is `{"error": {"code": "has_findings", "message": "<what> placed on this model. Delete them or move them to another model first.", "details": {"count": <findings + ungrouped sightings>}}}`. `<what>` reads, for example, "1 finding is", "3 findings and 1 ungrouped sighting are" or "2 ungrouped sightings are". The check runs before the `job_running` check. The details shape is C0's (`{count}`).

- [ ] **Step 1: Write the failing tests (Review Focus 4)**

Append to `backend/tests/test_asset_models_api.py`:

```python
def test_asset_model_delete_refused_with_findings(client, base, handle):
    """Review Focus 4: a model that findings point at is never deleted from under them, closed
    findings included; once the last one is gone the delete goes through."""
    from app.db.models import AssetModel, Finding

    m = create(client, base)
    with handle.session() as s:
        s.add(
            Finding(
                id="f-asset",
                number=901,
                type_id="t1",
                status="closed",
                anchor_kind="asset",
                asset_model_id=m["id"],
                data_type="asset_model",
                data_id=m["id"],
            )
        )
    r = client.delete(f"{base}/{m['id']}")
    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert (error["code"], error["details"]) == ("has_findings", {"count": 1})
    assert error["message"].startswith("1 finding is placed on this model.")
    with handle.session() as s:
        assert s.get(AssetModel, m["id"]) is not None
        s.delete(s.get(Finding, "f-asset"))
    assert client.delete(f"{base}/{m['id']}").status_code == 204


def test_asset_model_delete_refused_with_ungrouped_sightings(client, base, handle):
    """A sighting not yet grouped into a finding holds the model too (J4 plan, Index notes N5)."""
    from findings_helpers import insert_box

    from app.db.models import FindingSighting

    m = create(client, base)
    image_id, box_id = insert_box(handle, "t1")
    with handle.session() as s:
        s.add(FindingSighting(id="sg", asset_model_id=m["id"], image_id=image_id, annotation_id=box_id))
    r = client.delete(f"{base}/{m['id']}")
    assert r.status_code == 409, r.text
    error = r.json()["error"]
    assert (error["code"], error["details"]) == ("has_findings", {"count": 1})
    assert error["message"].startswith("1 ungrouped sighting is placed on this model.")
    with handle.session() as s:
        s.delete(s.get(FindingSighting, "sg"))
    assert client.delete(f"{base}/{m['id']}").status_code == 204
```

- [ ] **Step 2: Run them to see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_models_api.py::test_asset_model_delete_refused_with_findings tests/test_asset_models_api.py::test_asset_model_delete_refused_with_ungrouped_sightings -q`

Expected: FAIL. The delete reaches `s.delete(row)`, and the foreign keys (`fk_finding_asset_model`, then the sighting's RESTRICT) raise `IntegrityError`. The client sees a 500, not a 409.

- [ ] **Step 3: Implement**

In `backend/app/asset_models/router.py`:
- change `from sqlalchemy import select` to `from sqlalchemy import func, select`;
- change `from app.db.models import AssetModel, AssetModelVersion` to `from app.db.models import AssetModel, AssetModelVersion, Finding, FindingSighting`.

Add above `@router.delete(P + "/{assetModelId}", status_code=204)`:

```python
def _placed_on(findings: int, loose: int) -> str:
    """What holds the model, as the subject of the refusal: for example `1 finding is`."""
    parts = []
    if findings:
        parts.append("1 finding" if findings == 1 else f"{findings} findings")
    if loose:
        parts.append("1 ungrouped sighting" if loose == 1 else f"{loose} ungrouped sightings")
    return f"{' and '.join(parts)} {'is' if findings + loose == 1 else 'are'}"
```

In `delete_asset_model`, directly after `row = store.get_model(s, assetModelId)`, insert:

```python
        # Any finding, closed ones too, and any sighting not yet grouped: their pins, heights and
        # zones were computed on this model (asset findings plan, Review Focus 4). A grouped
        # sighting belongs to a finding on this same model, so the findings count covers it. The
        # foreign keys would refuse the delete as well, as a 500.
        held = s.scalar(
            select(func.count()).select_from(Finding).where(Finding.asset_model_id == assetModelId)
        )
        loose = s.scalar(
            select(func.count())
            .select_from(FindingSighting)
            .where(FindingSighting.asset_model_id == assetModelId, FindingSighting.finding_id.is_(None))
        )
        if held or loose:
            raise AppError(
                "has_findings",
                f"{_placed_on(held, loose)} placed on this model. Delete them or move them to another"
                " model first.",
                409,
                {"count": held + loose},
            )
```

- [ ] **Step 4: Run them to see them pass**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_models_api.py -q`

Expected: all pass, the existing delete tests included.

- [ ] **Step 5: Commit**

```
git add backend/app/asset_models/router.py backend/tests/test_asset_models_api.py
git commit -m "feat(asset-models): refuse delete with 409 has_findings while findings or sightings point at it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Finding answers read the asset columns

**Files:**
- Modify: `backend/app/findings/schemas.py`: `anchor_of`, the `FindingOut` comment, and `FindingOut.from_row`, all as C0 left them.
- Create: `backend/tests/test_findings_asset_fields.py`

**Interfaces:**
- Consumes: the `Finding` asset columns and `AssetModel.frame` (Task 1); C0's `FindingOut` fields.
- Produces:
  - `anchor_of(r)` for `anchor_kind == "asset"` returns `{"kind": "asset", "asset_model_id", "asset_version", "point": [ax, ay, az] | None, "normal": [an_x, an_y, an_z] | None}`. That is C0's `FindingAssetAnchor`.
  - `FindingOut.from_row` reads these columns: `asset_model_id`, `height_m`, `bearing_deg`, `side`, `zone`, `component` and `placement`.
  - `sighting_count` is the column for an asset finding and 1 for the other kinds.
  - `representative` stays `representative_of(r)`; J4 adds its asset branch.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_findings_asset_fields.py`:

```python
"""Finding output read from migration 0016's columns (asset findings spec §8): the asset anchor, the
asset fields and the sighting count. C0's `test_asset_findings_out.py` covers the older kinds;
`representative` for an asset finding is J4's."""

from app.db.models import AssetModel, Finding

API = "/api/v1"


def _asset_finding(handle, type_id: str) -> tuple[str, str]:
    """An asset model and one placed asset finding on it, as the grouping job writes it."""
    with handle.session() as s:
        model = AssetModel(name="Flare stack", status="ready")
        s.add(model)
        s.flush()
        finding = Finding(
            number=900,
            type_id=type_id,
            severity=2,
            anchor_kind="asset",
            asset_model_id=model.id,
            asset_version=1,
            ax=1.0,
            ay=42.5,
            az=-3.0,
            an_x=0.0,
            an_y=0.0,
            an_z=1.0,
            placement="patch",
            height_m=42.5,
            bearing_deg=90.0,
            side="E",
            zone="shaft",
            component="Shell",
            sighting_count=3,
            data_type="asset_model",
            data_id=model.id,
        )
        s.add(finding)
        s.flush()
        return finding.id, model.id


def test_an_asset_finding_returns_its_asset_fields(client, project_id, handle, crack):
    finding_id, model_id = _asset_finding(handle, crack["id"])
    detail = client.get(f"{API}/projects/{project_id}/findings/{finding_id}").json()
    page = client.get(f"{API}/projects/{project_id}/findings").json()
    assert [f["id"] for f in page["items"]] == [finding_id]
    for f in (detail, page["items"][0]):
        assert f["anchor"] == {
            "kind": "asset",
            "asset_model_id": model_id,
            "asset_version": 1,
            "point": [1.0, 42.5, -3.0],
            "normal": [0.0, 0.0, 1.0],
        }
        assert (f["asset_model_id"], f["height_m"], f["bearing_deg"]) == (model_id, 42.5, 90.0)
        assert (f["side"], f["zone"], f["component"], f["placement"]) == ("E", "shaft", "Shell", "patch")
        assert f["sighting_count"] == 3


def test_an_unplaced_asset_finding_has_no_point(client, project_id, handle, crack):
    finding_id, _ = _asset_finding(handle, crack["id"])
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        row.ax = row.ay = row.az = row.an_x = row.an_y = row.an_z = None
        row.placement, row.height_m, row.side, row.zone = "none", None, None, None
    f = client.get(f"{API}/projects/{project_id}/findings/{finding_id}").json()
    assert (f["anchor"]["point"], f["anchor"]["normal"], f["placement"]) == (None, None, "none")
    assert (f["height_m"], f["side"], f["zone"]) == (None, None, None)


def test_an_asset_model_answers_its_stored_frame(client, project_id, handle):
    m = client.post(f"{API}/projects/{project_id}/asset-models", json={"name": "Flare stack"}).json()
    frame = {"height_m": 74.4, "north_offset_deg": 0.0, "silhouette": [[0.0, 5.0]], "levels": []}
    with handle.session() as s:
        s.get(AssetModel, m["id"]).frame = frame
    got = client.get(f"{API}/projects/{project_id}/asset-models/{m['id']}").json()
    assert (got["frame"], got["review"]) == (frame, None)
```

The finding rows are written straight into the database, because creating asset findings over HTTP is J4's work.

- [ ] **Step 2: Run it to see it fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_findings_asset_fields.py -q`

Expected: 2 FAIL and 1 pass:
- `test_an_asset_finding_returns_its_asset_fields` fails: the anchor falls through to the cloud branch (`{"kind": "cloud", ...}`), and the asset fields read None.
- `test_an_unplaced_asset_finding_has_no_point` fails the same way.
- The frame test already passes: C0's `AssetModelOut` reads the new column through `from_attributes`.

- [ ] **Step 3: Implement**

In `backend/app/findings/schemas.py`, in `anchor_of`, after the `map` branch, add:

```python
    if r.anchor_kind == "asset":
        point = [r.ax, r.ay, r.az] if r.ax is not None else None
        normal = [r.an_x, r.an_y, r.an_z] if None not in (r.an_x, r.an_y, r.an_z) else None
        return {
            "kind": "asset",
            "asset_model_id": r.asset_model_id,
            "asset_version": r.asset_version,
            "point": point,
            "normal": normal,
        }
```

The ANCHOR_CHECK guarantees `ax`, `ay` and `az` are all set or all null.

In `FindingOut`, replace C0's comment above the new fields with:

```python
    # Asset findings (spec 2026-10-02-asset-findings §8): read from migration 0016's columns. An
    # image, map or cloud finding has them null and one implicit sighting (§4 A2).
```

In `FindingOut.from_row`, replace C0's placeholder lines:

```python
            asset_model_id=None,
            height_m=None,
            bearing_deg=None,
            side=None,
            zone=None,
            component=None,
            placement=None,
            sighting_count=1,
```

with:

```python
            asset_model_id=r.asset_model_id,
            height_m=r.height_m,
            bearing_deg=r.bearing_deg,
            side=r.side,
            zone=r.zone,
            component=r.component,
            placement=r.placement,
            sighting_count=r.sighting_count if r.anchor_kind == "asset" else 1,
```

Leave `representative=representative_of(r),` as it is.

- [ ] **Step 4: Run it to see it pass, with C0's answer tests and the contract**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_findings_asset_fields.py tests/test_asset_findings_out.py tests/test_findings_api.py tests/test_contract.py -q`

Expected: all pass (`test_findings_asset_fields.py`: 3 passed).

- [ ] **Step 5: Commit**

```
git add backend/app/findings/schemas.py backend/tests/test_findings_asset_fields.py
git commit -m "feat(findings): answer the asset anchor and fields from migration 0016's columns" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Photo review status API, with `marked_empty` kept in step

**Files:**
- Create: `backend/app/asset_review/effective.py`
- Create: `backend/app/asset_review/review_status.py`
- Create: `backend/app/asset_review/review_router.py`
- Modify: `backend/app/datasets/empties.py`:
  - the module docstring and the imports;
  - new `follow_review` and `apply_mark`;
  - `clear_mark_for_ground_truth`, `set_marked_empty` and `bulk_mark_empty`.
- Modify: `backend/app/api.py` (route the new router above `"app.asset_review.stubs"`)
- Modify: `backend/app/asset_review/stubs.py` (empty `D1_STUBS`)
- Create: `backend/tests/test_image_review.py`

**Interfaces:**
- Consumes: `ImageReview` and `IMAGE_REVIEW_STATUSES` (Task 1).
- Produces:
  - `app.asset_review.review_status.set_status(s: Session, image_id: str, status: str, note: str = "") -> ImageReview`, as the index names it. It:
    - raises 404 `not_found` for an unknown image;
    - raises 422 `validation_error` for an unknown status;
    - raises 409 `conflict` for `none` while the image has accepted boxes;
    - on `none`, rejects pending proposals;
    - sets `marked_empty` to `status == "none"`.
  - `app.asset_review.effective.effective_status()`: a SQL expression correlated on `Image`. It gives the row's status, else `none` when the photo is marked empty, else `not_assessed`. Task 6's filter uses it too.
  - `get_review(s, image_id) -> ImageReviewOut`. For a photo with no row, the status comes from `effective_status()`, with `note` empty and `updated_at` null.
  - `ImageReviewOut`, `ImageReviewIn` and `ReviewStatus`.
  - `app.datasets.empties.apply_mark(s, image: Image, value: bool, now: datetime) -> bool`.
  - `app.datasets.empties.follow_review(s, image_ids: Iterable[str], value: bool) -> None`.
  - HTTP:
    - `GET /projects/{projectId}/images/{imageId}/review` returns 200 `ImageReview`, or 404.
    - `PUT` on the same path takes `{status, note?}` and returns 200 `ImageReview`, or 404, 409 or 422. It publishes `images.changed`, plus `boxes.changed` for `none`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_image_review.py`:

```python
"""Photo review status (asset findings spec §5.4 and §8): GET and PUT /images/{imageId}/review, and
`image.marked_empty` kept in step with it both ways."""

import pytest
from findings_helpers import insert_box

from app.asset_review.review_status import set_status
from app.db.models import Box, Image, ImageReview, Source
from app.errors import AppError

API = "/api/v1"


def _photo(handle, *, name: str = "p.jpg", pending: bool = False) -> str:
    """A photo in its own image set; `pending` adds one unreviewed model proposal."""
    with handle.session() as s:
        src = Source(folder=f"C:/flights/{name}", site="A")
        s.add(src)
        s.flush()
        image = Image(path=f"images/{name}", width=100, height=100, source_id=src.id)
        s.add(image)
        s.flush()
        if pending:
            s.add(
                Box(
                    image_id=image.id,
                    class_id="c1",
                    x=0.5,
                    y=0.5,
                    w=0.1,
                    h=0.1,
                    provenance_kind="local_model",
                    review_state="unreviewed",
                )
            )
        return image.id


def _url(project_id: str, image_id: str) -> str:
    return f"{API}/projects/{project_id}/images/{image_id}/review"


def _marked(handle, image_id: str) -> bool:
    with handle.session() as s:
        return s.get(Image, image_id).marked_empty


def test_a_photo_with_no_row_reads_from_its_mark(client, project_id, handle):
    plain, empty = _photo(handle, name="a.jpg"), _photo(handle, name="b.jpg")
    with handle.session() as s:
        s.get(Image, empty).marked_empty = True
    assert client.get(_url(project_id, plain)).json() == {
        "image_id": plain,
        "status": "not_assessed",
        "note": "",
        "coverage": None,
        "uncertain_coverage": None,
        "updated_at": None,
    }
    assert client.get(_url(project_id, empty)).json()["status"] == "none"
    with handle.session() as s:
        assert s.query(ImageReview).count() == 0  # reading writes nothing


def test_put_none_marks_the_photo_empty_and_any_other_status_clears_it(client, project_id, handle):
    image_id = _photo(handle)
    r = client.put(_url(project_id, image_id), json={"status": "none", "note": "clean shaft"})
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["note"]) == ("none", "clean shaft")
    assert r.json()["updated_at"] is not None
    assert _marked(handle, image_id) is True
    for status in ("uncertain", "finding", "not_assessed"):
        r = client.put(_url(project_id, image_id), json={"status": status})
        assert r.status_code == 200, r.text
        assert (r.json()["status"], r.json()["note"]) == (status, "")
        assert _marked(handle, image_id) is False
    assert client.get(_url(project_id, image_id)).json()["status"] == "not_assessed"


def test_put_none_is_refused_while_the_photo_has_accepted_boxes(client, project_id, handle, crack):
    image_id, _ = insert_box(handle, crack["id"])
    r = client.put(_url(project_id, image_id), json={"status": "none"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert "1 accepted box" in r.json()["error"]["message"]
    assert _marked(handle, image_id) is False
    with handle.session() as s:
        assert s.get(ImageReview, image_id) is None  # nothing half written


def test_put_none_rejects_pending_proposals(client, project_id, handle):
    image_id = _photo(handle, pending=True)
    assert client.put(_url(project_id, image_id), json={"status": "none"}).status_code == 200
    with handle.session() as s:
        states = {b.review_state for b in s.query(Box).filter(Box.image_id == image_id)}
    assert states == {"rejected"}


def test_a_mark_set_elsewhere_moves_an_existing_review(client, project_id, handle):
    image_id = _photo(handle)
    assert client.put(_url(project_id, image_id), json={"status": "uncertain"}).status_code == 200
    image_url = f"{API}/projects/{project_id}/images/{image_id}"
    assert client.patch(image_url, json={"marked_empty": True}).status_code == 200
    assert client.get(_url(project_id, image_id)).json()["status"] == "none"
    assert client.patch(image_url, json={"marked_empty": False}).status_code == 200
    assert client.get(_url(project_id, image_id)).json()["status"] == "not_assessed"
    r = client.post(
        f"{API}/projects/{project_id}/images/bulk-mark-empty",
        json={"image_ids": [image_id], "marked_empty": True},
    )
    assert r.status_code == 200, r.text
    assert client.get(_url(project_id, image_id)).json()["status"] == "none"


def test_an_unknown_photo_is_404_and_an_unknown_status_422(client, project_id, handle):
    assert client.get(_url(project_id, "nope")).status_code == 404
    assert client.put(_url(project_id, "nope"), json={"status": "none"}).status_code == 404
    image_id = _photo(handle)
    assert client.put(_url(project_id, image_id), json={"status": "maybe"}).status_code == 422


def test_set_status_writes_in_the_callers_session(handle):
    image_id = _photo(handle)
    with handle.session() as s:
        row = set_status(s, image_id, "none", "from the kit")
        assert (row.status, row.note, s.get(Image, image_id).marked_empty) == ("none", "from the kit", True)
    with handle.session() as s, pytest.raises(AppError) as raised:
        set_status(s, image_id, "maybe")
    assert raised.value.status == 422
```

- [ ] **Step 2: Run it to see it fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_review.py -q`

Expected: collection error, `ModuleNotFoundError: No module named 'app.asset_review.review_status'`.

- [ ] **Step 3: Implement the status module and the router**

Create `backend/app/asset_review/effective.py`:

```python
"""A photo's effective review status (asset findings spec §5.4, coordinator ruling for D1): its
`image_review` row's status, else `none` when the photo is marked empty, else `not_assessed`.

One SQL expression, used by `GET /images/{id}/review` and by the image index's `review_status`
filter, so the chip a photo shows and the chip that finds it can never disagree. It imports only
the models, so `app.imagery.filters` can use it without an import cycle."""

from __future__ import annotations

from sqlalchemy import case, func, select

from app.db.models import Image, ImageReview


def effective_status():
    """Correlated on `Image`: use it in a query that selects from or joins `image`."""
    recorded = select(ImageReview.status).where(ImageReview.image_id == Image.id).scalar_subquery()
    implied = case((Image.marked_empty, "none"), else_="not_assessed")
    return func.coalesce(recorded, implied)
```

It imports only the models, so `app.imagery.filters` (Task 6) can use it without an import cycle.

Create `backend/app/asset_review/review_status.py`:

```python
"""Photo review status (asset findings spec §5.4, decision A5): `finding`, `none`, `uncertain` or
`not_assessed`, at most one row per photo.

`image.marked_empty` stays the training-data truth, and the two never disagree:
- `set_status` writes `none` by marking the photo empty and any other status by clearing the mark,
  in the caller's transaction and by the Data Manager's own rules
  (`app.datasets.empties.apply_mark`): refused with 409 `conflict` while the photo has accepted
  boxes, and its pending proposals rejected.
- The other way round, a mark set or cleared in the Data Manager moves an existing row
  (`app.datasets.empties.follow_review`).
- A photo with no row reads as `none` when it is marked empty, else `not_assessed`
  (`app.asset_review.effective.effective_status`, the same expression the image index filters on).
  Reading writes nothing.

`coverage` and `uncertain_coverage` are computed by the placement and kit import jobs; nothing here
writes them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.asset_review.effective import effective_status
from app.datasets.empties import apply_mark
from app.db.base import utcnow
from app.db.models import IMAGE_REVIEW_STATUSES, Image, ImageReview
from app.errors import AppError, not_found

ReviewStatus = Literal["finding", "none", "uncertain", "not_assessed"]


class ImageReviewOut(BaseModel):
    image_id: str
    status: ReviewStatus
    note: str
    coverage: float | None
    uncertain_coverage: float | None
    updated_at: datetime | None


class ImageReviewIn(BaseModel):
    status: ReviewStatus
    note: str = Field("", max_length=4000)


def _image(s: Session, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def get_review(s: Session, image_id: str) -> ImageReviewOut:
    """The photo's row, or what its mark implies when it has none (404 for an unknown photo)."""
    _image(s, image_id)
    row = s.get(ImageReview, image_id)
    if row is None:
        return ImageReviewOut(
            image_id=image_id,
            status=s.execute(select(effective_status()).where(Image.id == image_id)).scalar_one(),
            note="",
            coverage=None,
            uncertain_coverage=None,
            updated_at=None,
        )
    return ImageReviewOut.model_validate(row, from_attributes=True)


def set_status(s: Session, image_id: str, status: str, note: str = "") -> ImageReview:
    """Write the photo's status and note, and its mark in step, in the caller's session."""
    if status not in IMAGE_REVIEW_STATUSES:
        raise AppError("validation_error", f"unknown review status {status!r}", 422)
    image = _image(s, image_id)
    now = utcnow()
    apply_mark(s, image, status == "none", now)  # may raise 409 before anything is written
    row = s.get(ImageReview, image_id)
    if row is None:
        row = ImageReview(image_id=image_id, status=status, note=note, updated_at=now)
        s.add(row)
    else:
        row.status, row.note, row.updated_at = status, note, now
    s.flush()
    return row
```

Create `backend/app/asset_review/review_router.py`:

```python
"""`GET` and `PUT /images/{imageId}/review`: a photo's review status (asset findings spec §8)."""

from fastapi import APIRouter, Depends, Request

from app.asset_review import review_status
from app.asset_review.review_status import ImageReviewIn, ImageReviewOut
from app.events_util import publish_image_ids_event
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["assetreview"])


@router.get("/images/{imageId}/review", response_model=ImageReviewOut)
def get_image_review(imageId: str, handle: ProjectHandle = Depends(get_project)) -> ImageReviewOut:  # noqa: N803
    with handle.session() as s:
        return review_status.get_review(s, imageId)


@router.put("/images/{imageId}/review", response_model=ImageReviewOut)
def put_image_review(
    imageId: str,  # noqa: N803
    body: ImageReviewIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> ImageReviewOut:
    with handle.session() as s:
        row = review_status.set_status(s, imageId, body.status, body.note)
        out = ImageReviewOut.model_validate(row, from_attributes=True)
    publish_image_ids_event(request, handle, "images.changed", [imageId])
    if body.status == "none":  # marking empty may have rejected pending proposals
        publish_image_ids_event(request, handle, "boxes.changed", [imageId])
    return out
```

`ImageReviewIn` forbids extra keys (`extra="forbid"`), matching the contract's `ImageReviewPut` `additionalProperties: false` and the sibling asset model schemas.

- [ ] **Step 4: Keep `marked_empty` and the review row in step from the Data Manager side**

In `backend/app/datasets/empties.py`, append this paragraph to the module docstring:

```
A photo's review status (`image_review`, asset findings spec §5.4) follows the mark: every path here
that sets or clears it moves an existing review row with `follow_review`, and
`app.asset_review.review_status.set_status` sets the mark through `apply_mark`.
```

Replace `from app.db.models import Box, Image, QueryRun` with these two lines:

```python
from app.db.base import utcnow
from app.db.models import Box, Image, ImageReview, QueryRun
```

Make these changes, in order:
1. Insert `follow_review` before `clear_mark_for_ground_truth`.
2. Add the `follow_review(s, ids, False)` call at the end of `clear_mark_for_ground_truth`.
3. Add `apply_mark`.
4. Rewrite `set_marked_empty` on top of `apply_mark`.

The result, from `follow_review` to the end of `set_marked_empty`:

```python
def follow_review(s: Session, image_ids: Iterable[str], value: bool) -> None:
    """Move the existing review rows of photos whose mark was just set (`value` True: they read
    `none`) or cleared (a `none` row becomes `not_assessed`). A photo with no row keeps none: its
    status is read from the mark. Chunked, set-based."""
    ids = list(image_ids)
    now = utcnow()
    for chunk in _chunks(ids):
        if value:
            where = (ImageReview.image_id.in_(chunk), ImageReview.status != "none")
            s.execute(update(ImageReview).where(*where).values(status="none", updated_at=now))
        else:
            where = (ImageReview.image_id.in_(chunk), ImageReview.status == "none")
            s.execute(update(ImageReview).where(*where).values(status="not_assessed", updated_at=now))


def clear_mark_for_ground_truth(s: Session, image_ids: Iterable[str]) -> None:
    """New ground truth on an image contradicts `marked_empty`; clear it in the same session."""
    ids = list(image_ids)
    if not ids:
        return
    s.execute(
        Image.__table__.update()
        .where(Image.id.in_(ids), Image.marked_empty.is_(True))
        .values(marked_empty=False)
    )
    follow_review(s, ids, False)


def apply_mark(s: Session, image: Image, value: bool, now: datetime) -> bool:
    """Set or clear `image.marked_empty` in the caller's session by this module's rules: marking is
    refused with 409 `conflict` while the image has ground truth, and rejects its pending proposals.
    Returns whether any proposal was rejected (the caller publishes `boxes.changed`)."""
    rejected = False
    if value:
        gt = _ground_truth_count(s, image.id)
        if gt:
            raise AppError("conflict", ground_truth_message(gt), 409)
        if _reject_pending(s, image.id, now):
            rejected = True
            recount_runs_of(s, [image.id])
            summary.touch(s, image.id)
    image.marked_empty = value
    return rejected


def set_marked_empty(handle: ProjectHandle, image_id: str, value: bool) -> tuple[ImageRow, list[str]]:
    with handle.session() as s:
        image = s.get(Image, image_id)
        if image is None:
            raise not_found("image", image_id)
        rejected = apply_mark(s, image, value, datetime.now(UTC))
        follow_review(s, [image_id], value)
        s.flush()
    return get_image(handle, image_id), [image_id] if rejected else []
```

`set_marked_empty` behaves exactly as before: the same 409, the same rejection, the same return value. `apply_mark` is its old body moved out, so the two callers share one rule.

In `bulk_mark_empty`:
- add `follow_review(s, to_unmark, False)` directly before `return len(to_unmark), 0, []`;
- add `follow_review(s, to_mark, True)` directly after the loop `for chunk in _chunks(to_mark): s.execute(update(Image).where(Image.id.in_(chunk)).values(marked_empty=True))`.

- [ ] **Step 5: Route it and remove the C0 stubs**

In `backend/app/api.py`, in the tuple of guarded router modules that holds `"app.asset_review.stubs"` (C0 put it beside `"app.asset_models.runs"`), insert `"app.asset_review.review_router",` on the line directly above `"app.asset_review.stubs",`.

In `backend/app/asset_review/stubs.py`, delete D1's two tuples, so the list reads `D1_STUBS: list[Stub] = []`. The deleted tuples are `getImageReview` and `putImageReview`. Keep the empty list: C0's `tests/test_asset_findings_stubs.py` reads `review_stubs.D1_STUBS`.

- [ ] **Step 6: Run it to see it pass, with the suites that mark images empty, and the contract**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_review.py -q`

Expected: `7 passed`.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py tests/test_asset_findings_stubs.py -q`

Then: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest -q -k "empty or image or annotation"`

Expected: all pass. `test_every_spec_path_is_routed` and `test_no_extra_api_routes` both hold: the stubs are gone, and the real routes answer at the same paths.

- [ ] **Step 7: Commit**

```
git add backend/app/asset_review/effective.py backend/app/asset_review/review_status.py backend/app/asset_review/review_router.py backend/app/asset_review/stubs.py backend/app/datasets/empties.py backend/app/api.py backend/tests/test_image_review.py
git commit -m "feat(asset-review): photo review status API, marked_empty kept in step both ways" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `review_status` filter on the image index (coordinator ruling; replaces U4 Task 8)

**Files:**
- Modify: `backend/app/imagery/filters.py`
- Modify: `backend/app/imagery/routes_index.py`
- Modify: `backend/tests/test_image_index.py` (an import, and two tests at the end)
- Modify: `contract/openapi.yaml` (the description of C0's `imageReviewStatus` only)
- Regenerate: `contract/client/schema.d.ts`

**Interfaces:**
- Consumes: `IMAGE_REVIEW_STATUSES` (Task 1); `effective_status()` and `set_status` (Task 5); C0's `imageReviewStatus` parameter on `getImageIndex`.
- Produces:
  - `app.imagery.filters.REVIEW_PATTERN`
  - `ImageFilters.review_status: list[str] | None`
  - `review_condition(values: list[str])`: `effective_status().in_(values)`.
  - `GET /images/index?review_status=<csv>` keeps the photos whose **effective** status is one of the listed statuses.
  - A photo with no row matches `not_assessed`, or `none` when it is marked empty, exactly what its GET answers (coordinator ruling). The test pins this with `d` (marked empty, no row) and `e` (no row), and checks the GET against the filter for both.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_image_index.py`, add `from app.asset_review.review_status import set_status` directly above `from app.imagery import index as image_index`, and append:

```python
def test_review_status_filter(client, world, handle):  # noqa: F811
    """Asset findings spec §5.4: the filter matches the effective status, the one the GET answers.
    a, b and c have a row. d (marked empty) and e have none: no row matches `not_assessed`, and
    marked empty with no row matches `none` (coordinator ruling for D1)."""
    ids = world["ids"]
    with handle.session() as s:
        set_status(s, ids["a"], "uncertain")
        set_status(s, ids["b"], "finding")  # b has accepted boxes, so `none` would be refused
        set_status(s, ids["c"], "not_assessed")
    back = {v: k for k, v in ids.items()}

    def names(value: str) -> list[str]:
        return sorted(back[i] for i in _index(client, world["pid"], review_status=value)["ids"])

    assert names("uncertain") == ["a"]
    assert names("none") == ["d"]  # marked empty, no row
    assert names("none,finding") == ["b", "d"]
    assert names("not_assessed") == ["c", "e"]  # e: no row, not marked
    assert names("finding,none,uncertain,not_assessed") == ["a", "b", "c", "d", "e"]
    for name in "de":
        got = client.get(f"{API}/projects/{world['pid']}/images/{ids[name]}/review").json()["status"]
        assert names(got).count(name) == 1  # the GET and the filter agree
    assert sorted(back[i] for i in _index(client, world["pid"])["ids"]) == ["a", "b", "c", "d", "e"]


def test_review_status_rejects_unknown_values(client, world):  # noqa: F811
    r = client.get(f"{API}/projects/{world['pid']}/images/index", params={"review_status": "maybe"})
    assert r.status_code == 422
```

`world` is the shared five-image fixture from `test_image_filters.py`:
- `b` has accepted boxes, so `set_status(b, "none")` would answer 409. The test gives `b` `finding` instead.
- `d` is marked empty and `e` is not; neither gets a review row.

- [ ] **Step 2: Run them to see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_index.py::test_review_status_filter tests/test_image_index.py::test_review_status_rejects_unknown_values -q`

Expected: FAIL. FastAPI ignores the unknown parameter, so every image is returned and `maybe` answers 200.

- [ ] **Step 3: Implement**

In `backend/app/imagery/filters.py`:
1. Add `from app.asset_review.effective import effective_status` above the models import, and change the models import to `from app.db.models import IMAGE_REVIEW_STATUSES, Box, Finding, Image, ImageSummary`.
2. After `STATUS_PATTERN`, add `REVIEW_PATTERN = r"^(finding|none|uncertain|not_assessed)(,(finding|none|uncertain|not_assessed))*$"`. That is C0's `imageReviewStatus` pattern, verbatim.
3. Add `review_status: list[str] | None = None  # photo review statuses (asset findings spec §5.4)` as the last field of `ImageFilters`.
4. Above `def where(`, add:

```python
def review_condition(values: list[str]):
    """Photos whose effective review status is one of `values` (asset findings spec §5.4): the
    `image_review` row's status, else `none` when marked empty, else `not_assessed`. The same
    expression `GET /images/{id}/review` answers with (coordinator ruling for D1)."""
    for v in values:
        if v not in IMAGE_REVIEW_STATUSES:
            raise _invalid(f"review_status {v!r} is not one of {', '.join(IMAGE_REVIEW_STATUSES)}")
    return effective_status().in_(values)
```

5. In `where`, directly before the final `return q`, add:

```python
    if f.review_status:
        q = q.where(review_condition(f.review_status))
```

In `backend/app/imagery/routes_index.py`:
1. Replace the filters import with:

```python
from app.imagery.filters import (
    REVIEW_PATTERN,
    SEVERITY_PATTERN,
    SORT_NAMES,
    STATUS_PATTERN,
    ImageFilters,
    parse_csv,
)
```

2. Add a parameter to `get_image_index`, after `unlabeled: bool | None = None,`:

```python
    review_status: str | None = Query(
        None, pattern=REVIEW_PATTERN, description="csv of photo review statuses"
    ),
```

3. In the `ImageFilters(...)` call, after `unlabeled=unlabeled,`, add `review_status=parse_csv(review_status),`.

- [ ] **Step 4: Add the marked-empty clause to the contract's wording**

C0's `imageReviewStatus` description says `not_assessed` "also matches a photo with no review status yet". That is right, but incomplete: a marked-empty photo with no row matches `none`. In `contract/openapi.yaml`, under `components/parameters/imageReviewStatus`, replace the `description` with:

```yaml
      description: >-
        comma-separated photo review statuses (asset findings spec §5.4); `not_assessed` also
        matches a photo with no review status yet, or `none` when it is marked empty
```

Run: `pnpm -C contract generate; pnpm -C contract check`

Expected: `schema.d.ts` changes only in that parameter's comment, and `check` passes. Note the edit to C0's contract text in the ledger.

- [ ] **Step 5: Run the tests**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_index.py tests/test_image_filters.py tests/test_contract.py -q`

Expected: all pass.

- [ ] **Step 6: Commit**

```
git add backend/app/imagery/filters.py backend/app/imagery/routes_index.py backend/tests/test_image_index.py contract/openapi.yaml contract/client/schema.d.ts
git commit -m "feat(images): review_status filter on the image index" -m "Filter and GET share one effective status: a photo with no row is not_assessed, or none when marked empty." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gate and land

**Files:** none new.

- [ ] **Step 1: Rebase on `main` and re-check the head**

```
git fetch
git rebase main
```

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m alembic -c app/db/migrations/alembic.ini heads`

Expected: one head, `0016`. If another unit landed a project revision first, renumber this one on top of it. That means updating:
- the file name, `revision` and `down_revision`;
- the `REBUILD_GUARDS` entry;
- the tests' `"0016"` and `"r0016"` strings.

Then rerun Tasks 1 and 2's tests.

- [ ] **Step 2: Run the full gate (AGENTS.md)**

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if frontend/src-tauri/binaries/kestrel-backend-*.exe exists
```

In a worktree, the backend line uses the shared interpreter, `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (CONTRIBUTING.md "Testing").

Expected: every line green.

- [ ] **Step 3: Merge, clean up, hand over**

Run `scripts\finish-task.ps1 -Name af-d1`. If it fails on Windows PowerShell 5.1, merge by hand:
1. `git switch main`
2. `git merge --no-ff task/af-d1`
3. Remove the worktree's junctions as links, then `git worktree remove .claude/worktrees/af-d1`. See the memory note "worktree removal without losing the venv".
4. `git branch -d task/af-d1`

Operator walkthrough (put it in the ledger and the hand-off message):
1. Copy one of your projects to a scratch folder. Pick one made since the foundation upgrade, with at least one finding that has a comment. Open the copy in the dev app (`pnpm -C frontend dev` plus the backend).
2. Open the copy's `backups\` folder. Expected: a new file `project.db.r0016-<date>.bak`, next to any older `v1` backup.
3. Open the findings register. Expected: every finding is still there. The one with a comment still has its comment and any photo attachment.
4. In Data Manager, mark a photo as empty, then unmark it. Expected: it behaves as before. Photo review status has no screen until U3 and U4.

---

## Self-review

**Spec coverage (D1's share):**

| Spec | Where |
| --- | --- |
| §5.1 `asset_model.frame`, `review` | Task 1: columns and ORM. C0's `AssetModelOut` reads them, and Task 4 tests that. Validation and `PATCH` are J1's. |
| §5.2 `kind = 'imported'` | Task 1: a string column with no CHECK, comment updated. C0 widened `AssetModelVersionOut.kind`. |
| §5.3 `image_pose` | Task 1: PK `(asset_model_id, image_id)`, plus the image and sequence indexes |
| §5.4 `image_review`, `marked_empty` in step | Task 1 (table, CHECK); Task 5 (`set_status`, `apply_mark`, `follow_review`) |
| §5.5 the finding asset columns, the fourth CHECK branch, the `data_type` value, the indexes, the batch re-create, copy-first | Task 1, Task 2 |
| §5.6 `finding_sighting`, with J4 ruling N1 (nullable `finding_id`, `asset_model_id` RESTRICT) | Task 1 |
| §8 `GET`/`PUT /images/{id}/review` | Task 5 |
| §8 `Finding` asset fields, `sighting_count`, asset anchor | Task 4. `representative` for asset findings is J4's. |
| §9 outcome chips need `review_status` on the image index | Task 6 (coordinator ruling) |
| §12 "every anchor kind accepted, every mixed state rejected" | Task 1 |
| Index: 409 `has_findings`, extended by J4 ruling N5 to ungrouped sightings | Task 3: Review Focus test `test_asset_model_delete_refused_with_findings`, plus `test_asset_model_delete_refused_with_ungrouped_sightings` |

**Placeholders:** none. Every code block is the complete code. While planning, each test was run against a scratch copy of the backend, with C0's Task 3 applied by hand:

| Test file | Result |
| --- | --- |
| `test_migration_0016.py` | 35 passed |
| `test_findings_asset_fields.py` | 3 passed |
| `test_image_review.py` | 7 passed |
| `test_image_index.py` with `test_image_filters.py` | passed |
| the new backup and asset model delete tests | passed |

A wider run over the finding, image, dataset, report, migration and asset suites stayed green, apart from:
- the two tests Task 1 Step 5 updates;
- two tests that need files outside a scratch copy (`frontend/e2e/fixtures`, `kestrel_backend.spec`).

**Type consistency:** the names the index lists for D1 are kept exactly:
- `ImagePose`, `ImageReview` and `FindingSighting`;
- the `Finding` columns, with the normal as `an_x, an_y, an_z`;
- `AssetModel.frame` and `review`;
- `set_status(s, image_id, status, note="") -> ImageReview`.

J4's preflight (its Task 2 Step 1) asserts:
- `FindingSighting.finding_id` is nullable;
- `FindingSighting.asset_model_id` exists;
- the fifteen `Finding` columns and `AssetModel.frame` and `review` exist.

All of these hold after Task 1.

## Index notes

1. **Copy-first did not cover 0016.** The spec says the migration is "copy-first like every schema change since 0010". In fact `open_project_db` copied only when an upgrade crossed `0010`, and 0011 to 0015 took no copy.
   - Task 2 adds `REBUILD_GUARDS`, so 0016 does take one. The foundation's `BACKUP_BEFORE`, which many tests monkeypatch, is untouched.
   - Side effect: a project at 0010 to 0015 may still be at schema version 1. If the `project_migrate` job upgrades it, the job sees the new `r0016` copy as the open's copy and skips its own `backup_before_steps`. That copy is a correct pre-step copy, taken before any data step.
2. **The batch rebuild trap.** See Architecture, and the ADR in Task 1. Any later unit that rebuilds a referenced table must use the same guard. The index said to "re-create the CHECK via batch mode as 0010 did". 0010 created the CHECK in `create_table`; the batch re-create pattern comes from catalogue `0003`.
3. **The coordinator's three rulings are applied:**
   - J4 N1 and N5: `finding_sighting.finding_id` is nullable; `asset_model_id` is NOT NULL with RESTRICT and an index; `has_findings` also counts ungrouped sightings.
   - `representative` stays J4's.
   - U4 Task 8 moves into D1 Task 6.
4. **One effective review status (coordinator ruling).** `GET /images/{id}/review` and the image index's `review_status` filter both use `app.asset_review.effective.effective_status()`: the row's status, else `none` when the photo is marked empty, else `not_assessed`. A photo marked empty only in Data Manager therefore shows under the "No finding" chip with no row written. D1 adds the marked-empty clause to C0's `imageReviewStatus` description (Task 6 Step 4).
5. **`finding_sighting.image_id` and `annotation_id` have no ON DELETE**, like `finding.annotation_id`. Until J4 extends `findings/annotations.py`, deleting a box or image that a sighting points at fails with an integrity error rather than leaving a finding wrong. No sighting exists before J4 or J5 writes one.
6. **New public functions that the index does not list:** `app.datasets.empties.apply_mark` and `follow_review`, `app.asset_review.review_status.get_review`, and `app.asset_review.effective.effective_status`. All are additive.
