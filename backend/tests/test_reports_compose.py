"""The section registry, compose(), stubs, and the default block paging (plan R2 Task 3)."""

import types as pytypes

from reports_rows import GEN, add_cloud, add_finding, add_type, config, ctx_for, fake_key

from app.reports import blocks
from app.reports.compose import (
    SECTION_COMPOSERS,
    SECTION_MODULES,
    ComposeContext,
    FindingRow,
    compose,
    iter_findings,
    section_page,
    section_stats,
)
from app.reports.figures import cloud, image
from app.reports.figures import map as map_figures
from app.reports.schemas import ReportSectionDoc

KEYS = [
    "cover",
    "summary",
    "findings_table",
    "finding_pages",
    "measurements",
    "comparison",
    "object_counts",
    "appendix",
]


def test_the_registry_names_all_eight_sections():
    assert sorted(SECTION_MODULES) == sorted(KEYS) == sorted(SECTION_COMPOSERS)
    for key, mod in SECTION_MODULES.items():
        assert mod.KEY == key and mod.TITLE


def test_r9_stubs_say_no_data(handle):
    ctx = ctx_for(handle, config(sections=("measurements", "comparison", "object_counts")))
    for key in ("measurements", "comparison", "object_counts"):
        doc = SECTION_COMPOSERS[key](ctx)
        assert isinstance(doc, ReportSectionDoc)
        assert [b.model_dump() for b in doc.blocks] == [blocks.para("No data", style="note").model_dump()]
        assert SECTION_MODULES[key].USES_FINDINGS is False


def test_figure_hooks_are_empty_stubs(handle):
    """image and map are still R2's stubs; cloud is real (R9-C) -- a cloud finding with no stored
    view and no covering cloud DSM prints its placeholder figure, and `measurement_figure` stays
    R2's stub until R9-C's Task 4."""
    t, c = add_type(handle, "crack"), add_cloud(handle)
    add_finding(handle, t, anchor="cloud", target=c)
    ctx = ctx_for(handle, config())
    row = next(iter_findings(ctx))
    assert image.finding_figures(ctx, row) == [] and image.photos(ctx, row, 4) == []
    assert image.comments(ctx, row, "all") == [] and map_figures.finding_figures(ctx, row) == []
    assert cloud.measurement_figure(ctx, object()) is None
    (fig,) = cloud.finding_figures(ctx, row)
    assert fig.snapshot.missing_reason is not None


def test_compose_keeps_config_order_skips_disabled_and_is_deterministic(handle):
    cfg = config(sections=("summary", "measurements", "appendix"))
    for s in cfg.sections:
        if s.key == "measurements":
            s.enabled = False
    appendix = next(s for s in cfg.sections if s.key == "appendix")
    cfg.sections = [appendix] + [s for s in cfg.sections if s.key != "appendix"]
    a = compose(handle, cfg, report_id="r1", baseline=None, generated_at=GEN, key_for=fake_key)
    b = compose(handle, cfg, report_id="r1", baseline=None, generated_at=GEN, key_for=fake_key)
    assert [s.key for s in a.sections] == ["appendix", "summary"]
    assert a.generated_at == GEN and a.report_id == "r1"
    assert a.paper == cfg.paper
    assert a.model_dump(mode="json") == b.model_dump(mode="json")


def test_default_paging_slices_by_offset(handle, monkeypatch):
    fake = pytypes.SimpleNamespace(
        KEY="measurements",
        TITLE="Measurements",
        compose=lambda ctx: ReportSectionDoc(
            key="measurements", title="M", blocks=[blocks.para(str(i)) for i in range(5)]
        ),
    )
    monkeypatch.setitem(SECTION_MODULES, "measurements", fake)
    ctx = ctx_for(handle, config(sections=("measurements",)))
    first, cur = section_page(ctx, "measurements", None, 2)
    second, cur2 = section_page(ctx, "measurements", cur, 2)
    third, end = section_page(ctx, "measurements", cur2, 2)
    assert [b.text for b in first + second + third] == ["0", "1", "2", "3", "4"] and end is None
    assert section_stats(ctx, "measurements").block_count == 5


def test_the_context_is_built_from_five_keywords(handle):
    ctx = ComposeContext(handle=handle, config=config(), report_id="r", baseline=None, generated_at=GEN)
    assert ctx.version is None and ctx.issued is False and FindingRow
