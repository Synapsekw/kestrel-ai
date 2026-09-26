"""Dry-run the foundation migration on copies of real project folders (foundation spec §11.5).

Nothing original is opened for writing. For each project folder the script copies `project.db`
(and its `-wal`/`-shm`) into a temporary folder, copies the app's `library.db` and `catalogue.db`
beside them, then runs the copy-first backup, the schema upgrade and every data step against the
copies, as the `project_migrate` job would, but in this process with no job runner. It prints
what each project went through and exits 1 if a project failed, a before/after invariant moved,
a backup was missing or bad, or an original file changed.

Close Kestrel AI first: a running app may be writing the originals' `-wal` while they are copied.

Usage (from backend\\):
  E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe scripts\\migration_dry_run.py --recent
      --folders E:\\Projects\\Ahmadia --out ..\\docs\\evidence\\foundation-migration\\dry-run.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from sqlalchemy import select  # noqa: E402

from app.db.models import Project  # noqa: E402
from app.db.session import current_revision, head_revision, open_project_db, project_script  # noqa: E402
from app.migration import steps  # noqa: E402
from app.migration.backup import latest_backup, needs_backup, quick_check  # noqa: E402
from app.migration.invariants import compare, snapshot  # noqa: E402
from app.migration.pipeline import TARGET_SCHEMA_VERSION, MigrationEnv, StepFailed, run_pipeline  # noqa: E402
from app.projects.service import ProjectHandle  # noqa: E402

DB_FILES = ("project.db", "project.db-wal", "project.db-shm")
STORE_FILES = ("library.db", "catalogue.db")
log = logging.getLogger("migration_dry_run")


def default_data_dir() -> Path:
    """The installed app's data folder: `APP_DATA_DIR` as the launcher sets it, else Tauri's."""
    if os.environ.get("APP_DATA_DIR"):
        return Path(os.environ["APP_DATA_DIR"])
    roaming = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return roaming / "ai.synapse-solutions.kestrel-ai"


def recent_folders(data_dir: Path) -> list[Path]:
    path = Path(data_dir) / "recent_projects.json"
    if not path.exists():
        return []
    items = json.loads(path.read_text("utf-8"))
    return [Path(r["folder"]) for r in items if isinstance(r, dict) and r.get("folder")]


def fingerprint(folder: Path) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for name in DB_FILES:
        p = Path(folder) / name
        if p.is_file():
            with p.open("rb") as f:
                out[name] = hashlib.file_digest(f, "sha256").hexdigest()
        else:
            out[name] = None
    return out


def copy_app_stores(data_dir: Path, work: Path) -> Path:
    """Copy library.db and catalogue.db (with -wal/-shm) into `<work>/appdata/library`."""
    appdata = work / "appdata"
    lib = appdata / "library"
    lib.mkdir(parents=True, exist_ok=True)
    for db in STORE_FILES:
        for suffix in ("", "-wal", "-shm"):
            src = Path(data_dir) / "library" / f"{db}{suffix}"
            if src.is_file():
                shutil.copy2(src, lib / src.name)
    return appdata


def open_stores(appdata: Path):
    """The library (and, once unit BC has landed, the catalogue) opened on the copies."""
    from app.library.handle import open_library

    return open_library(appdata), None


def project_checks(handle) -> dict:
    """Per-project facts the merge gate reads once the steps exist (Part B fills this in)."""
    return {}


def _handle(dest: Path, engine) -> ProjectHandle:
    from app.db.session import make_session_factory

    with make_session_factory(engine)() as s:
        row = s.execute(select(Project)).scalar_one()
        handle = ProjectHandle(row.id, dest, engine)
        handle.schema_version = row.schema_version
    return handle


def _print_progress(fraction: float, message: str = "") -> None:
    print(f"      {fraction * 100:5.1f}%  {message}", flush=True)


def dry_run_one(folder: Path, dest: Path, library, catalogue) -> dict:
    folder = Path(folder)
    result: dict = {
        "folder": str(folder),
        "ok": False,
        "error": None,
        "steps": [],
        "warnings": [],
        "mismatches": [],
        "checks": {},
        "backup": None,
    }
    t0 = time.monotonic()
    before_hash = fingerprint(folder)
    engine = None
    try:
        if before_hash["project.db"] is None:
            raise FileNotFoundError(f"{folder} has no project.db")
        dest.mkdir(parents=True)
        for name in DB_FILES:
            if (folder / name).is_file():
                shutil.copy2(folder / name, dest / name)
        result["revision_before"] = current_revision(dest)
        result["backup_expected"] = needs_backup(result["revision_before"], project_script())
        before = snapshot(dest / "project.db")
        engine = open_project_db(dest)
        result["revision_after"] = current_revision(dest)
        backup = latest_backup(dest)
        if backup is not None:
            result["backup"] = {"path": str(backup), "quick_check": quick_check(backup)}
        handle = _handle(dest, engine)
        if steps.PIPELINE and handle.schema_version < TARGET_SCHEMA_VERSION:
            env = MigrationEnv(
                library=library, catalogue=catalogue, origin_folder=folder, log=log, progress=_print_progress
            )
            report = run_pipeline(handle, env, steps.PIPELINE)
            result["steps"], result["warnings"] = report["steps"], report["warnings"]
        with handle.session() as s:
            result["schema_version_after"] = handle.row(s).schema_version
        result["checks"] = project_checks(handle) if steps.PIPELINE else {}
        engine.dispose()
        engine = None
        result["mismatches"] = compare(before, snapshot(dest / "project.db"))
        backup_good = result["backup"] is not None and result["backup"]["quick_check"] == "ok"
        result["ok"] = not result["mismatches"] and (backup_good or not result["backup_expected"])
        if result["backup_expected"] and not backup_good:
            result["error"] = "the backup is missing or failed its check"
    except StepFailed as e:
        result["error"] = f"step {e.step} failed: {e.message}"
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        if engine is not None:
            engine.dispose()
        result["originals_unchanged"] = fingerprint(folder) == before_hash
        result["ok"] = bool(result["ok"] and result["originals_unchanged"])
        result["seconds"] = round(time.monotonic() - t0, 3)
    return result


def summarise_stores(library, catalogue) -> dict:
    """App-wide facts the merge gate reads once the steps exist (Part B fills this in)."""
    return {}


def dry_run(folders, data_dir: Path, work: Path) -> dict:
    unique, seen = [], set()
    for f in folders:
        key = str(Path(f).resolve()).lower()
        if key not in seen:
            seen.add(key)
            unique.append(Path(f))
    work.mkdir(parents=True, exist_ok=True)
    library, catalogue = open_stores(copy_app_stores(Path(data_dir), work))
    try:
        results = []
        for i, folder in enumerate(unique):
            print(f"-> {folder}", flush=True)
            results.append(dry_run_one(folder, work / f"project-{i:02d}", library, catalogue))
        stores = summarise_stores(library, catalogue)
    finally:
        for store in (library, catalogue):
            if store is not None:
                store.engine.dispose()
    return {
        "armed": bool(steps.PIPELINE),
        "head": head_revision(),
        "data_dir": str(data_dir),
        "ok": bool(results) and all(r["ok"] for r in results),
        "projects": results,
        "stores": stores,
    }


def print_report(report: dict) -> None:
    print(f"head {report['head']}  armed {report['armed']}  data {report['data_dir']}")
    for p in report["projects"]:
        tag = "[ok]" if p["ok"] else "[FAILED]"
        backup = (p.get("backup") or {}).get("quick_check", "none")
        print(
            f"{tag} {p['folder']}  {p.get('revision_before')} -> {p.get('revision_after')}"
            f"  v{p.get('schema_version_after')}  {p['seconds']} s  backup {backup}"
        )
        for step in p["steps"]:
            detail = {k: v for k, v in (step.get("detail") or {}).items() if k != "warnings"}
            print(f"     {step['name']}{' (skipped)' if step.get('skipped') else ''}  {json.dumps(detail)}")
        for key, value in p["checks"].items():
            print(f"     check {key}: {value}")
        for w in p["warnings"]:
            print(f"     warning: {w}")
        for m in p["mismatches"]:
            print(f"     MISMATCH {m}")
        if not p["originals_unchanged"]:
            print("     AN ORIGINAL FILE CHANGED")
        if p["error"]:
            print(f"     error: {p['error']}")
    for key, value in (report.get("stores") or {}).items():
        print(f"store {key}: {json.dumps(value)}")
    print("PASS" if report["ok"] else "FAIL")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--recent", action="store_true", help="every folder in the app's recent list")
    parser.add_argument("--folders", nargs="*", default=[], help="more project folders")
    parser.add_argument("--data-dir", type=Path, default=None, help="the app-data folder to copy stores from")
    parser.add_argument("--out", type=Path, default=None, help="write the JSON report here")
    parser.add_argument(
        "--work-dir", type=Path, default=None, help="where the copies go (default: a temp dir)"
    )
    parser.add_argument("--keep", action="store_true", help="keep the copies after the run")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    data_dir = args.data_dir or default_data_dir()
    folders = (recent_folders(data_dir) if args.recent else []) + [Path(f) for f in args.folders]
    work = args.work_dir or Path(tempfile.mkdtemp(prefix="kestrel-dry-run-"))
    try:
        report = dry_run(folders, data_dir, work)
    finally:
        if not args.keep and args.work_dir is None:
            shutil.rmtree(work, ignore_errors=True)
    print_report(report)
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2, default=str), "utf-8")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
