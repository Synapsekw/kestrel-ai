"""R3: the volume plan snapshot reuses the volume export's plan image unchanged (spec §9.1, §16),
and the R9 stubs answer as placeholders until R9-I / R9-C replace them."""

import io
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage
from report_snapshot_helpers import ns
from surfaces import CX, CY, circle, cone, fixture_spec, plane
from volume_rows import add_surface

from app.db.models import VolumeMeasurement
from app.reports.snapshots import SnapshotUnavailable, volume_plan
from app.volumes import jobs_export

BASE = "/api/v1/projects"


@pytest.fixture
def measurement(client, wait_job, project_id, handle) -> str:
    top = add_surface(handle, fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y), name="April")
    body = {
        "name": "Pile north",
        "polygon_native": circle(CX, CY, 12.0),
        "top_surface_id": top,
        "base": {"kind": "toe_plane"},
    }
    res = client.post(f"{BASE}/{project_id}/volumes", json=body).json()
    assert wait_job(project_id, res["job"]["id"])["state"] == "succeeded"
    return res["measurement"]["id"]


def test_a_volume_plan_is_the_export_plan_letterboxed(handle, measurement):
    spec = ns(kind="volume_plan", measurement_id=measurement)
    assert not volume_plan.source_version(handle, spec).startswith("missing:")
    img = volume_plan.render(handle, spec)
    assert img.size == volume_plan.OUT == (1200, 900)

    # A15: pixel-exact against the export's own plan image, letterboxed through the same helper --
    # not only the size, so a drift in either the plan drawing or the letterbox math is caught.
    ctx = SimpleNamespace(project=handle)
    item = jobs_export._load(ctx, [measurement])[0]
    item.clutter_rings = jobs_export._clutter(ctx, item)
    png = jobs_export._plan(ctx, item)
    with PILImage.open(io.BytesIO(png)) as im:
        expected = volume_plan.fit_on_white(im.convert("RGB"), volume_plan.OUT)
    assert img.tobytes() == expected.tobytes()


def test_a_stale_volume_prints_the_recalculate_reason(handle, measurement):
    with handle.session() as s:
        s.get(VolumeMeasurement, measurement).status = "stale"
    spec = ns(kind="volume_plan", measurement_id=measurement)
    assert volume_plan.source_version(handle, spec) == f"missing:{volume_plan.STALE}"
    with pytest.raises(SnapshotUnavailable) as caught:
        volume_plan.render(handle, spec)
    assert caught.value.reason == volume_plan.STALE


def test_a_deleted_volume_is_unavailable(handle):
    spec = ns(kind="volume_plan", measurement_id="nope")
    assert volume_plan.source_version(handle, spec) == "missing:The volume measurement was deleted"
    with pytest.raises(SnapshotUnavailable, match="deleted"):
        volume_plan.render(handle, spec)


def test_a12_an_input_change_without_a_status_write_is_still_caught(handle, measurement):
    """A12: nudging an input (here, the polygon) changes `inputs_snapshot`'s fingerprint but never
    touches the stored `status` column directly -- only `service._refresh`, run inside
    `get_measurement`, flips `ready` -> `stale`. `source_version` must see that flip (not a raw,
    un-refreshed row), so the key it returns agrees with the placeholder `render` then raises."""
    with handle.session() as s:
        row = s.get(VolumeMeasurement, measurement)
        assert row.status == "ready"
        row.polygon_native = circle(CX, CY, 11.0)  # a different polygon -> a different fingerprint

    spec = ns(kind="volume_plan", measurement_id=measurement)
    assert volume_plan.source_version(handle, spec) == f"missing:{volume_plan.STALE}"
    with pytest.raises(SnapshotUnavailable) as caught:
        volume_plan.render(handle, spec)
    assert caught.value.reason == volume_plan.STALE

    with handle.session() as s:
        assert s.get(VolumeMeasurement, measurement).status == "stale"  # the refresh persisted it
