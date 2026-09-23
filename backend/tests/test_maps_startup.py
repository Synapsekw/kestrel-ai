"""An import a crash left in `importing` becomes `failed`, and the app still opens (spec 3)."""

from app.db.models import GeoMap
from app.maps.startup import INTERRUPTED_IMPORT, map_dir, map_raster_path, sweep_interrupted_imports


class _Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def _add_map(handle, status, job_id):
    with handle.session() as s:
        row = GeoMap(
            name="m",
            status=status,
            source_path="x.tif",
            source_size=1,
            source_sha256="",
            width=10,
            height=10,
            band_count=3,
            dtype="uint8",
            job_id=job_id,
        )
        s.add(row)
        s.flush()
        return row.id


def test_orphaned_import_is_failed(handle):
    stuck = _add_map(handle, "importing", "job-dead")
    ready = _add_map(handle, "ready", "job-old")
    assert sweep_interrupted_imports(handle, _Runner()) == [stuck]
    with handle.session() as s:
        assert s.get(GeoMap, stuck).status == "failed"
        assert s.get(GeoMap, stuck).error == INTERRUPTED_IMPORT
        assert s.get(GeoMap, ready).status == "ready"


def test_import_this_process_owns_is_left_alone(handle):
    live = _add_map(handle, "importing", "job-live")
    assert sweep_interrupted_imports(handle, _Runner(live={"job-live"})) == []
    with handle.session() as s:
        assert s.get(GeoMap, live).status == "importing"


def test_paths(handle):
    assert map_dir(handle, "abc") == handle.folder / "maps" / "abc"
    assert map_raster_path(handle, "abc") == handle.folder / "maps" / "abc" / "map.tif"
