"""Project registry: opens project folders, owns their engines, tracks recent projects."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import new_id
from app.db.models import Box, Project
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


def normalise_classes(classes: list[dict]) -> list[dict]:
    out: list[dict] = []
    names: set[str] = set()
    keys: set[str] = set()
    for i, c in enumerate(classes):
        name = (c.get("name") or "").strip()
        if not name or name in names:
            raise AppError("validation_error", f"duplicate or empty class name {name!r}", 422)
        hotkey = c.get("hotkey") or None
        if hotkey and hotkey in keys:
            raise AppError("validation_error", f"duplicate hotkey {hotkey!r}", 422)
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
    def __init__(self, data_dir: Path):
        self.appdata = AppData(data_dir)
        self._handles: dict[str, ProjectHandle] = {}
        self._lock = threading.Lock()

    def create(self, name: str, folder: Path, classes: list[dict]) -> ProjectHandle:
        folder = folder.resolve()
        with self._lock:
            if (folder / "project.db").exists():
                raise AppError("already_exists", f"{folder} already contains a project", 409)
            for sub in SUBDIRS:
                (folder / sub).mkdir(parents=True, exist_ok=True)
            engine = open_project_db(folder)
            row = Project(
                name=name, classes=normalise_classes(classes), import_defaults=dict(DEFAULT_IMPORT_SETTINGS)
            )
            with make_session_factory(engine)() as s:
                s.add(row)
                s.commit()
                pid = row.id
            return self._cache(pid, folder, engine, name, remember=True)

    def open(self, folder: Path, remember: bool = True) -> ProjectHandle:
        """Open a project folder. `remember` moves it to the top of the recent list (a user action)."""
        folder = folder.resolve()
        if not (folder / "project.db").exists():
            raise not_found("project folder", str(folder))
        with self._lock:
            for h in self._handles.values():
                if h.folder == folder:
                    if remember:
                        self.appdata.remember(h.id, self._name(h), str(folder))
                    return h
            engine = open_project_db(folder)
            with make_session_factory(engine)() as s:
                row = s.execute(select(Project)).scalar_one()
                pid, name = row.id, row.name
            return self._cache(pid, folder, engine, name, remember)

    @staticmethod
    def _name(h: ProjectHandle) -> str:
        with h.session() as s:
            return h.row(s).name

    def _cache(self, pid: str, folder: Path, engine, name: str, remember: bool) -> ProjectHandle:
        h = ProjectHandle(pid, folder, engine)
        self._handles[pid] = h
        if remember:
            self.appdata.remember(pid, name, str(folder))
        return h

    def get(self, project_id: str) -> ProjectHandle:
        if project_id in self._handles:
            return self._handles[project_id]
        for r in self.appdata.recent():
            if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                return self.open(Path(r["folder"]), remember=False)
        raise not_found("project", project_id)

    def recent(self) -> list[dict]:
        return self.appdata.recent()

    def close_all(self) -> None:
        for h in self._handles.values():
            h.engine.dispose()
        self._handles.clear()


def get_project(projectId: str, request: Request) -> ProjectHandle:  # noqa: N803 - path param from the contract
    return request.app.state.projects.get(projectId)
