"""The project Overview (spec 2026-09-26-foundation sections 9.1, 9.2, 14, 16): one endpoint, fed by
pre-aggregated rows only. A statement counter pins that its cost does not grow with the project and
that it never reads `finding`, `box` or `image`; the Projects card summary may read one image row by
rowid (its cover), and nothing else of those tables."""

import re
from collections.abc import Callable
from datetime import UTC, date, datetime

import pytest
from findings_helpers import insert_box, insert_cloud
from sqlalchemy import event

from app.catalogue import service as catalogue_service
from app.db.models import GeoMap, Surface, VolumeMeasurement
from app.findings import service
from app.findings.anchors import AnchorIn
from app.overview import service as overview

API = "/api/v1"
FORBIDDEN = re.compile(r"\b(FROM|JOIN)\s+\"?(finding|box|image)\"?(\s|$)", re.IGNORECASE)
# The one bounded read of `image` the summary may make: the newest image as the cover, one row.
COVER_READ = "SELECT id FROM image ORDER BY rowid DESC LIMIT 1"


def _overview(client, project) -> dict:
    r = client.get(f"{API}/projects/{project['id']}/overview")
    assert r.status_code == 200, r.text
    return r.json()


def _counting(engine) -> tuple[list[str], Callable[[], None]]:
    seen: list[str] = []

    def before(conn, cursor, statement, params, context, executemany):
        if not statement.lstrip().upper().startswith("PRAGMA"):
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    return seen, lambda: event.remove(engine, "before_cursor_execute", before)


def _counted(engine, call: Callable[[], dict]) -> tuple[list[str], dict]:
    seen, stop = _counting(engine)
    try:
        out = call()
    finally:
        stop()
    return list(seen), out


def _map(handle, name: str, status: str, captured_on: date | None) -> str:
    with handle.session() as s:
        row = GeoMap(name=name, status=status, source_path="C:/m.tif", source_size=1, captured_on=captured_on)
        s.add(row)
        s.flush()
        return row.id


def test_an_empty_project(client, project):
    out = _overview(client, project)
    assert out["data"] == {
        "image_sets": 0,
        "images": 0,
        "maps": 0,
        "elevations": 0,
        "point_clouds": 0,
        "drawings": 0,
    }
    assert (out["latest_volume"], out["hero_map_id"], out["hero"], out["banners"]) == (None, None, None, [])
    assert out["findings"]["by_status"] == {"open": 0, "reviewed": 0, "closed": 0}
    assert out["findings"]["open_by_severity"] == {"1": 0, "2": 0, "3": 0, "4": 0}
    assert out["photo_review"] is None


def test_the_overview_costs_the_same_whatever_the_project_holds(client, project, handle, crack):
    empty, _ = _counted(handle.engine, lambda: _overview(client, project))
    cloud = insert_cloud(handle)
    for sev in [None, 1, 2, 3, 4] * 6:
        anchor = AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
        service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=sev)
    _map(handle, "April", "ready", date(2026, 4, 1))
    insert_box(handle, project["classes"][0]["id"])
    seen, out = _counted(handle.engine, lambda: _overview(client, project))
    assert len(seen) == len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st)] == []
    assert out["findings"]["by_status"]["open"] == 30


def test_the_project_summary_costs_the_same_and_reads_one_image_row_at_most(client, project, handle, crack):
    def get() -> dict:
        r = client.get(f"{API}/projects/{project['id']}")
        assert r.status_code == 200, r.text
        return r.json()

    empty, _ = _counted(handle.engine, get)
    cloud = insert_cloud(handle)
    for sev in [None, 1, 2, 3, 4] * 6:
        anchor = AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
        service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=sev)
    insert_box(handle, project["classes"][0]["id"])
    seen, out = _counted(handle.engine, get)
    assert len(seen) == len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st) and st.strip() != COVER_READ] == []
    assert [st.strip() for st in seen].count(COVER_READ) == 1
    assert out["summary"]["open_findings"] == 30
    assert out["summary"]["cover"]["kind"] == "image"

    _map(handle, "April", "ready", date(2026, 4, 1))  # a ready map is the cover: no image read at all
    seen, out = _counted(handle.engine, get)
    assert len(seen) <= len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st)] == []
    assert out["summary"]["cover"]["kind"] == "map"


def test_the_hero_map_is_the_newest_ready_map(client, project, handle):
    _map(handle, "March", "ready", date(2026, 3, 1))
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    _map(handle, "May", "importing", date(2026, 5, 1))
    _map(handle, "Undated", "ready", None)
    assert _overview(client, project)["hero_map_id"] == april


def test_the_latest_volume_and_its_delta_on_the_same_polygon(client, project, handle):
    poly = [[0, 0], [10, 0], [10, 10], [0, 0]]
    with handle.session() as s:
        top = Surface(name="Design", kind="design", status="ready")
        s.add(top)
        s.flush()
        for name, polygon, net, day in [
            ("Pile A", poly, 100.0, 1),
            ("Pile B", [[5, 5], [6, 5], [6, 6], [5, 5]], 7.0, 10),
            ("Pile A again", poly, 130.0, 20),
        ]:
            s.add(
                VolumeMeasurement(
                    name=name,
                    polygon_native=polygon,
                    top_surface_id=top.id,
                    base={"kind": "lowest"},
                    status="ready",
                    results={"net_m3": net},
                    created_at=datetime(2026, 9, day, tzinfo=UTC),
                )
            )
    out = _overview(client, project)
    lv = out["latest_volume"]
    assert (lv["name"], lv["net_m3"], lv["previous_net_m3"]) == ("Pile A again", 130.0, 100.0)
    assert out["data"]["elevations"] == 1


def test_banners_and_a_failing_provider(client, project, monkeypatch):
    catalogue_service.set_meta(
        client.app.state.catalogue, catalogue_service.NEEDS_CLASSIFICATION, {"count": 12}
    )

    def broken(handle):
        raise RuntimeError("boom")

    monkeypatch.setattr(overview, "BANNER_PROVIDERS", [*overview.BANNER_PROVIDERS, broken])
    [banner] = _overview(client, project)["banners"]
    assert banner["kind"] == "types_to_classify"
    assert banner["message"].startswith("12 types came from your existing projects")


def test_project_out_carries_the_summary(client, project, handle, crack):
    cloud = insert_cloud(handle)
    anchor = AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
    service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=4)
    service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=None)
    closed = service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=4)
    service.patch_finding(handle, closed.id, {"status": "closed"})
    mid = _map(handle, "April", "ready", date(2026, 4, 1))
    summary = client.get(f"{API}/projects/{project['id']}").json()["summary"]
    assert summary == {
        "image_count": 0,
        "maps": 1,
        "point_clouds": 1,
        "elevations": 0,
        "open_findings": 2,
        "open_top_severity": 1,
        "cover": {"kind": "map", "id": mid},
    }
    listed = client.get(f"{API}/projects").json()["items"]
    assert [p["summary"]["open_findings"] for p in listed if p["id"] == project["id"]] == [2]


@pytest.mark.parametrize("path", ["", "/types"])
def test_every_project_response_carries_the_summary(client, project, path):
    if path:
        r = client.put(
            f"{API}/projects/{project['id']}{path}", json={"type_ids": [c["id"] for c in project["classes"]]}
        )
    else:
        r = client.patch(f"{API}/projects/{project['id']}", json={"name": "Renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["open_findings"] == 0


def test_the_hero_is_map_then_cloud_then_images_then_drawing(client, project, handle):
    from app.db.models import Drawing, Source

    with handle.session() as s:
        s.add(Drawing(name="Plan", format="pdf", status="ready", source_path="C:/d.pdf", source_size=1))
    hero = _overview(client, project)["hero"]
    assert hero["kind"] == "drawing" and hero["id"]
    with handle.session() as s:
        s.add(Source(folder="C:/f", site="A", kind="images", image_count=3))
    assert _overview(client, project)["hero"] == {"kind": "images", "id": None}
    cloud = insert_cloud(handle)
    assert _overview(client, project)["hero"] == {"kind": "point_cloud", "id": cloud}
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}


def _asset_model(handle, *, review: dict | None, status: str = "ready", version: int | None = 1) -> str:
    from app.db.models import AssetModel

    with handle.session() as s:
        row = AssetModel(name="Stack", status=status, current_version=version, review=review)
        s.add(row)
        s.flush()
        return row.id


def test_the_hero_is_a_reviewed_asset_model_before_the_map(client, project, handle):
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    _asset_model(handle, review=None)  # built, but no review profile: not an inspected asset
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}
    _asset_model(handle, review={"profile_id": "stack"}, status="building", version=None)  # not built yet
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}
    model = _asset_model(handle, review={"profile_id": "stack"})
    assert _overview(client, project)["hero"] == {"kind": "asset_model", "id": model}


def test_photo_review_counts_by_status(client, project, handle):
    from image_summary_helpers import new_image

    from app.asset_review.review_status import set_status

    ids = [new_image(handle) for _ in range(4)]
    assert _overview(client, project)["photo_review"] is None  # photos, but none reviewed yet
    with handle.session() as s:
        set_status(s, ids[0], "uncertain")
        set_status(s, ids[1], "uncertain")
        set_status(s, ids[2], "none")
        set_status(s, ids[3], "finding")
    assert _overview(client, project)["photo_review"] == {
        "finding": 1,
        "none": 1,
        "uncertain": 2,
        "not_assessed": 0,
    }


def test_photo_review_counts_unreviewed_photos_as_not_assessed(client, project, handle):
    from image_summary_helpers import new_image
    from sqlalchemy import select

    from app.asset_review.review_status import set_status
    from app.db.models import Source

    source = new_image(handle)  # makes the source row; the rest share it
    with handle.session() as s:
        src = s.execute(select(Source)).scalar_one()
        src.image_count = 4  # what an import records: four photos in the set
        src_id = src.id
    ids = [source, *(new_image(handle, source_id=src_id) for _ in range(3))]
    with handle.session() as s:
        set_status(s, ids[0], "finding")
        set_status(s, ids[1], "none")
    assert _overview(client, project)["photo_review"] == {
        "finding": 1,
        "none": 1,
        "uncertain": 0,
        "not_assessed": 2,
    }


def test_the_asset_reads_keep_the_overview_cost_flat(client, project, handle):
    """The two new reads run on every call, so the statement count does not depend on the project."""
    from image_summary_helpers import new_image

    from app.asset_review.review_status import set_status

    empty, _ = _counted(handle.engine, lambda: _overview(client, project))
    _asset_model(handle, review={"profile_id": "stack"})
    image = new_image(handle)
    with handle.session() as s:
        set_status(s, image, "none")
    seen, out = _counted(handle.engine, lambda: _overview(client, project))
    assert len(seen) == len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st)] == []
    assert out["hero"]["kind"] == "asset_model"
