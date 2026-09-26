"""Library revision 0002 (foundation F §12.1, plan BM Task 1): an existing library keeps its models
and gains the class map and the Models section's tables; the ORM and the migration agree."""

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, delete, func, inspect, select

from app.library.db import (
    LibraryBase,
    LibraryDataset,
    LibraryDatasetItem,
    LibraryDatasetSource,
    LibraryModel,
)
from app.library.handle import MIGRATIONS, open_library
from app.library.paths import library_root

NEW_TABLES = {"dataset", "dataset_source", "dataset_item", "training_run"}
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}


def _library_at_0001_with_a_model(data_dir: Path) -> None:
    root = library_root(data_dir)
    root.mkdir(parents=True)
    url = f"sqlite:///{(root / 'library.db').as_posix()}"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "0001")
            conn.exec_driver_sql(
                "INSERT INTO library_model (id, name, notes, task, format, origin, weights_path, "
                "class_names, class_aliases, provenance, hyperparameters, exports, artifacts, sha256, "
                "created_at) VALUES ('m1', 'old', '', 'detect', 'pt', 'imported', "
                "'models/old-m1/weights.pt', '[\"excavator\"]', '{}', '{}', '{}', '{}', '{}', 'abc', "
                "'2026-09-01 00:00:00.000000')"
            )
    finally:
        engine.dispose()


def _table(diff) -> str:
    kind = diff[0]
    if kind in ("add_table", "remove_table"):
        return diff[1].name
    if kind in ("add_column", "remove_column"):
        return diff[2]
    if kind in ("add_index", "remove_index"):
        return diff[1].table.name
    return ""


def test_a_0001_library_upgrades_and_keeps_its_models(tmp_path):
    _library_at_0001_with_a_model(tmp_path / "appdata")
    lib = open_library(tmp_path / "appdata")
    try:
        with lib.engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0002"
        assert NEW_TABLES <= set(inspect(lib.engine).get_table_names())
        with lib.session() as s:
            row = s.get(LibraryModel, "m1")
            assert row.name == "old" and row.class_names == ["excavator"]
            assert row.class_map == {}
        assert lib.datasets_dir == lib.folder / "datasets" and lib.datasets_dir.is_dir()
    finally:
        lib.engine.dispose()


def test_the_orm_and_the_migration_describe_the_same_tables(tmp_path):
    lib = open_library(tmp_path / "appdata")
    try:
        with lib.engine.connect() as conn:
            diffs = compare_metadata(MigrationContext.configure(conn), LibraryBase.metadata)
    finally:
        lib.engine.dispose()
    # `job` is mapped by app.db.models.Job (the project Base), not LibraryBase, so it always differs.
    structural = [d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and _table(d) != "job"]
    assert structural == []


def test_deleting_a_dataset_cascades_to_its_sources_and_items(tmp_path):
    lib = open_library(tmp_path / "appdata")
    try:
        with lib.session() as s:
            s.add(LibraryDataset(id="d1", name="x", classes=[], split_method="random"))
            s.flush()
            s.add(
                LibraryDatasetSource(
                    dataset_id="d1", project_id="p", project_folder="f", project_name="P", image_count=1
                )
            )
            s.add(LibraryDatasetItem(dataset_id="d1", project_id="p", image_id="i", split="train", labels=[]))
        with lib.session() as s:
            s.execute(delete(LibraryDataset).where(LibraryDataset.id == "d1"))
        with lib.session() as s:
            assert s.execute(select(func.count()).select_from(LibraryDatasetItem)).scalar_one() == 0
            assert s.execute(select(func.count()).select_from(LibraryDatasetSource)).scalar_one() == 0
    finally:
        lib.engine.dispose()
