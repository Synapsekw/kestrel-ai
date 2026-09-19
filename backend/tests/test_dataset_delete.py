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
