"""The startup sweep (spec §3): interrupted imports fail, .work and partial octrees go."""

import pytest
from pointclouds import insert_cloud

from app.pointclouds import startup


@pytest.fixture
def project_kind() -> str:
    return "detect"


class Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def test_interrupted_import_fails_and_its_folders_go(handle):
    dead = insert_cloud(handle, status="importing", job_id="j-dead")
    live = insert_cloud(handle, status="importing", job_id="j-live")
    ready = insert_cloud(handle)
    base = handle.folder / "pointclouds"
    for cid in (dead, live, ready):
        (base / cid / ".work").mkdir(parents=True)
        (base / cid / "octree").mkdir(parents=True)
    swept = startup.sweep_interrupted(handle, Runner(live=["j-live"]))
    assert swept == [dead]
    from app.pointclouds import rows

    d = rows.get_cloud(handle, dead)
    assert (d.status, d.error) == (
        "failed",
        "import interrupted by application restart; import the file again",
    )
    assert not (base / dead / ".work").exists() and not (base / dead / "octree").exists()
    assert (base / live / ".work").exists() and (base / live / "octree").exists()
    assert not (base / ready / ".work").exists() and (base / ready / "octree").exists()


def test_a_missing_folder_is_fine(handle):
    assert startup.sweep_interrupted(handle, Runner()) == []
