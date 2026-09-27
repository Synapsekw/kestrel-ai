"""The report-view endpoints (spec 2026-09-26-point-cloud-workspace section 11.4, reports spec 9.4):
multipart PUT, GET with ETag, listCloudViews, 404/409/422, the event, and the finding-delete sweep."""

import hashlib
import os
import time

import pytest
from cloud_views import META, gif, jpeg, meta_json, png
from findings_helpers import insert_map
from pointclouds import insert_cloud

from app.pointclouds import views

API = "/api/v1/projects"


@pytest.fixture
def cloud_id(handle) -> str:
    return insert_cloud(handle)


@pytest.fixture
def base(project_id) -> str:
    return f"{API}/{project_id}"


def _finding(client, base, type_id, cloud_id) -> str:
    anchor = {"kind": "cloud", "cloud_id": cloud_id, "x": 243540.2, "y": 3178030.5, "z": 12.4}
    r = client.post(f"{base}/findings", json={"type_id": type_id, "anchor": anchor})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _measurement(client, base, cloud_id) -> str:
    body = {"kind": "point", "points": [{"x": 243500.0, "y": 3178000.0, "z": 1.0, "uncertainty_m": 0.01}]}
    return client.post(f"{base}/pointclouds/{cloud_id}/measurements", json=body).json()["id"]


def _put(client, url, data: bytes, *, meta: str | None = None, meta_as_file=False, mime="image/png"):
    meta = meta if meta is not None else meta_json()
    meta_part = (
        ("blob", meta.encode(), "application/json") if meta_as_file else (None, meta, "application/json")
    )
    return client.put(url, files={"image": ("view.png", data, mime), "meta": meta_part})


def _code(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def test_put_then_get_a_finding_view(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    data = png()
    r = _put(client, f"{base}/findings/{fid}/view3d", data, meta=meta_json(anchor_normal=[0.71, -0.7, 0.05]))
    assert r.status_code == 200, r.text
    out = r.json()
    sha = hashlib.sha256(data).hexdigest()
    assert (out["subject_kind"], out["subject_id"], out["sha256"], out["stale"]) == (
        "finding",
        fid,
        sha,
        False,
    )
    assert out["pose"] == META["pose"] and out["render"] == META["render"]
    g = client.get(f"{base}/findings/{fid}/view3d")
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/png"
    assert g.headers["etag"] == f'"{sha}"'
    assert g.headers["cache-control"] == "private, no-cache"
    assert g.content == data


def test_meta_sent_as_a_json_file_part_is_accepted(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    r = _put(client, f"{base}/findings/{fid}/view3d", png(), meta_as_file=True)
    assert r.status_code == 200, r.text


def test_a_measurement_view_round_trips_as_jpeg(client, base, cloud_id):
    mid = _measurement(client, base, cloud_id)
    url = f"{base}/pointclouds/{cloud_id}/measurements/{mid}/view3d"
    assert _code(client.get(url)) == (404, "no_view")
    data = jpeg()
    r = _put(client, url, data, mime="image/jpeg")
    assert (r.status_code, r.json()["subject_kind"], r.json()["anchor_normal"]) == (
        200,
        "cloud_measurement",
        None,
    )
    g = client.get(url)
    assert (g.headers["content-type"], g.content) == ("image/jpeg", data)


def test_a_second_put_replaces_the_view_with_a_new_etag(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    url = f"{base}/findings/{fid}/view3d"
    first = _put(client, url, png()).json()["sha256"]
    second = _put(client, url, png(colour=(1, 2, 3))).json()["sha256"]
    assert first != second
    assert client.get(url).headers["etag"] == f'"{second}"'
    assert [v["sha256"] for v in client.get(f"{base}/pointclouds/{cloud_id}/views").json()["items"]] == [
        second
    ]


@pytest.mark.parametrize(
    ("data", "reason"),
    [(png(1600, 1001), "wrong_size"), (gif(), "wrong_format"), (b"junk", "not_an_image")],
    ids=["wrong_size", "wrong_format", "not_an_image"],  # byte payloads would make huge node ids
)
def test_a_refused_upload_writes_nothing(client, base, handle, crack, cloud_id, data, reason):
    fid = _finding(client, base, crack["id"], cloud_id)
    r = _put(client, f"{base}/findings/{fid}/view3d", data)
    assert _code(r) == (422, "bad_view_image")
    assert r.json()["error"]["details"] == {"reason": reason}
    folder = views.views_dir(handle, cloud_id)
    assert not folder.exists() or list(folder.iterdir()) == []
    assert _code(client.get(f"{base}/findings/{fid}/view3d")) == (404, "no_view")


def test_an_upload_over_6_mib_is_too_large(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    r = _put(client, f"{base}/findings/{fid}/view3d", b"\x89PNG\r\n\x1a\n" + b"\0" * views.MAX_BYTES)
    assert (r.status_code, r.json()["error"]["details"]) == (422, {"reason": "too_large"})


def test_malformed_or_missing_parts_are_validation_errors(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    url = f"{base}/findings/{fid}/view3d"
    assert _code(_put(client, url, png(), meta="{nope")) == (422, "validation_error")
    assert _code(client.put(url, files={"image": ("v.png", png(), "image/png")})) == (422, "validation_error")
    assert _code(client.put(url, data={"meta": meta_json()})) == (422, "validation_error")
    assert _code(client.put(url, json=META)) == (422, "validation_error")


def test_unknown_subjects_answer_404_before_the_body_is_read(client, base, cloud_id):
    assert _code(_put(client, f"{base}/findings/nope/view3d", b"junk")) == (404, "not_found")
    assert _code(client.get(f"{base}/findings/nope/view3d")) == (404, "not_found")
    url = f"{base}/pointclouds/{cloud_id}/measurements/nope/view3d"
    assert _code(_put(client, url, b"junk")) == (404, "not_found")
    assert _code(client.get(url)) == (404, "not_found")
    assert _code(client.get(f"{base}/pointclouds/nope/views")) == (404, "not_found")
    assert (
        client.put(
            f"{API}/nope/findings/f1/view3d", files={"image": ("v.png", b"x", "image/png")}
        ).status_code
        == 404
    )


def test_a_map_finding_has_no_3d_view(client, base, handle, crack):
    map_id = insert_map(handle)
    anchor = {
        "kind": "map",
        "map_id": map_id,
        "geometry": {"type": "Point", "coordinates": [583120.4, 3265410.2]},
    }
    body = {"type_id": crack["id"], "anchor": anchor, "lon": 47.7625, "lat": 29.4951}
    fid = client.post(f"{base}/findings", json=body).json()["id"]
    assert _code(_put(client, f"{base}/findings/{fid}/view3d", png())) == (409, "not_a_cloud_finding")
    assert _code(client.get(f"{base}/findings/{fid}/view3d")) == (404, "no_view")


def test_each_put_publishes_pointclouds_changed(client, base, app, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    seen = []
    original = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), original(e))
    _put(client, f"{base}/findings/{fid}/view3d", png())
    assert [e["payload"] for e in seen if e["type"] == "pointclouds.changed"] == [{"cloud_ids": [cloud_id]}]


def test_list_returns_metadata_only_and_stale_after_a_move(client, base, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    _put(client, f"{base}/findings/{fid}/view3d", png(), meta=meta_json(anchor_normal=[0, 0, 1]))
    items = client.get(f"{base}/pointclouds/{cloud_id}/views").json()["items"]
    assert set(items[0]) == {
        "subject_kind",
        "subject_id",
        "pose",
        "render",
        "anchor_normal",
        "sha256",
        "bytes",
        "width",
        "height",
        "captured_at",
        "stale",
    }
    assert (items[0]["anchor_normal"], items[0]["stale"]) == ([0.0, 0.0, 1.0], False)
    assert client.patch(f"{base}/findings/{fid}", json={"anchor": {"z": 13.0}}).status_code == 200
    assert client.get(f"{base}/pointclouds/{cloud_id}/views").json()["items"][0]["stale"] is True


def test_deleting_a_finding_leaves_a_file_the_next_list_sweeps(client, base, handle, crack, cloud_id):
    fid = _finding(client, base, crack["id"], cloud_id)
    _put(client, f"{base}/findings/{fid}/view3d", png())
    path = views.views_dir(handle, cloud_id) / f"finding-{fid}.png"
    assert client.delete(f"{base}/findings/{fid}").status_code == 204
    assert path.is_file()  # F's delete knows nothing of views: the row cascades, the file stays
    assert client.get(f"{base}/pointclouds/{cloud_id}/views").json()["items"] == []
    assert path.is_file()  # young: spared by the grace window
    old = time.time() - 3600
    os.utime(path, (old, old))
    client.get(f"{base}/pointclouds/{cloud_id}/views")
    assert not path.exists()
    assert _code(client.get(f"{base}/findings/{fid}/view3d")) == (404, "not_found")


def test_the_view_routes_are_no_longer_stubs():
    from app.pointclouds import router

    stubbed = {op for _, _, op in router.STUBS}
    names = {"putFindingView3d", "getFindingView3d", "putCloudMeasurementView3d", "getCloudMeasurementView3d"}
    assert not stubbed & (names | {"listCloudViews"})
    assert not hasattr(router, "UPLOAD_STUBS")
