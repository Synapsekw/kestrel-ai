"""The asset_sightings CSV (spec 2026-10-02-asset-findings §10, §12 "CSV: byte-exact against a
fixture"): the kit's records.csv_text, byte for byte."""

# ruff: noqa: E501
from pathlib import Path

import pytest
from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose, add_review
from reports_rows import add_type, config, ctx_for

from app.asset_review.derive import derive
from app.reports import render_job
from app.reports.writers import asset_csv, asset_rows

FIXTURE = Path(__file__).parent / "data" / "reports" / "asset_sightings.csv"
ROWS = [
    ["F01", "F-0007", "img-1", "DJI_0001.JPG", 2, "Moderate", "Sealant failure", "Panel, east", "Level 07", "41.20",
     "West elevation", "268", "yes", "1.2500", 'Gap "wide", 3 mm', None, "1", "2026-02-14 10:22:31", 25.08, 55.14, 120.5],
    ["F02", "F-0007", "img-2", "DJI_0002.JPG", 1, "Minor", "Sealant failure", "", "", "", "Not placed", "", "no",
     "0.5000", "line one\nline two", None, "1", "2026-02-14 10:23:00", 25.081, 55.141, 121.0],
    ["", "", "img-3", "DJI_0003.JPG", "", "Uncertain", "", "", "", "38.00", "", "", "no", "0.0000", None, None, "2",
     "", None, None, None],
]  # fmt: skip


def test_the_writer_matches_the_fixture_byte_for_byte(tmp_path):
    out = tmp_path / "sightings.csv"
    assert asset_csv.write_asset_sightings(out, ROWS) == 3
    assert out.read_bytes() == FIXTURE.read_bytes()


def test_quoting_follows_the_kit_not_python_csv():
    assert asset_csv.q(None) == "" and asset_csv.q(2) == "2" and asset_csv.q(25.08) == "25.08"
    assert asset_csv.q('a"b') == '"a""b"' and asset_csv.q("a,b") == '"a,b"'
    assert asset_csv.q("a\rb") == "a\rb"  # the kit quotes on " , and \n only
    assert len(asset_csv.HEAD) == 21


def test_a_row_of_the_wrong_length_is_refused(tmp_path):
    with pytest.raises(ValueError):
        asset_csv.write_asset_sightings(tmp_path / "x.csv", [["F01"]])


def _seed(handle):
    crack = add_type(handle, "crack")
    mid, review, frame = add_asset_model(handle)
    a = add_asset_image(handle, name="DJI_0001.JPG")
    b = add_asset_image(handle, name="DJI_0002.JPG")
    c = add_asset_image(handle, name="DJI_0003.JPG", lat=None, lon=None, alt=None)
    add_pose(handle, a, mid, sequence="2")
    add_pose(handle, b, mid)
    add_pose(handle, c, mid, target=(0.0, 38.0, 0.0))
    add_review(handle, c, "uncertain", note="Glare")
    add_asset_finding(
        handle,
        mid,
        crack,
        severity=2,
        note="Open joint, east",
        sightings=[
            {
                "image_id": a,
                "center": (-5.0, 41.2, 0.5),
                "normal": (-1.0, 0.0, 0.0),
                "coverage": 0.0125,
                "part": "Panel",
            },
            {"image_id": b, "center": (-5.1, 30.0, 0.4), "normal": (-1.0, 0.0, 0.0), "coverage": 0.005},
        ],
    )
    add_asset_finding(
        handle, mid, crack, severity=1, placement="none", sightings=[{"image_id": a, "placement": "none"}]
    )
    return mid, review, frame, (a, b, c)


def test_rows_from_the_project(handle):
    _, review, frame, (a, b, c) = _seed(handle)
    ctx = ctx_for(handle, config(sections=("findings_table",)))
    scale = {lv.level: lv for lv in ctx.scale}
    rows = list(asset_rows.csv_rows(handle, ctx.where, scale=scale))
    assert [r[0] for r in rows] == ["F01", "F02", "F03", ""]
    assert [r[3] for r in rows] == ["DJI_0001.JPG", "DJI_0002.JPG", "DJI_0001.JPG", "DJI_0003.JPG"]
    d = derive((-5.0, 41.2, 0.5), (-1.0, 0.0, 0.0), review, frame)
    zone = next(z.label for z in review.zones if z.id == d.zone)
    assert rows[0] == [
        "F01", "F-0001", a, "DJI_0001.JPG", 2, ctx.level(2).name, "crack", "Panel", zone, "41.20",
        d.side, f"{d.bearing_deg:.0f}", "yes", "1.2500", "Open joint, east", None, "2", "2026-09-01 12:00:00",
        25.08, 55.14, 120.5,
    ]  # fmt: skip
    unplaced = rows[2]
    assert (unplaced[1], unplaced[8], unplaced[9], unplaced[10], unplaced[11], unplaced[12]) == (
        "F-0002",
        "",
        "",
        "Not placed",
        "",
        "no",
    )
    assert rows[3] == [
        "", "", c, "DJI_0003.JPG", "", "Uncertain", "", "", "", "38.00", "", "", "no", "0.0000", "Glare", None,
        "1", "2026-09-01 12:00:00", None, None, None,
    ]  # fmt: skip


def test_the_render_job_writes_sightings_csv_for_the_layout(handle, tmp_path):
    _seed(handle)
    cfg = config(sections=("findings_table",)).model_copy(update={"csv_layout": "asset_sightings"})
    ctx = ctx_for(handle, cfg)
    path = render_job.write_csv_file(
        handle,
        tmp_path,
        cfg,
        where=ctx.where,
        ids=[],
        scale={lv.level: lv for lv in ctx.scale},
        number=1,
        on_row=None,
    )
    assert path.name == "sightings.csv"
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbffinding_id,defect_id,") and raw.count(b"\r\n") == 5
