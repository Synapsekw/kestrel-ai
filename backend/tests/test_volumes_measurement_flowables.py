"""R4 hands the volume pages to reports as the public `measurement_flowables` (spec §10.2), unchanged."""

from datetime import UTC, datetime

from reportlab.platypus import Paragraph
from test_volumes_writers import _item

from app.volumes import report_pdf


def test_measurement_flowables_builds_the_measurement_pages():
    flow = report_pdf.measurement_flowables(_item())
    assert isinstance(flow[0], Paragraph) and flow[0].getPlainText() == "Pile & 1"
    assert len(flow) > 5


def test_the_private_name_is_gone():
    assert not hasattr(report_pdf, "_measurement")


def test_story_goes_through_the_public_name(monkeypatch):
    seen = []
    monkeypatch.setattr(report_pdf, "measurement_flowables", lambda item: seen.append(item.name) or [])
    report_pdf.story([_item()], title="T", project_name="P", generated_at=datetime(2026, 9, 24, tzinfo=UTC))
    assert seen == ["Pile & 1"]
