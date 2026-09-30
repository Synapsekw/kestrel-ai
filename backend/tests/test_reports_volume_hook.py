"""R5 wires R4's volume hook to the existing volume pages (index: `volume` block)."""

from types import SimpleNamespace

from PIL import Image as PILImage
from reportlab.platypus import Paragraph

from app.reports import volume_hook


def _texts(flowables) -> str:
    return " ".join(f.getPlainText() for f in flowables if isinstance(f, Paragraph))


def _block(**over):
    base = {"measurement_id": "m1", "title": "Pile 1", "rows": [], "figure": None, "stale": False}
    return SimpleNamespace(**(base | over))


def test_a_stale_block_prints_stale_recalculate(handle):
    out = volume_hook.volume_flowables_for(handle, lambda ref: None)(_block(stale=True))
    assert "Pile 1" in _texts(out) and "stale, recalculate" in _texts(out)


def test_a_missing_measurement_prints_stale_instead_of_failing(handle):
    out = volume_hook.volume_flowables_for(handle, lambda ref: None)(_block(measurement_id="gone"))
    assert "stale, recalculate" in _texts(out)


def test_a_ready_measurement_uses_the_volume_pages_with_the_snapshot_jpeg(handle, tmp_path, monkeypatch):
    from test_volumes_writers import _item

    jpeg = tmp_path / "plan.jpg"
    PILImage.new("RGB", (40, 30), "grey").save(jpeg, "JPEG")
    seen = {}

    def fake_flowables(item):
        seen["plan"] = item.plan_png
        return ["volume pages"]

    monkeypatch.setattr("app.volumes.jobs_export._load", lambda ctx, ids: [_item()])
    monkeypatch.setattr("app.volumes.report_pdf.measurement_flowables", fake_flowables)
    figure = SimpleNamespace(snapshot=SimpleNamespace(key="k"))
    out = volume_hook.volume_flowables_for(handle, lambda ref: jpeg)(_block(figure=figure))
    assert out == ["volume pages"] and seen["plan"] == jpeg.read_bytes()


def test_an_unmapped_snapshot_keeps_the_items_own_plan(handle, monkeypatch):
    """Ruling P7: `snapshot_path` returns `None` for an unmapped/failed snapshot; the hook must not
    read bytes and must leave the item's own `plan_png` as `jobs_export._load` gave it."""
    from test_volumes_writers import _item

    item = _item()
    item.plan_png = b"already-rendered-by-the-export-job"
    seen = {}

    def fake_flowables(item):
        seen["plan"] = item.plan_png
        return ["volume pages"]

    monkeypatch.setattr("app.volumes.jobs_export._load", lambda ctx, ids: [item])
    monkeypatch.setattr("app.volumes.report_pdf.measurement_flowables", fake_flowables)
    figure = SimpleNamespace(snapshot=SimpleNamespace(key="k"))
    out = volume_hook.volume_flowables_for(handle, lambda ref: None)(_block(figure=figure))
    assert out == ["volume pages"]
    assert seen["plan"] == b"already-rendered-by-the-export-job"
