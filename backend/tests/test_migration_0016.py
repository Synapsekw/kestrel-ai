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
