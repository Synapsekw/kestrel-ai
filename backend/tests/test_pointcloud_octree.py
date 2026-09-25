"""Octree serving (spec §7): Range rules, the filename enum, readiness, caching, the preflight."""

import os

import pytest
from pointclouds import insert_cloud

from app.pointclouds import octree, rows

BASE = "/api/v1/projects"
MIB = 1024 * 1024


@pytest.fixture
def project_kind() -> str:
    return "detect"


@pytest.fixture
def cloud(handle):
    cloud_id = insert_cloud(handle)
    folder = rows.octree_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    (folder / "metadata.json").write_bytes(b'{"version": "2.0"}')
    (folder / "hierarchy.bin").write_bytes(bytes(range(256)) * 4)  # 1024 bytes
    (folder / "octree.bin").write_bytes(os.urandom(3 * MIB))
    return cloud_id, folder


def url(project_id, cloud_id, name):
    return f"{BASE}/{project_id}/pointclouds/{cloud_id}/octree/{name}"


@pytest.mark.parametrize(
    ("header", "start", "end"),
    [
        ("bytes=0-21", 0, 21),
        ("bytes=100-", 100, 1023),
        ("bytes=-10", 1014, 1023),
        ("bytes=1000-5000", 1000, 1023),
    ],
)
def test_single_ranges_answer_206_with_the_exact_slice(client, project_id, cloud, header, start, end):
    cloud_id, folder = cloud
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": header})
    assert r.status_code == 206
    assert r.content == (folder / "hierarchy.bin").read_bytes()[start : end + 1]
    assert r.headers["content-range"] == f"bytes {start}-{end}/1024"
    assert r.headers["content-length"] == str(end - start + 1)
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_metadata_is_json_and_small_files_come_whole(client, project_id, cloud):
    cloud_id, _ = cloud
    r = client.get(url(project_id, cloud_id, "metadata.json"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"version": "2.0"} and r.headers["accept-ranges"] == "bytes"


@pytest.mark.parametrize(
    "header", ["bytes=0-1,5-6", "bytes=abc", "items=0-1", "bytes=5-1", "bytes=1024-", "bytes=-0", "bytes=-"]
)
def test_unsatisfiable_ranges_are_416(client, project_id, cloud, header):
    cloud_id, _ = cloud
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": header})
    assert r.status_code == 416
    assert r.headers["content-range"] == "bytes */1024"
    assert r.json()["error"]["code"] == "range_not_satisfiable"


def test_more_than_64_mib_is_416_with_or_without_a_range(client, project_id, cloud):
    cloud_id, folder = cloud
    with open(folder / "octree.bin", "r+b") as f:
        f.truncate(65 * MIB)
    assert (
        client.get(url(project_id, cloud_id, "octree.bin"), headers={"Range": "bytes=0-"}).status_code == 416
    )
    assert client.get(url(project_id, cloud_id, "octree.bin")).status_code == 416
    r = client.get(url(project_id, cloud_id, "octree.bin"), headers={"Range": f"bytes=0-{64 * MIB - 1}"})
    assert r.status_code == 206 and len(r.content) == 64 * MIB


def test_streams_in_one_mib_chunks(cloud):
    _, folder = cloud
    chunks = list(octree.stream(folder / "octree.bin", 10, 3 * MIB - 10))
    assert [len(c) for c in chunks[:-1]] == [MIB] * (len(chunks) - 1)
    assert sum(map(len, chunks)) == 3 * MIB - 10


@pytest.mark.parametrize(
    "name", ["source.json", "octree.bin.bak", "metadata.json.", "OCTREE.BIN", "hierarchy"]
)
def test_other_names_are_422_and_never_touch_the_disk(client, project_id, cloud, monkeypatch, name):
    cloud_id, _ = cloud

    def spy(_path):
        raise AssertionError("open() must not be reached")

    monkeypatch.setattr(octree, "_open", spy)
    r = client.get(url(project_id, cloud_id, name))
    assert r.status_code == 422


def test_traversal_never_reaches_the_disk(client, project_id, cloud, monkeypatch):
    cloud_id, _ = cloud

    def spy(_path):
        raise AssertionError("open() must not be reached")

    monkeypatch.setattr(octree, "_open", spy)
    r = client.get(f"{BASE}/{project_id}/pointclouds/{cloud_id}/octree/..%2Fsource.json")
    assert r.status_code in (404, 422)


def test_unknown_cloud_is_404_and_importing_is_409(client, project_id, handle):
    assert client.get(url(project_id, "nope", "metadata.json")).status_code == 404
    importing = insert_cloud(handle, status="importing")
    r = client.get(url(project_id, importing, "metadata.json"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_missing_octree_files_say_so(client, project_id, cloud):
    """Review Focus 5: the folder was cleaned by hand."""
    cloud_id, folder = cloud
    (folder / "hierarchy.bin").unlink()
    r = client.get(url(project_id, cloud_id, "hierarchy.bin"), headers={"Range": "bytes=0-21"})
    assert r.status_code == 404
    assert r.json()["error"] == {
        "code": "octree_missing",
        "message": "the 3D view copy is missing; import the file again",
        "details": {},
    }


def test_the_token_query_param_authorises(anon, project_id, cloud):
    cloud_id, _ = cloud
    assert anon.get(url(project_id, cloud_id, "metadata.json")).status_code == 401
    assert anon.get(url(project_id, cloud_id, "metadata.json") + "?token=test-token").status_code == 200


def test_the_loaders_preflight_is_answered(anon, project_id, cloud):
    cloud_id, _ = cloud
    r = anon.options(
        url(project_id, cloud_id, "hierarchy.bin"),
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,range",
        },
    )
    assert r.status_code == 200
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "range" in allowed and "content-type" in allowed


def test_range_headers_are_exposed_to_the_page(client, project_id, cloud):
    cloud_id, _ = cloud
    r = client.get(
        url(project_id, cloud_id, "hierarchy.bin"),
        headers={"Range": "bytes=0-21", "Origin": "http://tauri.localhost"},
    )
    assert "content-range" in r.headers["access-control-expose-headers"].lower()
