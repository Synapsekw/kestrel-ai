"""The finding service (spec 2026-09-26-foundation sections 8.1, 8.2, 8.5): numbers, defaults,
defects only, the status table, anchors, activity and counts in the same transaction."""

import pytest
from findings_helpers import add_type, insert_box, insert_cloud, insert_map
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import Activity, Finding, FindingCount
from app.errors import AppError
from app.findings import service, trash
from app.findings.anchors import AnchorIn


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _at(cloud_id: str, **kw) -> AnchorIn:
    return AnchorIn(kind="cloud", cloud_id=cloud_id, x=1.0, y=2.0, z=3.0, **kw)


def _counts(handle) -> dict:
    with handle.session() as s:
        return {
            (r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n
        }


def _refused(fn, *args, **kwargs) -> AppError:
    with pytest.raises(AppError) as e:
        fn(*args, **kwargs)
    return e.value


def test_create_numbers_defaults_and_counts(handle, crack, cloud):
    a = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    b = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=None, note="hairline")
    assert (a.number, b.number) == (1, 2)
    assert (a.status, a.severity, a.created_by, a.note) == ("open", 2, "human", "")
    assert (b.severity, b.note) == (None, "hairline")
    assert (a.anchor_kind, a.data_type, a.data_id, a.x, a.y, a.z) == (
        "cloud",
        "point_cloud",
        cloud,
        1.0,
        2.0,
        3.0,
    )
    assert _counts(handle) == {("open", 2, crack["id"]): 1, ("open", -1, crack["id"]): 1}


def test_numbers_are_never_reused_after_a_delete(handle, crack, cloud):
    service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    top = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    service.delete_finding(handle, top.id)
    assert service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud)).number == 3


def test_a_finding_can_start_reviewed_or_closed(handle, crack, cloud):
    r = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), status="reviewed")
    c = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), status="closed")
    assert r.reviewed_at is not None and r.closed_at is None
    assert c.closed_at is not None


def test_an_object_type_cannot_carry_a_finding(handle, project, cloud):
    truck = project["classes"][3]  # dump_truck: an object type
    e = _refused(service.create_finding, handle, type_id=truck["id"], anchor=_at(cloud))
    assert (e.code, e.status) == ("not_a_defect", 422)


def test_a_catalogue_defect_type_not_yet_in_the_project_is_added(client, handle, project, cloud):
    rust = add_type(client, "rust")
    service.create_finding(handle, type_id=rust["id"], anchor=_at(cloud))
    ids = [c["id"] for c in client.get(f"/api/v1/projects/{project['id']}").json()["classes"]]
    assert ids[-1] == rust["id"]


def test_an_object_type_from_the_catalogue_is_not_added_on_refusal(client, handle, project, cloud):
    pole = add_type(client, "pole", kind="object")
    assert (
        _refused(service.create_finding, handle, type_id=pole["id"], anchor=_at(cloud)).code == "not_a_defect"
    )
    ids = [c["id"] for c in client.get(f"/api/v1/projects/{project['id']}").json()["classes"]]
    assert pole["id"] not in ids


def test_an_unknown_type_and_an_unknown_level_are_refused(handle, crack, cloud):
    assert _refused(service.create_finding, handle, type_id="nope", anchor=_at(cloud)).code == "unknown_type"
    e = _refused(service.create_finding, handle, type_id=crack["id"], anchor=_at(cloud), severity=7)
    assert (e.code, e.status) == ("severity_unknown", 422)


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["reviewed"], True),
        (["closed"], True),
        (["reviewed", "closed"], True),
        (["reviewed", "open"], True),
        (["closed", "open"], True),
        (["closed", "reviewed"], False),
    ],
)
def test_status_transitions(handle, crack, cloud, path, allowed):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    *head, last = path
    for status in head:
        service.patch_finding(handle, f.id, {"status": status})
    if allowed:
        assert service.patch_finding(handle, f.id, {"status": last}).status == last
    else:
        e = _refused(service.patch_finding, handle, f.id, {"status": last})
        assert (e.code, e.status) == ("invalid_transition", 409)


def test_transition_timestamps(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    assert service.patch_finding(handle, f.id, {"status": "reviewed"}).reviewed_at is not None
    assert service.patch_finding(handle, f.id, {"status": "open"}).reviewed_at is None
    assert service.patch_finding(handle, f.id, {"status": "closed"}).closed_at is not None
    assert service.patch_finding(handle, f.id, {"status": "open"}).closed_at is None


def test_severity_is_never_required_for_a_transition(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=None)
    assert service.patch_finding(handle, f.id, {"status": "closed"}).severity is None


def test_writes_record_activity_and_move_the_counts(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    service.patch_finding(handle, f.id, {"status": "reviewed"})
    service.patch_finding(handle, f.id, {"severity": 4})
    with handle.session() as s:
        rows = (
            s.execute(
                select(Activity).where(Activity.subject_id == f.id).order_by(Activity.at, Activity.kind)
            )
            .scalars()
            .all()
        )
        kinds = sorted(a.kind for a in rows)
        assert all("F-0001" in a.summary for a in rows)
    assert kinds == ["finding.created", "finding.severity", "finding.status"]
    assert _counts(handle) == {("reviewed", 4, crack["id"]): 1}


def test_a_map_anchor_takes_its_location_from_the_map_crs(handle, crack):
    from pyproj import CRS

    mid = insert_map(handle, crs_wkt=CRS.from_epsg(32633).to_wkt())
    geometry = {"type": "Point", "coordinates": [500000.0, 5000000.0]}
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="map", map_id=mid, geometry=geometry)
    )
    assert f.lon == pytest.approx(15.0, abs=1e-6) and 45.0 < f.lat < 45.3
    assert (f.data_type, f.data_id, f.geometry) == ("map", mid, geometry)


def test_a_map_anchor_without_a_crs_has_no_location(handle, crack):
    mid = insert_map(handle)
    ring = [[0, 0], [10, 0], [10, 10], [0, 0]]
    f = service.create_finding(
        handle,
        type_id=crack["id"],
        anchor=AnchorIn(kind="map", map_id=mid, geometry={"type": "Polygon", "coordinates": [ring]}),
    )
    assert (f.lon, f.lat) == (None, None)


def test_a_map_anchor_needs_a_point_or_a_closed_polygon(handle, crack):
    mid = insert_map(handle)
    open_ring = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10]]]}
    e = _refused(
        service.create_finding,
        handle,
        type_id=crack["id"],
        anchor=AnchorIn(kind="map", map_id=mid, geometry=open_ring),
    )
    assert (e.code, e.status) == ("invalid_geometry", 422)


def test_a_missing_anchor_target_is_404(handle, crack):
    assert _refused(service.create_finding, handle, type_id=crack["id"], anchor=_at("nope")).status == 404


def test_an_annotation_carries_at_most_one_finding(handle, crack):
    image_id, box_id = insert_box(handle, crack["id"])
    anchor = AnchorIn(kind="image", image_id=image_id, annotation_id=box_id)
    first = service.create_finding(handle, type_id=crack["id"], anchor=anchor)
    assert (first.anchor_kind, first.data_type, first.annotation_id) == ("image", "image_set", box_id)
    e = _refused(service.create_finding, handle, type_id=crack["id"], anchor=anchor)
    assert (e.code, e.status, e.details) == ("conflict", 409, {"finding_id": first.id})


def test_an_image_finding_cannot_be_moved_through_its_anchor(handle, crack):
    image_id, box_id = insert_box(handle, crack["id"])
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="image", image_id=image_id, annotation_id=box_id)
    )
    e = _refused(service.patch_finding, handle, f.id, {"anchor": {"x": 1.0}})
    assert (e.code, e.status) == ("anchor_immutable", 422)


def test_the_database_refuses_a_mixed_anchor(handle, crack, cloud):
    with pytest.raises(IntegrityError), handle.session() as s:
        s.add(
            Finding(
                number=99,
                type_id=crack["id"],
                status="open",
                note="",
                created_by="human",
                anchor_kind="cloud",
                cloud_id=cloud,
                x=0.0,
                y=0.0,
                z=0.0,
                map_id="m1",
                data_type="point_cloud",
                data_id=cloud,
            )
        )
        s.flush()


def test_moving_a_cloud_anchor(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    moved = service.patch_finding(handle, f.id, {"anchor": {"x": 9.0, "uncertainty_m": 0.05}})
    assert (moved.x, moved.y, moved.uncertainty_m) == (9.0, 2.0, 0.05)


def test_findings_work_on_snapshot_types_without_the_catalogue(client, handle, crack, cloud):
    handle.catalogue = None
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=3)
    assert service.patch_finding(handle, f.id, {"status": "reviewed", "severity": 9}).severity == 9
    rust = add_type(client, "rust")
    e = _refused(service.create_finding, handle, type_id=rust["id"], anchor=_at(cloud))
    assert (e.code, e.status) == ("catalogue_unavailable", 503)


def test_delete_for_anchor_takes_every_finding_of_that_target(handle, crack, cloud):
    other = insert_cloud(handle, name="Other")
    a = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    b = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    keep = service.create_finding(handle, type_id=crack["id"], anchor=_at(other))
    with handle.session() as s:
        gone = service.delete_for_anchor(s, project_id=handle.id, anchor_kind="cloud", target_id=cloud)
    assert sorted(gone) == sorted([a.id, b.id])
    assert _counts(handle) == {("open", 2, crack["id"]): 1}
    assert service.get_finding(handle, keep.id)[0].id == keep.id


def test_get_or_404_answers_404_for_a_stranger(handle):
    with handle.session() as s:
        e = _refused(service.get_or_404, s, "nope")
    assert e.status == 404


def test_a_deleted_findings_photos_go_to_the_trash_and_are_purged_after_30_days(handle, crack, cloud):
    from datetime import UTC, datetime, timedelta

    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    folder = trash.finding_dir(handle, f.id)
    folder.mkdir(parents=True)
    (folder / "a.jpg").write_bytes(b"x")
    service.delete_finding(handle, f.id)
    binned = list((handle.folder / "findings" / "_trash").glob(f"{f.id}-*"))
    assert len(binned) == 1 and (binned[0] / "a.jpg").read_bytes() == b"x"
    assert trash.purge(handle, now=datetime.now(UTC) + timedelta(days=29)) == 0
    assert trash.purge(handle, now=datetime.now(UTC) + timedelta(days=31)) == 1
    assert not binned[0].exists()


def test_purge_counts_only_entries_that_really_went(handle, monkeypatch):
    from datetime import UTC, datetime, timedelta

    stuck = trash.findings_dir(handle) / trash.TRASH / "f1-20260101T000000Z"
    stuck.mkdir(parents=True)
    (stuck / "a.jpg").write_bytes(b"x")
    monkeypatch.setattr(trash.shutil, "rmtree", lambda *a, **k: None)  # a locked file keeps the folder
    assert trash.purge(handle, now=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=31)) == 0
    assert stuck.exists()
