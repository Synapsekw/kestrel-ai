### Task 5: Database models, migrations and project store

**Files:**
- Create: `backend/app/db/base.py`, `backend/app/db/models.py`, `backend/app/db/session.py`, `backend/app/db/migrations/alembic.ini`, `backend/app/db/migrations/env.py`, `backend/app/db/migrations/script.py.mako`, `backend/app/db/migrations/versions/0001_initial.py`, `backend/app/appdata.py`, `backend/app/projects/service.py`, `backend/app/projects/schemas.py`, `backend/app/projects/router.py`, `backend/tests/test_projects.py`, `backend/tests/test_db.py`

**Interfaces:**
- Produces: SQLAlchemy models `Project, Source, Image, Box, Dataset, DatasetImage, Model, Job, QueryRun` with the columns of spec section 4; `ProjectRegistry(data_dir)` with `create(name, folder, classes) -> ProjectHandle`, `open(folder) -> ProjectHandle`, `get(project_id) -> ProjectHandle` (raises `not_found`), `recent() -> list[dict]`, `close_all()`; `ProjectHandle` with `id: str`, `folder: Path`, `engine`, `session() -> contextmanager[Session]`, and folder helpers `images_dir`, `labels_dir`, `datasets_dir`, `runs_dir`, `models_dir`, `thumbs_dir`; FastAPI dependency `get_project(projectId: str, request: Request) -> ProjectHandle` in `app/projects/service.py`.
- Consumes: `AppError`, `Settings`.

- [ ] **Step 1: Write failing tests**

`tests/test_db.py`:

```python
from sqlalchemy import inspect

from app.db.session import open_project_db


def test_migrations_create_schema(project_dir):
    engine = open_project_db(project_dir)
    names = set(inspect(engine).get_table_names())
    expected = {"project", "source", "image", "box", "dataset", "dataset_image", "model", "job", "query_run"}
    assert expected <= names
```

`tests/test_projects.py`:

```python
CLASSES = [
    {"name": "excavator", "colour": "#ff0000", "hotkey": "1"},
    {"name": "dump_truck", "colour": "#00ff00", "hotkey": "2"},
]


def _create(client, folder, name="Ahmadia"):
    r = client.post("/api/v1/projects", json={"name": name, "folder": str(folder), "classes": CLASSES})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_project_makes_folder_layout(client, project_dir):
    p = _create(client, project_dir)
    assert p["name"] == "Ahmadia" and len(p["classes"]) == 2 and p["classes"][0]["order"] == 0
    assert p["folder"] == str(project_dir)
    for sub in ("images", "labels", "datasets", "runs", "models", "cache/thumbs"):
        assert (project_dir / sub).is_dir()
    assert (project_dir / "project.db").exists()


def test_create_in_folder_with_existing_project_is_409(client, project_dir):
    _create(client, project_dir)
    r = client.post("/api/v1/projects", json={"name": "B", "folder": str(project_dir), "classes": []})
    assert r.status_code == 409


def test_open_existing_project_returns_same_id(client, project_dir):
    created = _create(client, project_dir, "A")
    opened = client.post("/api/v1/projects/open", json={"folder": str(project_dir)}).json()
    assert opened["id"] == created["id"]
    assert client.get(f"/api/v1/projects/{created['id']}").json()["name"] == "A"


def test_open_missing_folder_is_404(client, tmp_path):
    r = client.post("/api/v1/projects/open", json={"folder": str(tmp_path / "nope")})
    assert r.status_code == 404


def test_recent_projects_listed(client, project_dir):
    _create(client, project_dir, "A")
    r = client.get("/api/v1/projects")
    assert [p["name"] for p in r.json()["items"]] == ["A"]
    assert r.json()["next_cursor"] is None


def test_update_classes_reorders_and_keeps_ids(client, project_dir):
    p = _create(client, project_dir, "A")
    new = [dict(p["classes"][1], hotkey="9"), p["classes"][0]]
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=new)
    assert r.status_code == 200
    assert [c["name"] for c in r.json()["classes"]] == ["dump_truck", "excavator"]
    assert r.json()["classes"][0]["id"] == p["classes"][1]["id"]
    assert r.json()["classes"][0]["hotkey"] == "9"


def test_duplicate_class_name_is_422(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], CLASSES[0]])
    assert r.status_code == 422


def test_patch_project_name_and_import_defaults(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.patch(f"/api/v1/projects/{p['id']}", json={"name": "B", "import_defaults": {"max_side": 3000}})
    assert r.status_code == 200
    assert r.json()["name"] == "B" and r.json()["import_defaults"]["max_side"] == 3000
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_db.py tests/test_projects.py`
Expected: ImportError.

- [ ] **Step 3: Implement models**

`app/db/base.py`:

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
```

`app/db/models.py`: every table from spec section 4 as `mapped_column`s. Write all columns out; this is the exhaustive list.

```python
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_id, utcnow


class Project(Base):
    __tablename__ = "project"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    classes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, colour, hotkey, order}]
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    preannotation_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    import_defaults: Mapped[dict] = mapped_column(JSON, default=dict)  # {max_side, quality, dedupe_threshold, group_regex}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Source(Base):
    __tablename__ = "source"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    folder: Mapped[str] = mapped_column(String)
    site: Mapped[str] = mapped_column(String)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # {max_side, quality, dedupe_threshold, group_regex}
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Image(Base):
    __tablename__ = "image"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    path: Mapped[str] = mapped_column(String)  # relative to the project folder, forward slashes
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("source.id"))
    capture_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    alt: Mapped[float | None] = mapped_column(Float, nullable=True)
    phash: Mapped[str | None] = mapped_column(String(16), nullable=True)
    group_key: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_image_source", "source_id"), Index("ix_image_group", "group_key"), Index("ix_image_path", "path", unique=True))


class Box(Base):
    __tablename__ = "box"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provenance_kind: Mapped[str] = mapped_column(String)  # person | local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_state: Mapped[str] = mapped_column(String, default="unreviewed")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_box_image", "image_id"), Index("ix_box_query_run", "query_run_id"), Index("ix_box_review", "review_state"))


class Dataset(Base):
    __tablename__ = "dataset"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    classes: Mapped[list] = mapped_column(JSON, default=list)
    split_method: Mapped[str] = mapped_column(String)  # by_group | by_tile | random
    split_params: Mapped[dict] = mapped_column(JSON, default=dict)  # {val_fraction, seed}
    path: Mapped[str] = mapped_column(String)  # relative: datasets/<name>
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DatasetImage(Base):
    __tablename__ = "dataset_image"
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("dataset.id", ondelete="CASCADE"), primary_key=True)
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id"), primary_key=True)
    split: Mapped[str] = mapped_column(String)  # train | val
    boxes: Mapped[list] = mapped_column(JSON, default=list)  # frozen [{class_id, x, y, w, h}]


class Model(Base):
    __tablename__ = "model"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # imported | trained
    weights_path: Mapped[str] = mapped_column(String)  # relative to project folder
    base_weights: Mapped[str | None] = mapped_column(String, nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    hyperparameters: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    class_aliases: Mapped[dict] = mapped_column(JSON, default=dict)  # {"truck": "dump_truck"}
    exports: Mapped[dict] = mapped_column(JSON, default=dict)  # {"onnx": "models/x.onnx"}
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "job"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String)  # import | dataset | train | infer | export
    state: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(String, default="")
    log_path: Mapped[str] = mapped_column(String)  # relative: runs/<job_id>/job.log
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (Index("ix_job_state", "state"), Index("ix_job_created", "created_at"))


class QueryRun(Base):
    __tablename__ = "query_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)  # local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query: Mapped[str] = mapped_column(String, default="")
    image_ids: Mapped[list] = mapped_column(JSON, default=list)
    tiling: Mapped[dict] = mapped_column(JSON, default=dict)  # {tile_size, overlap, nms_iou}
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

`app/db/session.py`:

```python
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

MIGRATIONS = Path(__file__).parent / "migrations"


def open_project_db(folder: Path):
    url = f"sqlite:///{(folder / 'project.db').as_posix()}"
    engine = create_engine(url, future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    return engine


def make_session_factory(engine):
    return sessionmaker(engine, class_=Session, expire_on_commit=False, future=True)
```

`migrations/env.py` uses `target_metadata = Base.metadata` and `render_as_batch=True` (SQLite), `configure_logging` disabled (no `fileConfig` call). `versions/0001_initial.py` is produced with `alembic revision --autogenerate -m initial` against a temporary SQLite file, then reviewed and committed. `alembic.ini` contains only `[alembic]` with `script_location = .`. `env.py` must import `app.db.models` so metadata is populated; add the backend root to `sys.path` at the top of `env.py` (`sys.path.insert(0, str(Path(__file__).resolve().parents[3]))`) so it also works when frozen.

- [ ] **Step 4: Implement the project registry and router**

`app/appdata.py`:

```python
import json
from datetime import datetime, timezone
from pathlib import Path


class AppData:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._recent = self.data_dir / "recent_projects.json"
        self._settings = self.data_dir / "settings.json"

    def recent(self) -> list[dict]:
        if not self._recent.exists():
            return []
        return json.loads(self._recent.read_text("utf-8"))

    def remember(self, project_id: str, name: str, folder: str) -> None:
        items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
        items.insert(0, {"id": project_id, "name": name, "folder": folder,
                         "last_opened_at": datetime.now(timezone.utc).isoformat()})
        self._recent.write_text(json.dumps(items[:20], indent=2), "utf-8")

    def read_settings(self) -> dict:
        return json.loads(self._settings.read_text("utf-8")) if self._settings.exists() else {}

    def write_settings(self, values: dict) -> None:
        self._settings.write_text(json.dumps(values, indent=2), "utf-8")
```

`app/projects/service.py`:

```python
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import new_id
from app.db.models import Project
from app.db.session import make_session_factory, open_project_db
from app.errors import AppError, not_found

SUBDIRS = ("images", "labels", "datasets", "runs", "models", "cache/thumbs")


class ProjectHandle:
    def __init__(self, id: str, folder: Path, engine):
        self.id, self.folder, self.engine = id, folder, engine
        self._factory = make_session_factory(engine)

    images_dir = property(lambda s: s.folder / "images")
    labels_dir = property(lambda s: s.folder / "labels")
    datasets_dir = property(lambda s: s.folder / "datasets")
    runs_dir = property(lambda s: s.folder / "runs")
    models_dir = property(lambda s: s.folder / "models")
    thumbs_dir = property(lambda s: s.folder / "cache" / "thumbs")

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def row(self, s: Session) -> Project:
        return s.execute(select(Project)).scalar_one()


def normalise_classes(classes: list[dict], existing: list[dict] | None = None) -> list[dict]:
    out, names, keys = [], set(), set()
    for i, c in enumerate(classes):
        name = c["name"].strip()
        if not name or name in names:
            raise AppError("validation_error", f"duplicate or empty class name {name!r}", 422)
        hotkey = c.get("hotkey") or None
        if hotkey and hotkey in keys:
            raise AppError("validation_error", f"duplicate hotkey {hotkey!r}", 422)
        names.add(name)
        if hotkey:
            keys.add(hotkey)
        out.append({"id": c.get("id") or new_id(), "name": name, "colour": c.get("colour") or "#4f46e5",
                    "hotkey": hotkey, "order": i})
    return out


class ProjectRegistry:
    def __init__(self, data_dir: Path):
        self.appdata = AppData(data_dir)
        self._handles: dict[str, ProjectHandle] = {}

    def create(self, name: str, folder: Path, classes: list[dict]) -> ProjectHandle:
        if (folder / "project.db").exists():
            raise AppError("already_exists", f"{folder} already contains a project", 409)
        for sub in SUBDIRS:
            (folder / sub).mkdir(parents=True, exist_ok=True)
        engine = open_project_db(folder)
        row = Project(name=name, classes=normalise_classes(classes))
        with make_session_factory(engine)() as s:
            s.add(row)
            s.commit()
            pid = row.id
        return self._cache(pid, folder, engine, name)

    def open(self, folder: Path) -> ProjectHandle:
        if not (folder / "project.db").exists():
            raise not_found("project folder", str(folder))
        for h in self._handles.values():
            if h.folder == folder:
                return h
        engine = open_project_db(folder)
        with make_session_factory(engine)() as s:
            row = s.execute(select(Project)).scalar_one()
            pid, name = row.id, row.name
        return self._cache(pid, folder, engine, name)

    def _cache(self, pid, folder, engine, name) -> ProjectHandle:
        h = ProjectHandle(pid, folder, engine)
        self._handles[pid] = h
        self.appdata.remember(pid, name, str(folder))
        return h

    def get(self, project_id: str) -> ProjectHandle:
        if project_id in self._handles:
            return self._handles[project_id]
        for r in self.appdata.recent():
            if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                return self.open(Path(r["folder"]))
        raise not_found("project", project_id)

    def recent(self) -> list[dict]:
        return self.appdata.recent()

    def close_all(self) -> None:
        for h in self._handles.values():
            h.engine.dispose()
        self._handles.clear()


def get_project(projectId: str, request: Request) -> ProjectHandle:  # noqa: N803 (path param name from the contract)
    return request.app.state.projects.get(projectId)
```

`PUT /classes` validation beyond `normalise_classes`: a class present before and absent after the update that still has boxes is refused with `AppError("class_in_use", "class <name> still has <n> boxes; reassign or delete them first", 409, {"class_id": ..., "box_count": n})` (spec section 6, class changes never delete boxes).

`app/projects/schemas.py`: pydantic models `ClassDefInput` (`id: str | None`, `name: str`, `colour: str`, `hotkey: str | None`), `ClassDef` (adds `order: int`, `id: str`), `ProjectCreate` (`name`, `folder`, `classes: list[ClassDefInput]`), `ProjectOpen` (`folder`), `ProjectUpdate` (`name`, `preannotation_model_id`, `import_defaults`, all optional), `ProjectOut` (`id, name, folder, classes, preannotation_model_id, import_defaults, schema_version, created_at`) with `ProjectOut.from_row(row, folder)`; `ProjectStats` matching the contract (zeros in S0).

`app/projects/router.py` mounts `GET /projects` (returns `{items: recent, next_cursor: null}` where each item is loaded through `open` to produce a full `Project`; folders that no longer exist are skipped), `POST /projects` (201), `POST /projects/open`, `GET /projects/{projectId}`, `PATCH /projects/{projectId}`, `PUT /projects/{projectId}/classes`, `GET /projects/{projectId}/stats` (S0: returns zeros in the `ProjectStats` shape; S1 fills it).

- [ ] **Step 5: Run the tests**

Run: `.\.venv\Scripts\python -m pytest -q`
Expected: all pass; remove the `xfail` marks from `test_errors.py`.

- [ ] **Step 6: Commit**

```bash
git add backend && git commit -m "feat(backend): project store, sqlite models and alembic migration"
```

---

