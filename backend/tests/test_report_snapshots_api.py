"""R3: GET /projects/{projectId}/report-snapshots/{snapshotKey}?spec= (spec §9.5, §14)."""

import os
from urllib.parse import unquote

from report_snapshot_helpers import add_image

from app.reports.snapshots.cache import cached_path
from app.reports.snapshots.image_crop import ring_of
from app.reports.snapshots.keys import encode_spec, snapshot_key
from app.reports.snapshots.render import parse_spec

BASE = "/api/v1/projects"


def _url(project_id, key, spec) -> str:
    return f"{BASE}/{project_id}/report-snapshots/{key}?spec={encode_spec(spec)}"


def _spec(image_id):
    return parse_spec(
        {
            "kind": "image_crop",
            "image_id": image_id,
            "ring": ring_of("box", 900, 700, 200, 100),
            "colour": "#ff5a4f",
            "label": "F-0001 · Crack",
            "context": 3.0,
            "out": [1200, 900],
            "inset": False,
        }
    )


def test_a_snapshot_is_rendered_once_and_served_immutable(client, project_id, handle):
    spec = _spec(add_image(handle, "a.jpg", (2000, 1500)))
    key = snapshot_key(handle, spec)
    r = client.get(_url(project_id, key, spec))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/jpeg" and "immutable" in r.headers["cache-control"]
    assert cached_path(handle, key).read_bytes() == r.content
    assert client.get(_url(project_id, key, spec)).content == r.content


def test_a_wrong_key_is_refused_with_the_servers_key(client, project_id, handle):
    spec = _spec(add_image(handle, "a.jpg", (2000, 1500)))
    r = client.get(_url(project_id, "0" * 32, spec))
    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "snapshot_key_mismatch" and body["details"]["key"] == snapshot_key(handle, spec)


def test_a_malformed_spec_is_refused(client, project_id):
    too_big = {
        "kind": "image_crop",
        "image_id": "x",
        "ring": [[0.0, 0.0]],
        "colour": "#ffffff",
        "label": "x",
        "context": 3.0,
        "out": [99999, 900],
        "inset": False,
    }
    for text in ("!!!", encode_spec({"kind": "nope"}), encode_spec(too_big)):
        r = client.get(f"{BASE}/{project_id}/report-snapshots/{'0' * 32}?spec={text}")
        assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_snapshot_spec", text


def test_a_missing_source_serves_a_placeholder_the_browser_never_caches(client, project_id, handle):
    spec = _spec("gone")
    r = client.get(_url(project_id, snapshot_key(handle, spec), spec))
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "no-store"
    assert unquote(r.headers["x-snapshot-missing"]) == "The image was deleted"


def test_a_changed_source_changes_the_key(client, project_id, handle):
    spec = _spec(add_image(handle, "a.jpg", (2000, 1500)))
    old = snapshot_key(handle, spec)
    path = handle.folder / "images" / "a.jpg"
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    assert client.get(_url(project_id, old, spec)).status_code == 400
    assert client.get(_url(project_id, snapshot_key(handle, spec), spec)).status_code == 200
