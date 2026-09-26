"""Pre-foundation project folders and small tools for the migration tests (foundation spec §11, §16).

Old databases are built with Alembic to an old revision and filled with raw SQL: the ORM describes
the newest schema, which an old database does not have.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from library_helpers import wait_library_job as _wait_library_job

from app.db.session import alembic_config, open_project_db
from app.projects.service import ProjectHandle

T0 = "2026-01-01 00:00:00.000000"
PID = "p-legacy"
AUTH = {"Authorization": "Bearer test-token"}
CLASSES = [
    {"id": "c-exc", "name": "excavator", "colour": "#f97316", "hotkey": "1", "order": 0},
    {"id": "c-dump", "name": "dump_truck", "colour": "#06b6d4", "hotkey": "2", "order": 1},
]
# The ledger before unit BC's revision 0010 creates it. Only ever run on a database at head:
# on an older one, 0010 would then fail to create the table.
LEDGER_DDL = (
    "CREATE TABLE IF NOT EXISTS migration_step "
    "(name VARCHAR NOT NULL PRIMARY KEY, done_at DATETIME NOT NULL, detail JSON NOT NULL)"
)
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
# Box outcomes written for each class, in creation order (seconds 0..4).
OUTCOMES = [
    ("accepted", "local_model"),
    ("edited", "local_model"),
    ("accepted", "person"),
    ("unreviewed", "local_model"),
    ("rejected", "local_model"),
]


def wait_library_job(client, job_id: str, timeout: float = 30.0) -> dict:
    """`library_helpers.wait_library_job`, then also wait until the runner no longer counts the
    job as live (F5): `JobRunner._finish` writes the job's terminal state before `_run`'s `finally`
    drops it from the runner's live contexts, so a caller that sees "succeeded"/"failed" and
    immediately resubmits can still observe a stale `live_job_id` for a few milliseconds. Raises
    (rather than returning with the job still live) if that never clears within `timeout`, so a
    hang here fails with its own message instead of a confusing assertion further down the test."""
    result = _wait_library_job(client, job_id, timeout)
    deadline = time.time() + timeout
    while client.app.state.jobs.is_live(job_id):
        if time.time() >= deadline:
            raise AssertionError(f"job {job_id} is still live {timeout}s after reaching its terminal state")
        time.sleep(0.02)
    return result


@contextmanager
def db(folder: Path):
    con = sqlite3.connect(folder / "project.db")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def at_revision(
    folder: Path, revision: str, *, name: str = "Legacy", classes: list[dict] = CLASSES, pid: str = PID
) -> Path:
    """A project folder whose database is at `revision`, with its one `project` row (version 1)."""
    folder.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(folder), revision)
    with db(folder) as con:
        con.execute(
            "INSERT INTO project (id, name, classes, schema_version, import_defaults, created_at)"
            " VALUES (?, ?, ?, 1, '{}', ?)",
            (pid, name, json.dumps(classes), T0),
        )
    return folder


def legacy_at_head(folder: Path, *, pid: str = PID, name: str = "Legacy") -> Path:
    """A version-1 project already at the newest revision, with the step ledger in place."""
    at_revision(folder, "head", pid=pid, name=name)
    add_ledger_table(folder)
    return folder


def add_ledger_table(folder: Path) -> None:
    with db(folder) as con:
        con.execute(LEDGER_DDL)


def set_schema_version(folder: Path, version: int) -> None:
    with db(folder) as con:
        con.execute("UPDATE project SET schema_version = ?", (version,))


def revision_of(db_file: Path) -> str | None:
    con = sqlite3.connect(f"{Path(db_file).resolve().as_uri()}?mode=ro", uri=True)
    try:
        row = con.execute("SELECT version_num FROM alembic_version").fetchone()
    finally:
        con.close()
    return row[0] if row else None


def sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def add_images_and_boxes(folder: Path, classes: list[dict] = CLASSES) -> None:
    """One source, two images (i1 has a GPS fix), and on each class one box per OUTCOMES entry.
    Box n of a class is on i1 when n is even, on i2 otherwise. Works from revision 0001."""
    with db(folder) as con:
        con.execute(
            "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at)"
            " VALUES ('s1', 'C:/photos', 'site', '{}', 2, 0, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO image (id, path, width, height, source_id, lat, lon, group_key, created_at)"
            " VALUES ('i1', 'images/site/a.jpg', 100, 100, 's1', 25.1, 55.2, '', ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO image (id, path, width, height, source_id, group_key, created_at)"
            " VALUES ('i2', 'images/site/b.jpg', 100, 100, 's1', '', ?)",
            (T0,),
        )
        for c in classes:
            for n, (state, provenance) in enumerate(OUTCOMES):
                model = None if provenance == "person" else "m-old"
                con.execute(
                    "INSERT INTO box (id, image_id, class_id, x, y, w, h, confidence, provenance_kind,"
                    " model_id, review_state, created_at) VALUES (?, ?, ?, 1, 1, 5, 5, ?, ?, ?, ?, ?)",
                    (
                        f"b-{c['id']}-{n}",
                        "i1" if n % 2 == 0 else "i2",
                        c["id"],
                        None if model is None else 0.9,
                        provenance,
                        model,
                        state,
                        f"2026-01-01 00:00:0{n}.000000",
                    ),
                )


def add_detect_rows(folder: Path, classes: list[dict] = CLASSES) -> None:
    """Revision 0008 or later: a map with a run whose counts, verified counts, area counts and class
    map name the first two classes, four detections and a label, a query run, and a model class map."""
    a, b = classes[0]["id"], classes[1]["id"]
    with db(folder) as con:
        con.execute(
            "INSERT INTO geo_map (id, name, status, source_path, source_size, source_sha256, width, height,"
            " band_count, dtype, stretch, labels_version, created_at) VALUES ('m1', 'April', 'ready',"
            " 'x.tif', 1, '', 100, 100, 3, 'uint8', '{}', 0, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO map_run (id, map_id, kind, query, tile_size, overlap, nms_iou, conf, counts,"
            " created_at, verified_counts, area_counts, class_map) VALUES ('r1', 'm1', 'local_model', '',"
            " 1280, 0.2, 0.5, 0.25, ?, ?, ?, ?, ?)",
            (
                json.dumps({a: 3, b: 1}),
                T0,
                json.dumps({a: 1}),
                json.dumps({"area1": {a: {"total": 2, "verified": 1}, b: {"total": 1, "verified": 0}}}),
                json.dumps({"excavator": a, "truck": b, "person": None}),
            ),
        )
        for i, cid in enumerate([a, a, a, b]):
            con.execute(
                "INSERT INTO map_detection (id, run_id, class_id, confidence, x, y, w, h, review_state)"
                " VALUES (?, 'r1', ?, 0.8, ?, 1, 4, 4, 'unreviewed')",
                (f"d{i}", cid, float(i)),
            )
        con.execute(
            "INSERT INTO map_label (id, map_id, class_id, x, y, w, h, source, created_at, updated_at)"
            " VALUES ('l1', 'm1', ?, 1, 1, 4, 4, 'manual', ?, ?)",
            (b, T0, T0),
        )
        con.execute(
            "INSERT INTO query_run (id, kind, query, image_ids, tiling, conf, created_at, counts,"
            " verified_counts, class_map) VALUES ('q1', 'local_model', '', '[]', '{}', 0.25, ?, ?, ?, ?)",
            (T0, json.dumps({a: 2}), json.dumps({a: 1}), json.dumps({"excavator": a})),
        )
        con.execute(
            "INSERT INTO model_class_map (library_model_id, mapping, updated_at) VALUES ('lib-m1', ?, ?)",
            (json.dumps({"excavator": a, "truck": b, "bird": None}), T0),
        )


def add_dataset(
    folder: Path, *, name: str = "v1", materialised: bool = True, classes: list[dict] = CLASSES
) -> str:
    """A frozen dataset over i1 (needs add_images_and_boxes); `materialised` writes its data.yaml."""
    dataset_id = f"ds-{name}"
    with db(folder) as con:
        con.execute(
            "INSERT INTO dataset (id, name, classes, split_method, split_params, path, created_at)"
            " VALUES (?, ?, ?, 'random', ?, ?, ?)",
            (
                dataset_id,
                name,
                json.dumps(classes),
                json.dumps({"val_fraction": 0.2, "seed": 0}),
                f"datasets/{name}",
                T0,
            ),
        )
        boxes = [{"class_id": c["id"], "x": 1, "y": 1, "w": 5, "h": 5} for c in classes]
        con.execute(
            "INSERT INTO dataset_image (dataset_id, image_id, split, boxes) VALUES (?, 'i1', 'train', ?)",
            (dataset_id, json.dumps(boxes)),
        )
    if materialised:
        root = folder / "datasets" / name
        root.mkdir(parents=True, exist_ok=True)
        names = "".join(f"  {i}: '{c['name']}'\n" for i, c in enumerate(classes))
        (root / "data.yaml").write_text(
            f"path: '.'\ntrain: images/train\nval: images/val\nnames:\n{names}", "utf-8"
        )
    return dataset_id


def add_cloud_rows(folder: Path) -> None:
    """Revision 0009 or later: a point cloud with a measurement, a surface and a volume on it."""
    with db(folder) as con:
        con.execute(
            "INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)"
            " VALUES ('pc1', 'Scan', 'ready', 'C:/scan.laz', 1, ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO cloud_measurement (id, point_cloud_id, kind, name, points, results, created_at,"
            " updated_at) VALUES ('cm1', 'pc1', 'distance', 'D1', '[]', '{}', ?, ?)",
            (T0, T0),
        )
        con.execute(
            "INSERT INTO surface (id, name, kind, status, created_at) VALUES ('sf1', 'DSM', 'cloud_dsm',"
            " 'ready', ?)",
            (T0,),
        )
        con.execute(
            "INSERT INTO volume_measurement (id, name, polygon_native, top_surface_id, base, masks,"
            " alignment, status, created_at, updated_at) VALUES ('v1', 'Pile', '[]', 'sf1', '{}', '[]',"
            " '{}', 'ready', ?, ?)",
            (T0, T0),
        )


def open_handle(folder: Path) -> ProjectHandle:
    """Open a folder the way the registry does (backup, upgrade) without the registry, ledger ready."""
    engine = open_project_db(folder)
    with engine.begin() as c:
        c.exec_driver_sql(LEDGER_DDL)
        pid, version = c.exec_driver_sql("SELECT id, schema_version FROM project").one()
    handle = ProjectHandle(pid, folder, engine)
    handle.schema_version = version
    return handle


def arm(monkeypatch, *steps) -> None:
    """Set the migration pipeline for one test; `arm(monkeypatch)` disarms it."""
    from app.migration import steps as steps_module

    monkeypatch.setattr(steps_module, "PIPELINE", tuple(steps))


class HeldStep:
    """A step that waits until the test releases it: a job that is live on demand."""

    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()

    def step(self):
        from app.migration.pipeline import Step

        def run(ctx):
            self.entered.set()
            assert self.release.wait(30), "the test never released the held step"
            return {}

        return Step("held", "Holding", run)


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
