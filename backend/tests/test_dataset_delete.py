"""Deleting a dataset (S2): the folder and rows go, images/labels/models stay."""

import pytest

from app.db.models import Job, Model

BASE = "/api/v1/projects"
FLIGHTS = {"0031": 6, "0033": 3}
WIDTH, HEIGHT = 400, 300


@pytest.fixture
def labeled_dataset(client, project, import_source, tmp_path, make_jpeg, wait_job):
    """A dataset frozen from nine labelled frames in two flights (mirrors test_datasets.labelled_project)."""
    pid = project["id"]
    folder = tmp_path / "frames"
    seed = 0
    for flight, count in FLIGHTS.items():
        for i in range(1, count + 1):
            seed += 1
            make_jpeg(folder / f"IX-12-02491_{flight}_{i:04d}.jpg", WIDTH, HEIGHT, seed=seed)
    import_source(pid, folder)
    classes = [c["id"] for c in project["classes"]]
    images = client.get(f"{BASE}/{pid}/images", params={"limit": 100}).json()["items"]
    for image in images:
        r = client.post(
            f"{BASE}/{pid}/images/{image['id']}/boxes",
            json={"class_id": classes[0], "x": 100, "y": 60, "w": 40, "h": 60},
        )
        assert r.status_code == 201, r.text
    created = client.post(f"{BASE}/{pid}/datasets", json={"name": "v1"}).json()
    finished = wait_job(pid, created["job"]["id"])
    assert finished["state"] == "succeeded", finished
    return client.get(f"{BASE}/{pid}/datasets/{created['dataset']['id']}").json()


def test_delete_removes_the_folder_and_the_rows_and_keeps_the_images(
    client, project_id, handle, labeled_dataset
):
    ds = labeled_dataset
    folder = handle.folder / ds["path"]
    assert folder.is_dir()
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 204, r.text
    assert not folder.exists()
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 404
    assert client.get(f"{BASE}/{project_id}/datasets").json()["items"] == []
    assert client.get(f"{BASE}/{project_id}/images").json()["total"] > 0
    # the name is free again
    assert client.post(f"{BASE}/{project_id}/datasets", json={"name": ds["name"]}).status_code == 202


def test_delete_is_refused_while_a_training_job_uses_the_dataset(client, project_id, handle, labeled_dataset):
    with handle.session() as s:
        s.add(
            Job(
                type="train",
                state="running",
                params={"dataset_id": labeled_dataset["id"]},
            )
        )
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    # the folder is untouched
    assert (handle.folder / labeled_dataset["path"]).is_dir()


def test_a_model_trained_on_a_deleted_dataset_still_lists(client, project_id, handle, labeled_dataset):
    with handle.session() as s:
        s.add(
            Model(
                name="m1",
                kind="trained",
                weights_path="models/m1.pt",
                dataset_id=labeled_dataset["id"],
                class_names=["excavator"],
            )
        )
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 204, r.text
    page = client.get(f"{BASE}/{project_id}/models").json()
    assert len(page["items"]) == 1
    assert page["items"][0]["dataset_id"] == labeled_dataset["id"]


def test_delete_unknown_is_404(client, project_id):
    assert client.delete(f"{BASE}/{project_id}/datasets/nope").status_code == 404


# ------------------------------------------------------------------ folder safety
# Deleting removes a folder on the operator's disk. Whatever the row says, nothing outside
# `<project>/datasets/<something>` may ever be removed, and a refusal must change nothing.


def _set_path(handle, dataset_id, path):
    from app.db.models import Dataset

    with handle.session() as s:
        s.get(Dataset, dataset_id).path = path


@pytest.mark.parametrize("bad_path", ["datasets", "datasets/", ".", "", "datasets/../images", "../outside"])
def test_a_row_that_points_anywhere_else_is_refused_and_nothing_changes(
    client, project_id, handle, labeled_dataset, bad_path
):
    ds = labeled_dataset
    real_folder = handle.folder / ds["path"]
    outside = handle.folder.parent / "outside"
    outside.mkdir(exist_ok=True)
    (outside / "keep.txt").write_text("keep")
    _set_path(handle, ds["id"], bad_path)

    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")

    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert real_folder.is_dir() and any(real_folder.rglob("*.jpg"))  # every dataset is still there
    assert handle.datasets_dir.is_dir() and handle.images_dir.is_dir()
    assert (outside / "keep.txt").read_text() == "keep"
    # The refusal happened before anything was deleted: the row is still listed.
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200


def test_a_dataset_folder_that_is_a_junction_to_elsewhere_is_refused(
    client, project_id, handle, labeled_dataset
):
    import _winapi

    ds = labeled_dataset
    target = handle.folder.parent / "elsewhere"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    link = handle.datasets_dir / "linked"
    _winapi.CreateJunction(str(target), str(link))
    try:
        _set_path(handle, ds["id"], "datasets/linked")
        r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
        assert r.status_code == 409, r.text
        assert (target / "keep.txt").read_text() == "keep"
        assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200
    finally:
        link.rmdir()  # removes the link, never the target


def test_a_junction_inside_the_dataset_folder_is_unlinked_not_followed(
    client, project_id, handle, labeled_dataset
):
    import _winapi

    ds = labeled_dataset
    target = handle.folder.parent / "elsewhere"
    target.mkdir()
    (target / "keep.txt").write_text("keep")
    _winapi.CreateJunction(str(target), str(handle.folder / ds["path"] / "stray-link"))

    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")

    assert r.status_code == 204, r.text
    assert not (handle.folder / ds["path"]).exists()
    assert (target / "keep.txt").read_text() == "keep"


def test_the_images_a_dataset_hard_links_survive_its_deletion(client, project_id, handle, labeled_dataset):
    ds = labeled_dataset
    originals = sorted(handle.images_dir.rglob("*.jpg"))
    sizes = [p.stat().st_size for p in originals]
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204
    assert [p.stat().st_size for p in sorted(handle.images_dir.rglob("*.jpg"))] == sizes
    assert all(p.read_bytes()[:2] == b"\xff\xd8" for p in originals)  # still JPEGs, not truncated


def test_an_absolute_path_in_the_row_is_refused(client, project_id, handle, labeled_dataset, tmp_path):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("keep")
    _set_path(handle, labeled_dataset["id"], str(victim))
    r = client.delete(f"{BASE}/{project_id}/datasets/{labeled_dataset['id']}")
    assert r.status_code == 409, r.text
    assert (victim / "keep.txt").read_text() == "keep"


def test_a_row_that_aliases_another_datasets_folder_is_refused(client, project_id, handle, labeled_dataset):
    """`datasets/V1` is the folder of `v1` on Windows: deleting the alias must not take v1's files."""
    from app.db.models import Dataset

    with handle.session() as s:
        s.add(
            Dataset(
                name="V1-alias",
                classes=[],
                split_method="random",
                split_params={"val_fraction": 0.2, "seed": 1},
                path="datasets/V1",
            )
        )
        s.flush()
        alias_id = s.execute(
            __import__("sqlalchemy").select(Dataset.id).where(Dataset.name == "V1-alias")
        ).scalar_one()
    r = client.delete(f"{BASE}/{project_id}/datasets/{alias_id}")
    assert r.status_code == 409, r.text
    assert any((handle.folder / labeled_dataset["path"]).rglob("*.jpg"))


def test_delete_is_refused_while_the_datasets_own_job_is_queued_even_before_job_id_is_set(
    client, project_id, handle, labeled_dataset
):
    from app.db.models import Dataset

    ds = labeled_dataset
    with handle.session() as s:
        s.get(Dataset, ds["id"]).job_id = None  # the window between freeze and _set_job_id
        s.add(Job(type="dataset", state="queued", progress=0, message="", params={"dataset_id": ds["id"]}))
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_a_finished_training_job_does_not_block_the_delete(client, project_id, handle, labeled_dataset):
    ds = labeled_dataset
    with handle.session() as s:
        s.add(Job(type="train", state="succeeded", progress=1, message="", params={"dataset_id": ds["id"]}))
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204


def test_a_folder_that_cannot_be_moved_aside_refuses_the_delete_and_changes_nothing(
    client, project_id, handle, labeled_dataset, monkeypatch
):
    def locked(src, dst):
        raise PermissionError(5, "Access is denied", str(src))

    monkeypatch.setattr("app.datasets.materialise.os.replace", locked)
    ds = labeled_dataset
    r = client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}")
    assert r.status_code == 409, r.text
    assert "in use" in r.json()["error"]["message"]
    assert any((handle.folder / ds["path"]).rglob("*.jpg"))
    assert client.get(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 200


def test_a_removal_that_fails_half_way_still_frees_the_name(
    client, project_id, handle, labeled_dataset, monkeypatch, wait_job
):
    def half_way(path, *a, **k):
        raise PermissionError(5, "Access is denied", str(path))

    monkeypatch.setattr("app.datasets.materialise.shutil.rmtree", half_way)
    ds = labeled_dataset
    assert client.delete(f"{BASE}/{project_id}/datasets/{ds['id']}").status_code == 204
    assert not (handle.folder / ds["path"]).exists()  # moved aside atomically before the rows went
    monkeypatch.undo()
    again = client.post(f"{BASE}/{project_id}/datasets", json={"name": ds["name"]})
    assert again.status_code == 202, again.text
    assert wait_job(project_id, again.json()["job"]["id"])["state"] == "succeeded"
    # The next delete sweeps the leftover of the failed removal.
    assert client.delete(f"{BASE}/{project_id}/datasets/{again.json()['dataset']['id']}").status_code == 204
    assert [p.name for p in handle.datasets_dir.iterdir()] == []


@pytest.mark.parametrize("name", ["...", "v1.", ".hidden", "CON", "nul", "com1", "V1"])
def test_names_that_are_not_safe_folder_names_or_collide_by_case_are_refused(
    client, project_id, labeled_dataset, name
):
    r = client.post(f"{BASE}/{project_id}/datasets", json={"name": name})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] in ("conflict", "already_exists")
