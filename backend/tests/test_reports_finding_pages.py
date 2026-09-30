"""Per-finding pages (spec §7.3): one finding block per finding, hooks per option (plan R2 Task 4)."""

from datetime import UTC, datetime

import pytest
from reports_rows import add_cloud, add_findings, add_type, config, ctx_for

from app.db.models import FindingComment
from app.reports import blocks
from app.reports.figures import cloud, image
from app.reports.sections import finding_pages


@pytest.fixture
def three(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(
        handle,
        [
            {
                "type_id": t,
                "severity": 3,
                "anchor": "cloud",
                "target": c,
                "note": "Wide crack",
                "lon": 15.5,
                "lat": 45.25,
            },
            {
                "type_id": t,
                "severity": None,
                "anchor": "cloud",
                "target": c,
                "created_by": "model:m1",
                "confidence": 0.87,
            },
            {"type_id": t, "severity": 1, "anchor": "cloud", "target": c},
        ],
    )
    return c


def _cfg(**opts):
    return config(sections=("finding_pages",), options={"finding_pages": opts})


def test_one_block_per_finding_in_number_order(handle, three):
    doc = finding_pages.compose(ctx_for(handle, _cfg()))
    dumped = [b.model_dump(mode="json") for b in doc.blocks]
    assert [d["kind"] for d in dumped] == ["finding"] * 3
    assert [d["number"] for d in dumped] == [1, 2, 3]
    first, second = dumped[0], dumped[1]
    assert first["head"]["severity_level"] == 3 and first["head"]["severity_name"] == "Major"
    assert "severity_level" not in second["head"] or second["head"]["severity_level"] is None
    assert second["head"]["severity_name"] == "Ungraded"
    assert first["note"] == "Wide crack"
    kv = dict(map(tuple, first["kv"]))
    assert kv["Data item"] == "Scan" and kv["Coordinates (WGS84)"] == "45.250000, 15.500000"
    assert dict(map(tuple, second["kv"]))["Created by"] == "model:m1 (0.87)"


def test_hooks_follow_the_options(handle, three, monkeypatch):
    calls = []
    fig = lambda ctx, row: [  # noqa: E731
        blocks.figure(
            ctx.ref(
                {"kind": "view3d", "subject_kind": "finding", "subject_id": row.id, "cloud_id": three},
                width_px=1600,
                height_px=1000,
            ),
            "3D",
            170,
            105,
        )
    ]
    monkeypatch.setattr(cloud, "finding_figures", fig)
    monkeypatch.setattr(image, "photos", lambda ctx, row, n: calls.append(("photos", n)) or [])
    monkeypatch.setattr(
        image,
        "comments",
        lambda ctx, row, mode: (
            calls.append(("comments", mode))
            or [{"author": "D", "text": "seen", "created_at": "2026-09-24T10:00:00Z"}]
        ),
    )
    ctx = ctx_for(handle, _cfg(snapshots=["cloud"], photos_max=0, comments="last"))
    b = finding_pages.compose(ctx).blocks[0].model_dump(mode="json")
    assert len(b["figures"]) == 1 and b["comments"][0]["text"] == "seen"
    assert ("photos", 0) not in calls and ("comments", "last") in calls
    ctx = ctx_for(handle, _cfg(snapshots=["image", "map"], photos_max=4, comments="none"))
    b = finding_pages.compose(ctx).blocks[0].model_dump(mode="json")
    assert b["figures"] == [] and ("photos", 4) in calls


def test_no_findings_is_one_note(handle):
    doc = finding_pages.compose(ctx_for(handle, _cfg()))
    assert [b.model_dump() for b in doc.blocks] == [blocks.para(blocks.EMPTY, style="note").model_dump()]


def test_pages_of_fifty_over_201_findings(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": c} for _ in range(201)])
    ctx = ctx_for(handle, _cfg())
    seen, cursor, pages = [], None, 0
    while True:
        items, cursor = finding_pages.page(ctx, cursor, 50)
        seen += [b.number for b in items]
        pages += 1
        if cursor is None:
            break
    assert pages == 5 and seen == list(range(1, 202))
    stats = finding_pages.outline(ctx)
    assert (stats.block_count, stats.estimated_pages) == (201, 201)


def test_outline_calls_figure_warning_hooks(handle, three, monkeypatch):
    monkeypatch.setattr(
        cloud,
        "warnings",
        lambda ctx: ctx.warn("no_view", "3 findings have no 3D view", count=3),
        raising=False,
    )
    ctx = ctx_for(handle, _cfg(snapshots=["cloud"]))
    finding_pages.outline(ctx)
    assert [w.code for w in ctx.warnings] == ["no_view"]


def test_fingerprint_moves_with_comments(handle, three):
    ctx = ctx_for(handle, _cfg())
    before = finding_pages.fingerprint(ctx)
    fid = next(iter(finding_pages.findings_page(ctx, "number", None, 1)[0])).id
    with handle.session() as s:
        s.add(
            FindingComment(finding_id=fid, author="D", text="x", created_at=datetime(2026, 9, 25, tzinfo=UTC))
        )
    assert finding_pages.fingerprint(ctx) != before


def test_a_figure_module_fingerprint_joins_the_etag(handle, three, monkeypatch):
    ctx = ctx_for(handle, _cfg(snapshots=["cloud"]))
    monkeypatch.setattr(cloud, "fingerprint", lambda ctx: "a", raising=False)
    a = finding_pages.fingerprint(ctx)
    monkeypatch.setattr(cloud, "fingerprint", lambda ctx: "b", raising=False)
    assert finding_pages.fingerprint(ctx) != a


def test_the_image_fingerprint_joins_when_photos_or_comments_print(handle, three, monkeypatch):
    ctx = ctx_for(handle, _cfg(snapshots=[], photos_max=0, comments="none"))
    other = ctx_for(handle, _cfg(snapshots=[], photos_max=2, comments="none"))
    monkeypatch.setattr(image, "fingerprint", lambda ctx: "a", raising=False)
    a, oa = finding_pages.fingerprint(ctx), finding_pages.fingerprint(other)
    monkeypatch.setattr(image, "fingerprint", lambda ctx: "b", raising=False)
    assert finding_pages.fingerprint(ctx) == a  # image output is off: its hook does not run
    assert finding_pages.fingerprint(other) != oa
