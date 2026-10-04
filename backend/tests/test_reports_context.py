"""The compose context and the keyset finding iterator (spec §8.2 step 3, §17 "201 findings")."""

from datetime import timedelta

import pytest
from reports_rows import GEN, T0, add_cloud, add_findings, add_type, config, ctx_for
from sqlalchemy import select

from app.db.models import Finding, ProjectType
from app.errors import AppError
from app.pagination import encode_cursor
from app.reports import blocks
from app.reports.context import ORDERS, FindingRow, findings_page, iter_findings
from app.reports.schemas import ReportWarning


@pytest.fixture
def many(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust", colour="#aa5500")
    c = add_cloud(handle)
    sev = [None, 1, 2, 3, 4]
    add_findings(
        handle,
        [
            {
                "type_id": crack if i % 3 else rust,
                "severity": sev[i % 5],
                "anchor": "cloud",
                "target": c,
                "created_at": T0 + timedelta(days=i % 7),
            }
            for i in range(201)
        ],
    )
    return {"crack": crack, "rust": rust, "cloud": c}


def _expected(handle, many, order):
    names = {many["crack"]: "crack", many["rust"]: "rust"}
    with handle.session() as s:
        rows = s.execute(select(Finding.number, Finding.severity, Finding.type_id, Finding.created_at)).all()
    key = {
        "number": lambda r: r.number,
        "severity_desc": lambda r: (-(r.severity if r.severity is not None else -1), r.number),
        "type": lambda r: (names[r.type_id], r.number),
        "observed": lambda r: (r.created_at.date(), r.number),
    }[order]
    return [r.number for r in sorted(rows, key=key)]


@pytest.mark.parametrize("order", ORDERS)
def test_iter_findings_crosses_the_200_boundary_once_in_order(handle, many, order):
    ctx = ctx_for(handle, config())
    got = [r.number for r in iter_findings(ctx, order)]
    first, cur = findings_page(ctx, order, None)
    second, end = findings_page(ctx, order, cur)
    assert got == _expected(handle, many, order)
    assert (len(first), len(second), end) == (200, 1, None)


def test_a_finding_that_sorts_before_the_cursor_is_not_repeated(handle, many):
    ctx = ctx_for(handle, config())
    first, cur = findings_page(ctx, "severity_desc", None, 50)
    add_findings(
        handle, [{"type_id": many["crack"], "severity": 4, "anchor": "cloud", "target": many["cloud"]}]
    )
    rest = [r.number for r in iter_findings_from(ctx, "severity_desc", cur)]
    seen = [r.number for r in first] + rest
    assert len(seen) == len(set(seen)) == 201  # the newcomer (202) sorts before the cursor: not shown
    assert 202 not in seen


def iter_findings_from(ctx, order, cursor):
    while cursor is not None:
        rows, cursor = findings_page(ctx, order, cursor)
        yield from rows


def test_cursor_from_another_order_or_garbage_is_422(handle, many):
    ctx = ctx_for(handle, config())
    _, cur = findings_page(ctx, "number", None, 10)
    for bad in (cur, "not-a-cursor"):
        with pytest.raises(AppError) as e:
            findings_page(ctx, "type", bad)
        assert e.value.status == 422


@pytest.mark.parametrize(
    "order, cursor_kwargs",
    [
        ("number", {"o": "number", "n": {}, "k": None}),
        ("number", {"o": "number", "n": "x", "k": None}),
        ("number", {"o": "number", "n": True, "k": None}),
        ("type", {"o": "type", "n": 1, "k": [1]}),
        ("severity_desc", {"o": "severity_desc", "n": 1, "k": "a"}),
        ("observed", {"o": "observed", "n": 1, "k": "not-a-date"}),
    ],
)
def test_cursor_with_a_wrong_typed_value_is_422(handle, many, order, cursor_kwargs):
    """A structurally valid cursor (right keys) whose n/k values are the wrong type must 422, not
    reach the database as an unbound dict/list parameter or silently return an empty page."""
    ctx = ctx_for(handle, config())
    bad = encode_cursor(**cursor_kwargs)
    with pytest.raises(AppError) as e:
        findings_page(ctx, order, bad)
    assert e.value.status == 422


@pytest.mark.parametrize(
    "order, cursor_kwargs",
    [
        ("number", {"o": "number", "n": 10**30, "k": None}),
        ("number", {"o": "number", "n": -1, "k": None}),
        ("severity_desc", {"o": "severity_desc", "n": 1, "k": 10**30}),
        ("severity_desc", {"o": "severity_desc", "n": 1, "k": -(10**30)}),
    ],
)
def test_cursor_with_an_out_of_range_integer_is_422(handle, many, order, cursor_kwargs):
    """SQLite cannot bind an integer outside int64 (OverflowError -> 500); a tampered cursor 422s."""
    ctx = ctx_for(handle, config())
    with pytest.raises(AppError) as e:
        findings_page(ctx, order, encode_cursor(**cursor_kwargs))
    assert e.value.status == 422


def test_warn_is_total_over_pre_seeded_warnings(handle, many):
    seeded = ReportWarning.model_validate(
        {"code": "no_view", "message": "2 findings have no 3D view", "count": 2}
    )
    ctx = ctx_for(handle, config(), warnings=[seeded])
    ctx.warn("no_view", "{n} findings have no 3D view")
    assert [(w.code, w.count, w.message) for w in ctx.warnings] == [
        ("no_view", 3, "2 findings have no 3D view")
    ]


def test_rows_carry_names_colours_and_fallbacks(handle, many):
    add_findings(
        handle,
        [
            {"type_id": "type-gone", "severity": 5, "anchor": "cloud", "target": many["cloud"]},
        ],
    )
    ctx = ctx_for(handle, config())
    rows = {r.number: r for r in iter_findings(ctx)}
    one, two, three, odd = rows[1], rows[2], rows[3], rows[202]  # i = number - 1; type rust iff i % 3 == 0
    assert (two.label, two.type_name, two.type_colour) == ("F-0002", "crack", "#ff5a4f")
    assert (one.type_name, one.type_colour) == ("rust", "#aa5500")
    assert (two.severity_name, three.severity_name) == ("Minor", "Moderate")  # D4 default scale
    assert one.severity is None and one.severity_name == "Ungraded" and one.severity_colour == "#5E5C7A"
    assert (odd.type_name, odd.severity_name, odd.severity_colour) == ("Unknown type", "Level 5", "#5E5C7A")
    assert two.data_label == "Scan" and two.observed_on == (T0 + timedelta(days=1)).date()
    assert isinstance(one, FindingRow)


def test_from_finding_matches_the_iterator(handle, many):
    ctx = ctx_for(handle, config())
    first = next(iter_findings(ctx))
    with handle.session() as s:
        f = s.execute(select(Finding).where(Finding.number == 1)).scalar_one()
        assert FindingRow.from_finding(f, ctx) == first


def test_context_basics(handle, many):
    ctx = ctx_for(handle, config(sections=("summary",), options={"summary": {"show_deltas": False}}))
    assert ctx.today == GEN.date()
    assert ctx.options("summary").show_deltas is False
    assert [lv.level for lv in ctx.scale] == [1, 2, 3, 4]
    ctx.warn("no_view", "{n} findings have no 3D view", link="/p/x/clouds/c?finding=a")
    ctx.warn("no_view", "{n} findings have no 3D view", link="/p/x/clouds/c?finding=b")
    ctx.warn("ungraded", "3 findings are ungraded", count=3)
    assert [(w.code, w.count, w.message, w.link) for w in ctx.warnings] == [
        ("no_view", 2, "2 findings have no 3D view", "/p/x/clouds/c?finding=a"),
        ("ungraded", 3, "3 findings are ungraded", None),
    ]
    assert ctx.types[many["crack"]].name == "crack"
    with handle.session() as s:
        s.get(ProjectType, many["crack"]).name = "renamed"
    assert ctx.types[many["crack"]].name == "crack"  # read once per context


def test_ref_keys_a_spec_and_blocks_validate(handle, many):
    ctx = ctx_for(handle, config())
    spec = {"kind": "view3d", "subject_kind": "finding", "subject_id": "f1", "cloud_id": many["cloud"]}
    ref = ctx.ref(spec, width_px=1600, height_px=1000)
    assert len(ref.key) == 32 and ref.width_px == 1600
    fig = blocks.figure(ref, "3D view", 170, 105).model_dump(mode="json")
    assert fig["kind"] == "figure" and fig["snapshot"]["key"] == ref.key
    assert blocks.para("x", style="note").model_dump()["style"] == "note"
    assert blocks.fmt_date(GEN) == "30 Sep 2026"
    assert blocks.fmt_lat_lon(45.1234567, 15.5) == "45.123457, 15.500000"
    assert blocks.fmt_lat_lon(None, 15.5) == "-"


def test_ref_without_the_snapshot_engine_is_marked_missing(handle, many, monkeypatch):
    import builtins

    real = builtins.__import__

    def no_engine(name, *a, **k):
        if name.startswith("app.reports.snapshots"):
            raise ImportError(name)
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_engine)
    ctx = ctx_for(handle, config(), key_for=None)
    ref = ctx.ref(
        {"kind": "view3d", "subject_kind": "finding", "subject_id": "f1", "cloud_id": "c"},
        width_px=1600,
        height_px=1000,
    )
    assert len(ref.key) == 32 and ref.missing_reason == "The snapshot engine is not installed."
