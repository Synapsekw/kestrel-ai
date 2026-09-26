"""The dry run over the operator's real project folders (foundation spec §11.5).

Opt-in: set KESTREL_REAL_PROJECTS to the folders, separated by ';' (os.pathsep on Windows), and
optionally KESTREL_REAL_DATA_DIR to the app-data folder (default: the installed app's). It is
skipped otherwise. Everything runs on copies in a temp folder; the originals are only read.
"""

import os
from pathlib import Path

import pytest
from migration_helpers import load_script

pytestmark = pytest.mark.real_data
FOLDERS = [Path(p) for p in os.environ.get("KESTREL_REAL_PROJECTS", "").split(os.pathsep) if p.strip()]


@pytest.mark.skipif(not FOLDERS, reason="KESTREL_REAL_PROJECTS is not set")
def test_every_real_project_upgrades_on_a_copy(tmp_path):
    mod = load_script("migration_dry_run")
    data_dir = Path(os.environ.get("KESTREL_REAL_DATA_DIR") or mod.default_data_dir())
    report = mod.dry_run(FOLDERS, data_dir, tmp_path)
    failures = [(p["folder"], p["error"], p["mismatches"]) for p in report["projects"] if not p["ok"]]
    assert not failures, failures
    assert all(p["originals_unchanged"] for p in report["projects"])
