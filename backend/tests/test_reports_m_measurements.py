"""The measurements section (reports spec §7.2; Rulings 8-9)."""

from data_rows import add_cloud, at
from mapmeasure_rows import add_cloud_measurement
from reports_m_rows import add_dem, add_geomap, make_ctx, map_measurement, ready_volume

from app.reports.sections import measurements

LINE = [[500010.0, 4982990.0], [500040.0, 4982960.0]]


def _kinds(doc):
    return [b.kind for b in doc.blocks]


def test_an_empty_project_says_so(handle):
    doc = measurements.compose(make_ctx(handle, "measurements"))
    assert doc.key == "measurements"
    assert [(b.kind, b.text, b.style) for b in doc.blocks] == [("para", "No measurements match.", "note")]


def test_one_table_per_kind_in_spec_order_then_figures(handle, monkeypatch):
    monkeypatch.setattr("app.reports.figures.cloud.measurement_figure", lambda ctx, row: _para(row.name))
    gm = add_geomap(handle, name="Sep")
    map_measurement(handle, kind="distance", vertices=LINE, map_id=gm, name="Fence", created_at=at(1))
    add_cloud_measurement(handle, add_cloud(handle), created_at=at(2), kind="vertical", name="Mast")
    ready_volume(handle, add_dem(handle), name="Pile 1")
    doc = measurements.compose(make_ctx(handle, "measurements"))
    headings = [b.text for b in doc.blocks if b.kind == "heading" and b.level == 2]
    assert headings == ["Lengths", "Lean (verticality)", "Volumes"]
    assert _kinds(doc).count("table") == 3 and _kinds(doc).count("volume") == 1
    assert _kinds(doc).count("figure") == 1  # the map distance; the cloud stub returned a para


def test_kinds_and_snapshots_options_are_honoured(handle):
    gm = add_geomap(handle, name="Sep")
    map_measurement(handle, kind="distance", vertices=LINE, map_id=gm)
    ready_volume(handle, add_dem(handle))
    doc = measurements.compose(make_ctx(handle, "measurements", kinds=["volume"], snapshots=False))
    assert _kinds(doc).count("table") == 1 and "figure" not in _kinds(doc)
    [vol] = [b for b in doc.blocks if b.kind == "volume"]
    assert vol.figure is None


def test_measurement_ids_limit_the_rows(handle):
    gm = add_geomap(handle, name="Sep")
    keep = map_measurement(handle, kind="distance", vertices=LINE, map_id=gm, name="Keep", created_at=at(1))
    map_measurement(handle, kind="distance", vertices=LINE, map_id=gm, name="Drop", created_at=at(2))
    doc = measurements.compose(make_ctx(handle, "measurements", measurement_ids=[keep]))
    [table] = [b for b in doc.blocks if b.kind == "table"]
    assert [r[0] for r in table.rows] == ["Keep"]


def test_a_stale_volumes_table_row_says_stale(handle):
    from app.db.models import VolumeMeasurement

    vid = ready_volume(handle, add_dem(handle))
    with handle.session() as s:
        s.get(VolumeMeasurement, vid).status = "stale"
    doc = measurements.compose(make_ctx(handle, "measurements", kinds=["volume"]))
    [table] = [b for b in doc.blocks if b.kind == "table"]
    assert table.rows[0][3] == "stale, recalculate"


def test_two_stale_volumes_warn_once_with_the_total(handle):
    from app.db.models import VolumeMeasurement

    sid = add_dem(handle)
    ids = [ready_volume(handle, sid, name=n) for n in ("Pile 1", "Pile 2")]
    with handle.session() as s:
        for vid in ids:
            s.get(VolumeMeasurement, vid).status = "stale"
    ctx = make_ctx(handle, "measurements", kinds=["volume"])
    measurements.compose(ctx)
    [w] = [w for w in ctx.warnings if w.code == "volume_stale"]
    assert w.count == 2 and w.message == "2 volume measurements are stale"


def test_a_current_volume_does_not_warn(handle):
    ready_volume(handle, add_dem(handle))
    ctx = make_ctx(handle, "measurements", kinds=["volume"])
    measurements.compose(ctx)
    assert not [w for w in ctx.warnings if w.code == "volume_stale"]


def test_the_section_opens_with_its_content_not_a_title_heading(handle):
    """R2's sections leave the section title to the renderer (section.title); no level-1 heading."""
    gm = add_geomap(handle, name="Sep")
    map_measurement(handle, kind="distance", vertices=LINE, map_id=gm)
    doc = measurements.compose(make_ctx(handle, "measurements"))
    assert not [b for b in doc.blocks if b.kind == "heading" and b.level == 1]
    assert doc.blocks[0].kind == "heading" and doc.blocks[0].text == "Lengths"


def _para(text):
    from app.reports.schemas import Para

    return Para(text=text, style="body")
