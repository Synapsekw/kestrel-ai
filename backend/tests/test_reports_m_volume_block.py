"""A volume in the report (index `volume` block; spec §16 "stale, recalculate"; Ruling 9)."""

from reports_m_rows import add_dem, add_geomap, make_ctx, ready_volume

from app.db.models import MapRun, VolumeMeasurement
from app.reports.sections import volume_block


def _kv(block) -> dict:
    return {k: v for k, v in block.rows}


def test_a_current_volume_prints_its_numbers_and_its_plan(handle):
    vid = ready_volume(handle, add_dem(handle), net=12.5)
    b = volume_block.volume_block(make_ctx(handle), vid, with_figure=True)
    assert b.stale is False and b.title == "Pile 1" and b.measurement_id == vid
    kv = _kv(b)
    assert kv["Net"] == "12.5 m³" and kv["Stockpile volume (above base)"] == "13.5 m³"
    assert kv["Base"] == "Stockpile toe — plane" and kv["Top surface"] == "DSM 1 Sep"
    assert b.figure.snapshot.spec.kind == "volume_plan"


def test_without_snapshots_there_is_no_figure(handle):
    vid = ready_volume(handle, add_dem(handle))
    assert volume_block.volume_block(make_ctx(handle), vid, with_figure=False).figure is None


def test_a_stale_row_prints_stale_recalculate_and_no_numbers(handle):
    vid = ready_volume(handle, add_dem(handle))
    with handle.session() as s:
        s.get(VolumeMeasurement, vid).status = "stale"
    b = volume_block.volume_block(make_ctx(handle), vid, with_figure=True)
    assert b.stale is True and _kv(b)["Status"] == "stale, recalculate"
    assert "Net" not in _kv(b) and b.figure is None


def test_a_ready_row_whose_inputs_changed_is_stale(handle):
    vid = ready_volume(handle, add_dem(handle))
    map_id = add_geomap(handle, name="x")
    with handle.session() as s:
        run = MapRun(map_id=map_id, kind="local_model", conf=0.25, counts={})
        s.add(run)
        s.flush()
        s.get(VolumeMeasurement, vid).masks = {"detection_run_ids": [run.id]}
    b = volume_block.volume_block(make_ctx(handle), vid, with_figure=True)
    assert b.stale is True and _kv(b)["Status"] == "stale, recalculate"
    with handle.session() as s:
        assert s.get(VolumeMeasurement, vid).status == "ready"  # compose never writes


def test_calculating_and_failed_rows_are_stale_with_a_reason(handle):
    vid = ready_volume(handle, add_dem(handle))
    with handle.session() as s:
        row = s.get(VolumeMeasurement, vid)
        row.status, row.error = "failed", "no data under the polygon"
    b = volume_block.volume_block(make_ctx(handle), vid, with_figure=True)
    assert b.stale is True and _kv(b)["Why"] == "failed: no data under the polygon"


def test_a_deleted_measurement_is_a_stale_placeholder(handle):
    b = volume_block.volume_block(make_ctx(handle), "gone", with_figure=True)
    assert b.stale is True and b.title == "Deleted measurement"
