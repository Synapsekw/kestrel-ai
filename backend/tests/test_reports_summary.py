"""Summary KPIs against a brute-force count, the strip and the narrative (spec §8.3, §17)."""

import random
from collections import Counter
from datetime import UTC, datetime

from reports_rows import add_cloud, add_findings, add_report, add_type, add_version, config, ctx_for

from app.reports.baseline import resolve_baseline
from app.reports.sections import summary


def _dump(doc):
    return [b.model_dump(mode="json") for b in doc.blocks]


def test_kpis_match_a_brute_force_count(handle):
    rng = random.Random(7)
    types = [add_type(handle, n) for n in ("crack", "rust", "dent")]
    c = add_cloud(handle)
    specs = [
        {
            "type_id": rng.choice(types),
            "severity": rng.choice([None, 1, 2, 3, 4]),
            "status": rng.choice(["open", "reviewed", "closed"]),
            "anchor": "cloud",
            "target": c,
        }
        for _ in range(120)
    ]
    add_findings(handle, specs)
    cfg = config(
        sections=("summary",),
        filters={"statuses": ["open", "reviewed"], "severity_min": 2, "include_ungraded": True},
        options={"summary": {"show_deltas": False}},
    )
    kept = [
        s
        for s in specs
        if s["status"] in ("open", "reviewed") and (s["severity"] is None or s["severity"] >= 2)
    ]
    ctx = ctx_for(handle, cfg)
    assert summary.kpi_counts(ctx) == Counter((s["severity"], s["status"]) for s in kept)
    by_type = Counter(s["type_id"] for s in kept)
    assert summary.type_counts(ctx) == sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))
    items = {i["label"]: i["value"] for i in _dump(summary.compose(ctx))[0]["items"]}
    sev = Counter(s["severity"] for s in kept)
    st = Counter(s["status"] for s in kept)
    assert items["Findings"] == str(len(kept))
    assert (items["Critical"], items["Major"], items["Ungraded"]) == (
        str(sev[4]),
        str(sev[3]),
        str(sev[None]),
    )
    assert (items["Open"], items["Reviewed"], items["Closed"]) == (str(st["open"]), str(st["reviewed"]), "0")


def test_matrix_chart_and_narrative(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust")
    c = add_cloud(handle)
    add_findings(
        handle,
        [
            {"type_id": crack, "severity": 4, "anchor": "cloud", "target": c},
            {"type_id": crack, "severity": 4, "anchor": "cloud", "target": c, "status": "closed"},
            {"type_id": rust, "severity": None, "anchor": "cloud", "target": c},
        ],
    )
    ctx = ctx_for(
        handle,
        config(
            sections=("summary",),
            options={"summary": {"show_deltas": False, "narrative": "First.\n\nSecond\npara."}},
        ),
    )
    kinds = [b["kind"] for b in _dump(summary.compose(ctx))]
    assert kinds == ["kpis", "table", "chart", "para", "para"]
    blocks_ = _dump(summary.compose(ctx))
    matrix = blocks_[1]
    assert [col["label"] for col in matrix["columns"]] == ["Severity", "Open", "Reviewed", "Closed", "Total"]
    assert matrix["rows"][0] == ["Critical", "1", "0", "1", "2"] and matrix["rows"][-1] == [
        "Total",
        "2",
        "0",
        "1",
        "3",
    ]
    assert blocks_[2]["x_labels"] == ["crack", "rust"] and blocks_[2]["series"][0]["values"] == [2, 1]
    assert [b["text"] for b in blocks_[3:]] == ["First.", "Second\npara."]


def test_delta_strip_first_report_and_since(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    f1, f2 = add_findings(
        handle,
        [
            {"type_id": t, "severity": 2, "anchor": "cloud", "target": c, "status": "closed"},
            {"type_id": t, "severity": 3, "anchor": "cloud", "target": c},
        ],
    )
    rid = add_report(handle, config())
    cfg = config(sections=("summary",), options={"summary": {"show_deltas": True}})
    first = _dump(summary.compose(ctx_for(handle, cfg, report_id=rid)))
    assert first[-1] == {**first[-1], "kind": "para", "text": "First report"}
    add_version(
        handle,
        rid,
        number=1,
        issued_at=datetime(2026, 9, 20, tzinfo=UTC),
        rows=[(f1, t, 2, "open"), (f2, t, 2, "open")],
    )
    ctx = ctx_for(handle, cfg, report_id=rid, baseline=resolve_baseline(handle, rid))
    texts = [b.get("text") for b in _dump(summary.compose(ctx))]
    assert "1 closed · 1 escalated since v1" in texts


def test_an_off_scale_level_is_counted_and_named(handle):
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_findings(handle, [{"type_id": t, "severity": 5, "anchor": "cloud", "target": c}])
    items = {
        i["label"]: i["value"]
        for i in _dump(summary.compose(ctx_for(handle, config(options={"summary": {"show_deltas": False}}))))[
            0
        ]["items"]
    }
    assert items["Level 5"] == "1" and items["Findings"] == "1"


def test_no_findings_says_so(handle):
    out = _dump(summary.compose(ctx_for(handle, config(options={"summary": {"show_deltas": False}}))))
    assert out[0]["text"] == "No findings match the filters"
