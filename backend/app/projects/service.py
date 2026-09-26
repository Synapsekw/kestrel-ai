"""Project registry: opens project folders, owns their engines, tracks recent projects."""

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import new_id
from app.db.models import Box, Job, Project
from app.db.session import make_session_factory, open_project_db
from app.errors import AppError, not_found

SUBDIRS = ("images", "labels", "datasets", "runs", "models", "cache/thumbs")
DEFAULT_IMPORT_SETTINGS = {
    "max_side": 4000,
    "quality": 95,
    "dedupe_threshold": 4,
    "group_regex": r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)",
}
DEFAULT_COLOUR = "#4f46e5"

log = logging.getLogger(__name__)


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
    exports_dir = property(lambda s: s.folder / "exports")
    maps_dir = property(lambda s: s.folder / "maps")
    pointclouds_dir = property(lambda s: s.folder / "pointclouds")
    surfaces_dir = property(lambda s: s.folder / "surfaces")
    volumes_dir = property(lambda s: s.folder / "volumes")

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


def normalise_classes(classes: list[dict]) -> list[dict]:
    out: list[dict] = []
    names: set[str] = set()
    keys: set[str] = set()
    for i, c in enumerate(classes):
        # 409, not 422: duplicates and names that are blank only to Python's strip() match the
        # schema, and a schema-valid body must not be answered 422 (see tests/test_contract.py).
        name = (c.get("name") or "").strip()
        if not name:
            raise AppError("conflict", "A class name cannot be blank.", 409)
        if name in names:
            raise AppError("conflict", f"Two classes are called {name}. Class names must be unique.", 409)
        hotkey = c.get("hotkey") or None
        if hotkey and hotkey in keys:
            raise AppError("conflict", f"Two classes use the hotkey {hotkey}.", 409)
        names.add(name)
        if hotkey:
            keys.add(hotkey)
        out.append(
            {
                "id": c.get("id") or new_id(),
                "name": name,
                "colour": c.get("colour") or DEFAULT_COLOUR,
                "hotkey": hotkey,
                "order": i,
            }
        )
    return out


def check_removed_classes_unused(s: Session, before: list[dict], after: list[dict]) -> None:
    kept = {c["id"] for c in after}
    for c in before:
        if c["id"] in kept:
            continue
        n = s.execute(select(func.count()).select_from(Box).where(Box.class_id == c["id"])).scalar_one()
        if n:
            raise AppError(
                "class_in_use",
                f"class {c['name']!r} still has {n} boxes; reassign or delete them first",
                409,
                {"class_id": c["id"], "box_count": n},
            )


class ProjectRegistry:
    def __init__(self, data_dir: Path, on_open: Callable[[ProjectHandle], None] | None = None):
        """`on_open` runs once per project, the moment it becomes live in this process."""
        self.appdata = AppData(data_dir)
        self.on_open = on_open
        self._handles: dict[str, ProjectHandle] = {}
        self._lock = threading.Lock()

    def create(self, name: str, folder: Path, classes: list[dict], kind: str) -> ProjectHandle:
        folder = folder.resolve()
        with self._lock:
            if (folder / "project.db").exists():
                raise AppError("already_exists", f"{folder} already contains a project", 409)
            for sub in SUBDIRS:
                (folder / sub).mkdir(parents=True, exist_ok=True)
            engine = open_project_db(folder)
            row = Project(
                name=name,
                kind=kind,
                classes=normalise_classes(classes),
                import_defaults=dict(DEFAULT_IMPORT_SETTINGS),
            )
            with make_session_factory(engine)() as s:
                s.add(row)
                s.commit()
                pid = row.id
            return self._cache(pid, folder, engine, name, kind, remember=True)

    def open(self, folder: Path, remember: bool = True) -> ProjectHandle:
        """Open a project folder. `remember` moves it to the top of the recent list (a user action)."""
        folder = folder.resolve()
        if not (folder / "project.db").exists():
            raise not_found("project folder", str(folder))
        with self._lock:
            for h in self._handles.values():
                if h.folder == folder:
                    if remember:
                        name, kind = self._name_and_kind(h)
                        self.appdata.remember(h.id, name, str(folder), kind)
                    return h
            engine = open_project_db(folder)
            with make_session_factory(engine)() as s:
                row = s.execute(select(Project)).scalar_one()
                pid, name, kind = row.id, row.name, row.kind
            return self._cache(pid, folder, engine, name, kind, remember)

    @staticmethod
    def _name_and_kind(h: ProjectHandle) -> tuple[str, str]:
        with h.session() as s:
            row = h.row(s)
            return row.name, row.kind

    def _cache(self, pid: str, folder: Path, engine, name: str, kind: str, remember: bool) -> ProjectHandle:
        h = ProjectHandle(pid, folder, engine)
        self._handles[pid] = h
        if remember:
            self.appdata.remember(pid, name, str(folder), kind)
        if self.on_open is not None:
            try:
                self.on_open(h)
            except Exception:  # opening the project is what the operator asked for
                log.exception("on_open hook failed for project %s at %s", pid, folder)
        return h

    def get(self, project_id: str) -> ProjectHandle:
        if project_id in self._handles:
            return self._handles[project_id]
        for r in self.appdata.recent():
            if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                return self.open(Path(r["folder"]), remember=False)
        raise not_found("project", project_id)

    def forget(self, project_id: str) -> None:
        """Drop the project from the recent list and close it. Nothing in its folder is touched."""
        h = self.get(project_id)
        with h.session() as s:
            active = s.execute(
                select(func.count()).select_from(Job).where(Job.state.in_(("queued", "running")))
            ).scalar_one()
        if active:
            raise AppError("conflict", f"{active} job(s) still run in this project; cancel them first", 409)
        with self._lock:
            self._handles.pop(project_id, None)
            h.engine.dispose()
        self.appdata.forget(str(h.folder))

    def recent(self) -> list[dict]:
        return self.appdata.recent()

    def close_all(self) -> None:
        with self._lock:
            for h in self._handles.values():
                h.engine.dispose()
            self._handles.clear()


def get_project(projectId: str, request: Request) -> ProjectHandle:  # noqa: N803 - path param from the contract
    return request.app.state.projects.get(projectId)
