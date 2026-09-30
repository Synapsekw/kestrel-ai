"""The reports service (plan R1 Task 3; spec §6.1, §14 reports rows, Rulings 1-6)."""

from datetime import UTC, datetime, timedelta

import pytest
from reports_helpers import add_version, config_json

from app.errors import AppError
from app.reports import service
from app.reports.config_write import parse_config
from app.reports.models import Report as ReportRow

T0 = datetime(2026, 9, 1, tzinfo=UTC)


@pytest.fixture
def cat(client):
    return client.app.state.catalogue


def test_create_without_template_uses_builtin_full(handle, cat):
    r = service.create_report(handle, cat, title="  North wall ")
    assert (r.title, r.template_id, r.archived) == ("North wall", None, False)
    assert r.config.cover.title == "North wall"
    full = service.get_report_config(handle, r.id)
    assert [s.key for s in full.sections] == [s.key for s in r.config.sections]


def test_create_from_a_builtin_keeps_its_sections(handle, cat):
    r = service.create_report(handle, cat, title="Counts", template_id="builtin-survey-counts")
    assert r.template_id == "builtin-survey-counts"
    keys = [str(getattr(s.key, "value", s.key)) for s in r.config.sections if s.enabled]
    assert "comparison" in keys and "object_counts" in keys


def test_create_from_unknown_template_is_404(handle, cat):
    with pytest.raises(AppError) as e:
        service.create_report(handle, cat, title="x", template_id="nope")
    assert e.value.status == 404


def test_get_unknown_report_is_404(handle):
    with pytest.raises(AppError) as e:
        service.get_report(handle, "nope")
    assert (e.value.status, e.value.code) == (404, "not_found")


def test_list_pages_newest_first_and_hides_archived(handle, cat):
    ids = [service.create_report(handle, cat, title=f"R{i}").id for i in range(3)]
    service.patch_report(handle, ids[0], title="R0 edited")  # newest updated_at now
    with handle.session() as s:
        s.get(ReportRow, ids[1]).archived = True
    page, nxt = service.list_reports(handle, limit=1)
    assert [p.id for p in page] == [ids[0]] and nxt
    page2, nxt2 = service.list_reports(handle, limit=5, cursor=nxt)
    assert [p.id for p in page2] == [ids[2]] and nxt2 is None
    everything, _ = service.list_reports(handle, include_archived=True)
    assert {p.id for p in everything} == set(ids)


def test_last_version_is_the_newest_row_whatever_its_state(handle, cat):
    rid = service.create_report(handle, cat, title="R").id
    other = service.create_report(handle, cat, title="Other").id
    add_version(handle, rid, number=1, pages=12, issued_at=T0, created_at=T0)
    add_version(handle, rid, number=2, state="failed", created_at=T0 + timedelta(hours=1))
    add_version(handle, other, number=1, pages=3, created_at=T0)
    items = {i.id: i for i in service.list_reports(handle)[0]}
    last = items[rid].last_version
    assert (last.number, last.state, last.pages) == (2, "failed", None)
    assert items[other].last_version.pages == 3
    assert service.get_report(handle, rid).last_version.number == 2


def test_last_versions_is_one_query_per_page(handle, cat):
    from sqlalchemy import event

    rids = [service.create_report(handle, cat, title=f"R{i}").id for i in range(5)]
    for rid in rids:
        add_version(handle, rid, number=1, pages=1)
    seen: list[str] = []
    listener = lambda *a: seen.append(a[2])  # noqa: E731 - before_cursor_execute(conn, cursor, statement, ...)
    event.listen(handle.engine, "before_cursor_execute", listener)
    try:
        with handle.session() as s:
            got = service.last_versions(s, rids)
    finally:
        event.remove(handle.engine, "before_cursor_execute", listener)
    assert set(got) == set(rids)
    assert sum("report_version" in q for q in seen) == 1


def test_a_report_without_versions_has_no_last_version(handle, cat):
    r = service.create_report(handle, cat, title="R")
    assert service.get_report(handle, r.id).last_version is None


def test_patch_title_keeps_the_config(handle, cat):
    r = service.create_report(handle, cat, title="R")
    raw = config_json()
    raw["sections"] = list(reversed(raw["sections"]))
    service.patch_report(handle, r.id, config=parse_config(raw, code="x"))
    out = service.patch_report(handle, r.id, title="Renamed")
    assert out.title == "Renamed"
    assert [s.key for s in out.config.sections] == [s.key for s in parse_config(raw, code="x").sections]
    assert out.updated_at >= r.updated_at


def test_patch_with_an_unknown_logo_names_its_path(handle, cat):
    r = service.create_report(handle, cat, title="R")
    raw = config_json()
    raw["cover"]["logo_asset_id"] = "no-such-asset"
    with pytest.raises(AppError) as e:
        service.patch_report(handle, r.id, config=parse_config(raw, code="x"))
    assert e.value.code == "invalid_report"
    assert [x["path"] for x in e.value.details["errors"]] == ["config.cover.logo_asset_id"]


def test_delete_without_versions_deletes(handle, cat):
    r = service.create_report(handle, cat, title="R")
    assert service.delete_report(handle, r.id) == "deleted"
    with pytest.raises(AppError):
        service.get_report(handle, r.id)


def test_delete_with_a_version_archives(handle, cat):
    r = service.create_report(handle, cat, title="R")
    add_version(handle, r.id, number=1)
    assert service.delete_report(handle, r.id) == "archived"
    assert service.get_report(handle, r.id).archived is True
    assert service.delete_report(handle, r.id) == "archived"  # idempotent


def test_delete_with_files_on_disk_archives(handle, cat):
    r = service.create_report(handle, cat, title="R")
    (handle.folder / "reports" / r.id / ".partial-v001").mkdir(parents=True)  # a render in flight
    assert service.delete_report(handle, r.id) == "archived"


def test_duplicate_copies_config_not_versions(handle, cat):
    r = service.create_report(handle, cat, title="R", template_id="builtin-volumes")
    add_version(handle, r.id, number=1)
    copy = service.duplicate_report(handle, r.id)
    assert copy.id != r.id and copy.title == "R (copy)"
    assert copy.template_id == "builtin-volumes"
    assert copy.config == r.config and copy.last_version is None and copy.archived is False


def test_duplicate_truncates_a_long_title(handle, cat):
    r = service.create_report(handle, cat, title="x" * 200)
    assert len(service.duplicate_report(handle, r.id).title) == 200
