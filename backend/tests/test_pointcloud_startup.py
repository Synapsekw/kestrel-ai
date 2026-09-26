"""The startup sweep (spec §3): interrupted imports fail, .work and partial octrees go."""

from pointclouds import insert_cloud

from app.pointclouds import startup


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


def test_a_folder_with_no_row_goes(handle):
    """Final review B6: delete's rmtree can miss a folder Windows held open; the next start removes it."""
    kept = insert_cloud(handle)
    base = handle.folder / "pointclouds"
    (base / kept / "octree").mkdir(parents=True)
    (base / "gone-cloud" / "octree").mkdir(parents=True)
    (base / "gone-cloud" / "octree" / "octree.bin").write_bytes(b"x")
    startup.sweep_interrupted(handle, Runner())
    assert (base / kept / "octree").exists() and not (base / "gone-cloud").exists()


def test_an_orphan_that_cannot_be_removed_logs_and_continues(handle, monkeypatch, caplog):
    base = handle.folder / "pointclouds"
    for name in ("stuck", "other"):
        (base / name).mkdir(parents=True)
    real = startup.shutil.rmtree

    def rmtree(path, *a, **k):
        if startup.Path(path).name == "stuck":
            raise PermissionError(32, "The process cannot access the file", str(path))
        return real(path, *a, **k)

    monkeypatch.setattr(startup.shutil, "rmtree", rmtree)
    startup.sweep_interrupted(handle, Runner())
    assert (base / "stuck").exists() and not (base / "other").exists()
    assert "stuck" in caplog.text


def test_no_folder_is_touched_when_the_database_pass_fails(handle, monkeypatch, caplog):
    """If the rows could not be read, a live import's .work (or its whole folder) must not be taken."""
    live = insert_cloud(handle, status="importing", job_id="j-live")
    base = handle.folder / "pointclouds"
    (base / live / ".work").mkdir(parents=True)
    (base / "no-row" / ".work").mkdir(parents=True)

    def broken():
        raise RuntimeError("database is locked")

    monkeypatch.setattr(handle, "session", broken)
    assert startup.sweep_interrupted(handle, Runner(live=["j-live"])) == []
    assert (base / live / ".work").exists() and (base / "no-row" / ".work").exists()
    assert "could not mark interrupted point-cloud imports" in caplog.text
