"""Page plan and page names for createDrawingPages (I1 Rulings 2 to 5)."""

import pytest

from app.drawings import pages, store
from app.drawings.schemas import DrawingPagesCreate
from app.errors import AppError


def _body(**kw) -> DrawingPagesCreate:
    return DrawingPagesCreate.model_validate(
        {"inspection_id": "x", "name": "Set", "placement": {"method": "none"}, "pages": "all", **kw}
    )


def _idir(tmp_path, sizes):
    store.write_json(
        tmp_path / "pages.json",
        {"pages": [{"page": i + 1, "width_pt": w, "height_pt": h} for i, (w, h) in enumerate(sizes)]},
    )
    return tmp_path


PDF = {"format": "pdf", "layers": [], "embedded": None}


def test_all_is_every_page_ascending_with_its_own_dpi(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0), (14400.0, 1440.0), (300.0, 200.0)])
    plan = pages.check_pages(PDF, _body(dpi=300), idir)
    assert plan["pages"] == [(1, 300), (2, 100), (3, 300)]
    assert plan["placement"]["method"] == "none"


def test_a_list_keeps_its_order_and_drops_repeats(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 3)
    assert [p for p, _ in pages.check_pages(PDF, _body(pages=[3, 1, 3]), idir)["pages"]] == [3, 1]


def test_the_default_dpi_is_150(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    assert pages.check_pages(PDF, _body(), idir)["pages"] == [(1, 150), (2, 150)]


def test_a_page_past_the_end_is_refused(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(pages=[1, 3]), idir)
    assert (e.value.code, e.value.status, e.value.details) == ("invalid_pages", 422, {"reason": "page"})


def test_only_a_pdf_has_pages(tmp_path):
    with pytest.raises(AppError) as e:
        pages.check_pages({"format": "png", "layers": [], "embedded": None}, _body(), tmp_path)
    assert e.value.code == "invalid_pages"
    assert e.value.details == {"reason": "pages"} and "only a PDF has pages" in e.value.message


def test_more_than_max_pages_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(pages, "MAX_PAGES", 2)
    idir = _idir(tmp_path, [(300.0, 200.0)] * 3)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(), idir)
    assert e.value.code == "invalid_pages"
    assert e.value.details == {"reason": "pages"}


def test_a_crs_placement_is_refused_for_a_pdf(tmp_path):
    idir = _idir(tmp_path, [(300.0, 200.0)] * 2)
    with pytest.raises(AppError) as e:
        pages.check_pages(PDF, _body(placement={"method": "crs", "crs": "EPSG:32639"}), idir)
    assert e.value.code == "invalid_placement"


@pytest.mark.parametrize(
    ("name", "page", "count", "want"),
    [
        ("Plot plan", 2, 29, "Plot plan · p2"),
        ("  Plot plan · p7 ", 3, 29, "Plot plan · p3"),
        ("   ", 1, 2, "T0005 · p1"),
        ("Plot plan", 1, 1, "Plot plan"),
    ],
)
def test_page_names(name, page, count, want):
    assert pages.page_name(name, "T0005", page, count) == want


def test_a_long_name_keeps_its_page_suffix():
    got = pages.page_name("x" * 200, "s", 12, 29)
    assert len(got) == 200 and got.endswith(" · p12")
