import json
import shutil
import time

from PIL import Image as PILImage

from app.db.models import Image


def _wait(client, pid, jid, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/projects/{pid}/jobs/{jid}").json()
        if j["state"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.1)
    raise AssertionError("import did not finish")


def _gradient(path, size=(640, 480), quality=95):
    path.parent.mkdir(parents=True, exist_ok=True)
    PILImage.linear_gradient("L").rotate(20).convert("RGB").resize(size).save(path, "JPEG", quality=quality)
    return path


def test_import_sample_frames(client, project, ahmadia_sample, project_dir):
    pid = project["id"]
    r = client.post(
        f"/api/v1/projects/{pid}/sources", json={"folder": str(ahmadia_sample), "site": "ahmadia"}
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["source"]["site"] == "ahmadia" and body["job"]["type"] == "import"
    assert body["source"]["folder"] == str(ahmadia_sample)
    assert body["source"]["settings"]["max_side"] == 4000  # project import defaults
    job = _wait(client, pid, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"] == {
        "source_id": body["source"]["id"],
        "imported": 20,
        "duplicates": 0,
        "failed": 0,
        "skipped": 0,
    }
    src = client.get(f"/api/v1/projects/{pid}/sources/{body['source']['id']}").json()
    assert src["image_count"] == 20 and src["duplicate_count"] == 0 and src["imported_at"]
    assert src["job_id"] == body["job"]["id"]
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        imgs = s.query(Image).order_by(Image.path).all()
        assert len(imgs) == 20
        first = imgs[0]
        assert first.path == "images/ahmadia/IX-12-02491_0031_0001.jpg"
        assert (first.width, first.height, first.phash, first.group_key) == (
            4000,
            2667,
            "82a81f67f94615ae",
            "0031",
        )
        assert first.capture_time.year == 2019 and abs(first.lat - 29.49469) < 1e-4
        assert first.source_id == body["source"]["id"]
    assert (project_dir / "images" / "ahmadia" / "IX-12-02491_0031_0001.jpg").exists()
    assert (project_dir / "images" / "ahmadia" / ".duplicates.json").exists()
    # the originals are untouched
    assert len(list(ahmadia_sample.glob("*.jpg"))) == 20


def test_reimport_adds_only_new_files(client, project, ahmadia_sample, tmp_path, make_jpeg):
    folder = tmp_path / "src"
    folder.mkdir()
    for f in sorted(ahmadia_sample.glob("*.jpg"))[:3]:
        shutil.copy2(f, folder / f.name)
    pid = project["id"]
    first = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    assert _wait(client, pid, first["job"]["id"])["result"]["imported"] == 3
    make_jpeg(folder / "ZZ_0099_0001.jpg", 800, 600, seed=7)
    second = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    assert second["source"]["id"] == first["source"]["id"]
    res = _wait(client, pid, second["job"]["id"])["result"]
    assert res["imported"] == 1 and res["skipped"] == 3
    source = client.get(f"/api/v1/projects/{pid}/sources/{first['source']['id']}").json()
    assert source["image_count"] == 4 and source["job_id"] == second["job"]["id"]
    assert source["site"] == "src"  # slugified folder name


def test_near_duplicates_are_recorded_not_imported(client, project, tmp_path, project_dir, make_jpeg):
    folder = tmp_path / "dup"
    a = _gradient(folder / "A_0001_0001.jpg")
    PILImage.open(a).save(folder / "A_0001_0002.jpg", "JPEG", quality=70)  # near-duplicate, 2 bits away
    make_jpeg(folder / "A_0001_0003.jpg", 640, 480, seed=2)  # noise, far from the gradient
    pid = project["id"]
    body = client.post(
        f"/api/v1/projects/{pid}/sources", json={"folder": str(folder), "settings": {"dedupe_threshold": 4}}
    ).json()
    res = _wait(client, pid, body["job"]["id"])["result"]
    assert res["imported"] == 2 and res["duplicates"] == 1
    site = body["source"]["site"]
    assert not (project_dir / "images" / site / "A_0001_0002.jpg").exists()
    dups = json.loads((project_dir / "images" / site / ".duplicates.json").read_text())
    assert dups["A_0001_0002.jpg"]["duplicate_of"] == "A_0001_0001.jpg"
    assert dups["A_0001_0002.jpg"]["hamming"] <= 4
    assert client.get(f"/api/v1/projects/{pid}/sources/{body['source']['id']}").json()["duplicate_count"] == 1
    assert (folder / "A_0001_0002.jpg").exists()  # the original is never removed


def test_group_falls_back_to_tile_and_site(client, project, tmp_path, make_jpeg):
    folder = tmp_path / "g"
    make_jpeg(folder / "DJI_0001.jpg", 100, 80, seed=3, exif={"lat": 29.5, "lon": 47.7})
    make_jpeg(folder / "DJI_0002.jpg", 100, 80, seed=4)
    pid = project["id"]
    body = client.post(
        f"/api/v1/projects/{pid}/sources", json={"folder": str(folder), "site": "site_x"}
    ).json()
    assert _wait(client, pid, body["job"]["id"])["state"] == "succeeded"
    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        keys = {i.path.split("/")[-1]: i.group_key for i in s.query(Image).all()}
    assert keys["DJI_0001.jpg"].startswith("tile_") and keys["DJI_0002.jpg"] == "site_x"


def test_unreadable_files_are_counted_as_failed(client, project, tmp_path, make_jpeg):
    folder = tmp_path / "broken"
    make_jpeg(folder / "ok.jpg", 64, 64, seed=5)
    (folder / "bad.jpg").write_bytes(b"not an image")
    pid = project["id"]
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    res = _wait(client, pid, body["job"]["id"])["result"]
    assert res["imported"] == 1 and res["failed"] == 1


def test_source_folder_must_exist_and_be_absolute(client, project, tmp_path):
    pid = project["id"]
    relative = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": "relative/x"})
    assert relative.status_code == 422 and relative.json()["error"]["code"] == "validation_error"
    # A well-formed absolute path that is not on disk is a missing resource, not a malformed request.
    missing = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(tmp_path / "missing")})
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"


def test_unknown_source_is_not_found(client, project):
    pid = project["id"]
    assert client.get(f"/api/v1/projects/{pid}/sources/nope").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/sources/nope/stats").status_code == 404


def test_cancel_import(client, project, ahmadia_sample):
    pid = project["id"]
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(ahmadia_sample)}).json()
    client.post(f"/api/v1/projects/{pid}/jobs/{body['job']['id']}/cancel")
    j = _wait(client, pid, body["job"]["id"])
    assert j["state"] == "cancelled", j
    assert client.get(f"/api/v1/projects/{pid}/sources").status_code == 200
    # cancelling leaves the source importable again: nothing is half-written to the DB
    assert client.get(f"/api/v1/projects/{pid}/sources/{body['source']['id']}").json()["imported_at"] is None


def test_sources_list_paginates(client, project, tmp_path, make_jpeg):
    pid = project["id"]
    for i in range(3):
        f = tmp_path / f"s{i}"
        make_jpeg(f / "a.jpg", 10, 10, seed=i)
        assert client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(f)}).status_code == 202
    page = client.get(f"/api/v1/projects/{pid}/sources", params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = client.get(
        f"/api/v1/projects/{pid}/sources", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
    sites = [s["site"] for s in page["items"] + page2["items"]]
    assert sites == ["s0", "s1", "s2"]  # created_at ascending, no duplicates across pages


def test_two_sources_can_share_a_site(client, project, import_source, tmp_path, make_jpeg, project_dir):
    """Same site, same file names, different folders: both must import in full."""
    pid = project["id"]
    for folder, base in (("a", 1), ("b", 11)):
        for i in (1, 2):
            make_jpeg(tmp_path / folder / f"DJI_000{i}.jpg", 120, 90, seed=base + i)
    first = import_source(pid, tmp_path / "a", site="shared")
    second = import_source(pid, tmp_path / "b", site="shared")
    assert first != second

    handle = client.app.state.projects.get(pid)
    with handle.session() as s:
        paths = sorted(i.path for i in s.query(Image).all())
    assert paths == [
        "images/shared/DJI_0001.jpg",
        "images/shared/DJI_0001_1.jpg",
        "images/shared/DJI_0002.jpg",
        "images/shared/DJI_0002_1.jpg",
    ]
    for source_id in (first, second):
        assert client.get(f"/api/v1/projects/{pid}/sources/{source_id}").json()["image_count"] == 2
    assert len(list((project_dir / "images" / "shared").glob("*.jpg"))) == 4

    # and the name plan is stable: re-importing either source adds nothing
    body = client.post(
        f"/api/v1/projects/{pid}/sources", json={"folder": str(tmp_path / "b"), "site": "shared"}
    ).json()
    res = _wait(client, pid, body["job"]["id"])["result"]
    assert res == {"source_id": second, "imported": 0, "duplicates": 0, "failed": 0, "skipped": 2}


def test_recorded_duplicates_are_not_reconverted(client, project, tmp_path, project_dir):
    pid = project["id"]
    folder = tmp_path / "dup"
    a = _gradient(folder / "A_0001_0001.jpg")
    PILImage.open(a).save(folder / "A_0001_0002.jpg", "JPEG", quality=70)
    body = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    assert _wait(client, pid, body["job"]["id"])["result"]["duplicates"] == 1

    again = client.post(f"/api/v1/projects/{pid}/sources", json={"folder": str(folder)}).json()
    res = _wait(client, pid, again["job"]["id"])["result"]
    # the known duplicate is skipped outright, not converted and deleted a second time
    assert res == {
        "source_id": body["source"]["id"],
        "imported": 0,
        "duplicates": 0,
        "failed": 0,
        "skipped": 2,
    }
    assert not (project_dir / "images" / body["source"]["site"] / "A_0001_0002.jpg").exists()
    assert client.get(f"/api/v1/projects/{pid}/sources/{body['source']['id']}").json()["duplicate_count"] == 1
