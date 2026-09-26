"""Comments, attachments and thumbnails (spec 2026-09-26-foundation sections 8.3, 14, 15)."""

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from findings_helpers import insert_box, insert_cloud
from PIL import Image as PILImage

from app.appdata import AppData
from app.findings import attachments, service, thumbnails, trash
from app.findings.anchors import AnchorIn
from app.main import project_opened

API = "/api/v1"


@pytest.fixture
def ctx(client, project, crack, handle) -> dict:
    cloud = insert_cloud(handle)
    base = f"{API}/projects/{project['id']}"
    body = {
        "type_id": crack["id"],
        "anchor": {"kind": "cloud", "cloud_id": cloud, "x": 0.0, "y": 0.0, "z": 0.0},
    }
    f = client.post(f"{base}/findings", json=body).json()
    return {"base": base, "fid": f["id"], "url": f"{base}/findings/{f['id']}"}


def _error(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def test_comments_thread_oldest_first_with_the_settings_name(client, settings, ctx):
    assert client.post(f"{ctx['url']}/comments", json={"text": "first"}).json()["author"] == "Operator"
    AppData(settings.data_dir).write_settings({"operator_name": "Dana"})
    second = client.post(f"{ctx['url']}/comments", json={"text": "second"}).json()
    assert second["author"] == "Dana" and second["edited_at"] is None
    page = client.get(f"{ctx['url']}/comments", params={"limit": 1}).json()
    assert [c["text"] for c in page["items"]] == ["first"]
    rest = client.get(f"{ctx['url']}/comments", params={"cursor": page["next_cursor"]}).json()
    assert [c["text"] for c in rest["items"]] == ["second"]
    edited = client.patch(f"{ctx['url']}/comments/{second['id']}", json={"text": "second, edited"}).json()
    assert edited["text"] == "second, edited" and edited["edited_at"] is not None
    assert client.get(ctx["url"]).json()["comment_count"] == 2
    assert client.delete(f"{ctx['url']}/comments/{second['id']}").status_code == 204
    assert client.get(ctx["url"]).json()["comment_count"] == 1
    kinds = [
        a["kind"]
        for a in client.get(f"{ctx['base']}/activity", params={"subject_id": ctx["fid"]}).json()["items"]
    ]
    assert kinds.count("finding.comment") == 2


def test_the_operator_name_is_read_and_written_through_the_settings_api(client, settings, ctx):
    AppData(settings.data_dir).write_settings({"providers": {"openai": {"model": "x"}}})
    assert client.get(f"{API}/settings/operator").json() == {"operator_name": None}
    assert client.put(f"{API}/settings/operator", json={"operator_name": "  Dana  "}).json() == {
        "operator_name": "Dana"
    }
    assert client.post(f"{ctx['url']}/comments", json={"text": "hi"}).json()["author"] == "Dana"
    stored = AppData(settings.data_dir).read_settings()
    assert stored["operator_name"] == "Dana" and stored["providers"] == {"openai": {"model": "x"}}
    assert client.put(f"{API}/settings/operator", json={"operator_name": "   "}).json() == {
        "operator_name": None
    }
    assert "operator_name" not in AppData(settings.data_dir).read_settings()
    assert client.post(f"{ctx['url']}/comments", json={"text": "again"}).json()["author"] == "Operator"


def test_an_unreadable_settings_file_is_never_overwritten(client, settings, ctx, caplog):
    path = settings.data_dir / "settings.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'{"providers": {"openai": ')  # truncated: provider settings share this file
    before = path.read_bytes()
    assert _error(client.put(f"{API}/settings/operator", json={"operator_name": "Dana"})) == (
        500,
        "internal_error",
    )
    assert path.read_bytes() == before
    assert client.get(f"{API}/settings/operator").json() == {"operator_name": None}
    assert client.post(f"{ctx['url']}/comments", json={"text": "hi"}).json()["author"] == "Operator"
    assert "settings" in caplog.text


def test_a_blank_or_long_comment_is_refused(client, ctx):
    assert _error(client.post(f"{ctx['url']}/comments", json={"text": "   "})) == (409, "comment_blank")
    assert client.post(f"{ctx['url']}/comments", json={"text": "x" * 4001}).status_code == 422


def test_a_comment_of_another_finding_or_an_unknown_finding_is_404(client, handle, crack, ctx):
    c = client.post(f"{ctx['url']}/comments", json={"text": "mine"}).json()
    anchor = {"kind": "cloud", "cloud_id": insert_cloud(handle, name="Other"), "x": 0.0, "y": 0.0, "z": 0.0}
    other = client.post(f"{ctx['base']}/findings", json={"type_id": crack["id"], "anchor": anchor}).json()
    other_url = f"{ctx['base']}/findings/{other['id']}"
    assert _error(client.patch(f"{other_url}/comments/{c['id']}", json={"text": "x"})) == (404, "not_found")
    assert _error(client.delete(f"{other_url}/comments/{c['id']}")) == (404, "not_found")
    assert _error(client.get(f"{ctx['base']}/findings/nope/comments")) == (404, "not_found")
    assert _error(client.post(f"{ctx['base']}/findings/nope/attachments", json={"path": "C:/x.jpg"})) == (
        404,
        "not_found",
    )


def test_an_attachment_is_checked_copied_and_thumbnailed(client, handle, ctx, tmp_path, make_jpeg):
    src = make_jpeg(tmp_path / "site photo.jpg", 640, 480, seed=3)
    r = client.post(f"{ctx['url']}/attachments", json={"path": str(src)})
    assert r.status_code == 201, r.text
    a = r.json()
    assert (a["original_name"], a["width"], a["height"], a["bytes"]) == (
        "site photo.jpg",
        640,
        480,
        src.stat().st_size,
    )
    copied = handle.folder / "findings" / ctx["fid"] / f"{a['id']}.jpg"
    assert copied.read_bytes() == src.read_bytes()
    assert client.get(f"{ctx['url']}/attachments/{a['id']}/file").content == src.read_bytes()
    thumb = PILImage.open(BytesIO(client.get(f"{ctx['url']}/attachments/{a['id']}/thumbnail").content))
    assert max(thumb.size) == 256
    assert [i["id"] for i in client.get(f"{ctx['url']}/attachments").json()["items"]] == [a["id"]]
    assert client.get(ctx["url"]).json()["attachment_count"] == 1
    assert client.delete(f"{ctx['url']}/attachments/{a['id']}").status_code == 204
    assert not copied.exists()
    assert list((handle.folder / "findings" / "_trash").glob(f"{ctx['fid']}-*/{a['id']}.jpg"))


@pytest.mark.parametrize("kind", ["missing", "relative", "text", "gif", "too_large"])
def test_a_bad_attachment_is_attachment_invalid(client, ctx, tmp_path, make_jpeg, monkeypatch, kind):
    path = tmp_path / "x.jpg"
    reason = {
        "missing": "not_found",
        "relative": "not_absolute",
        "text": "not_an_image",
        "gif": "not_an_image",
        "too_large": "too_large",
    }[kind]
    if kind == "relative":
        path = "photos/x.jpg"
    elif kind == "text":
        path.write_text("not a photo")
    elif kind == "gif":
        path = tmp_path / "x.gif"
        PILImage.new("RGB", (8, 8)).save(path, "GIF")
    elif kind == "too_large":
        make_jpeg(path, 64, 48)
        monkeypatch.setattr(attachments, "MAX_BYTES", 10)
    r = client.post(f"{ctx['url']}/attachments", json={"path": str(path)})
    assert _error(r) == (422, "attachment_invalid")
    assert r.json()["error"]["details"]["reason"] == reason


def test_the_finding_thumbnail_falls_back_to_the_first_attachment(client, ctx, tmp_path, make_jpeg):
    assert client.get(f"{ctx['url']}/thumbnail").status_code == 404
    client.post(f"{ctx['url']}/attachments", json={"path": str(make_jpeg(tmp_path / "p.jpg", 300, 200))})
    r = client.get(f"{ctx['url']}/thumbnail")
    assert (r.status_code, r.headers["content-type"]) == (200, "image/jpeg")
    assert PILImage.open(BytesIO(r.content)).size == thumbnails.SIZE  # a 3:2 photo, letterboxed


def test_an_image_finding_thumbnail_crops_around_its_box_and_follows_a_move(client, handle, crack, make_jpeg):
    image_id, box_id = insert_box(handle, crack["id"])  # a 100 x 100 image, box (0.5, 0.5, 0.1, 0.1)
    make_jpeg((handle.folder / "images").joinpath("a.jpg"), 100, 100)
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="image", image_id=image_id, annotation_id=box_id)
    )
    first = thumbnails.finding_thumbnail(handle, f.id)
    assert PILImage.open(first).size == thumbnails.SIZE
    url = f"{API}/projects/{handle.id}/findings/{f.id}/thumbnail"
    assert client.get(url).content == first.read_bytes()
    from app.db.models import Box

    with handle.session() as s:
        s.get(Box, box_id).x = 40.0
    assert thumbnails.finding_thumbnail(handle, f.id) != first


def test_the_crop_window_is_4_by_3_padded_and_kept_inside_the_image():
    assert thumbnails.crop_window(100, 100, 400, 300, 0, 1000, 1000) == (0, 25, 600, 475)  # 25% padding
    assert thumbnails.crop_window(10, 10, 20, 20, 0, 1000, 1000) == (0, 0, 160, 120)  # never below SIZE
    assert thumbnails.crop_window(900, 900, 90, 90, 0, 1000, 1000) == (820, 865, 1000, 1000)  # moved in
    assert thumbnails.crop_window(40, 40, 0.1, 0.1, 0, 100, 100) == (0, 0, 100, 100)  # sub-pixel box
    assert thumbnails.crop_window(0, 0, 900, 900, 0, 100, 80) == (0, 0, 100, 80)


def test_an_attachment_delete_and_a_finding_delete_in_the_same_second_both_reach_the_trash(
    client, handle, ctx, tmp_path, make_jpeg
):
    first = client.post(
        f"{ctx['url']}/attachments", json={"path": str(make_jpeg(tmp_path / "a.jpg", 64, 48))}
    )
    second = client.post(
        f"{ctx['url']}/attachments", json={"path": str(make_jpeg(tmp_path / "b.jpg", 64, 48))}
    )
    a, b = first.json()["id"], second.json()["id"]
    now = datetime(2026, 9, 26, 10, 0, 0, tzinfo=UTC)
    with handle.session() as s:
        from app.db.models import FindingAttachment

        rel = s.get(FindingAttachment, a).path
        s.delete(s.get(FindingAttachment, a))
    trash.move_file(handle, rel, now=now)
    with handle.session() as s:
        service.delete_in_session(s, project_id=handle.id, finding_id=ctx["fid"])
    assert trash.move(handle, [ctx["fid"]], now=now) == 1
    root = handle.folder / "findings" / "_trash"
    assert len(list(root.glob(f"{ctx['fid']}-*/{a}.jpg"))) == 1
    assert len(list(root.glob(f"{ctx['fid']}-*/{b}.jpg"))) == 1
    assert trash.purge(handle, now=now + timedelta(days=31)) == 2
    assert not list(root.iterdir())


def test_the_trash_is_purged_when_the_project_opens(client, handle):
    old = (datetime.now(UTC) - timedelta(days=31)).strftime(trash.STAMP)
    entry = handle.folder / "findings" / "_trash" / f"f1-{old}"
    entry.mkdir(parents=True)
    project_opened(handle, client.app.state.jobs)
    assert not entry.exists()
