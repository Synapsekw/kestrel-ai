import pytest
import yaml

from app.datasets.splits import assign_splits

FLIGHTS = {"0031": 6, "0033": 3}
WIDTH, HEIGHT = 400, 300


def _pairs(sizes: dict[str, int]) -> list[tuple[str, str]]:
    return [(f"{key}-{i}", key) for key, size in sizes.items() for i in range(size)]


def test_assign_splits_keeps_groups_whole():
    items = _pairs({"a": 6, "b": 3, "c": 1})
    got = assign_splits(items, "by_group", 0.2, 42)
    by_group: dict[str, set[str]] = {}
    for image_id, key in items:
        by_group.setdefault(key, set()).add(got[image_id])
    assert all(len(splits) == 1 for splits in by_group.values()), by_group


def test_assign_splits_reaches_the_val_fraction_within_one_group():
    items = _pairs({"a": 6, "b": 3, "c": 1})  # 10 images, target 2 -> smallest groups first
    got = assign_splits(items, "by_group", 0.2, 42)
    val = [i for i, s in got.items() if s == "val"]
    assert len(val) == 4  # groups c (1) and b (3): the first that reaches the target
    assert {i.split("-")[0] for i in val} == {"b", "c"}


def test_assign_splits_is_deterministic_for_a_seed():
    items = _pairs({"a": 2, "b": 2, "c": 2, "d": 2, "e": 2})
    first = assign_splits(items, "by_group", 0.2, 7)
    assert first == assign_splits(items, "by_group", 0.2, 7)
    assert sum(1 for s in first.values() if s == "val") == 2  # five equal groups, the seed breaks the tie


def test_assign_splits_random_hits_the_exact_count():
    items = _pairs({"a": 10})
    got = assign_splits(items, "random", 0.3, 1)
    assert sum(1 for s in got.values() if s == "val") == 3
    assert got == assign_splits(items, "random", 0.3, 1)


def test_assign_splits_falls_back_to_random_for_a_single_group():
    items = _pairs({"only": 10})
    got = assign_splits(items, "by_group", 0.2, 42)
    assert sum(1 for s in got.values() if s == "val") == 2


def test_assign_splits_always_keeps_a_train_image():
    got = assign_splits(_pairs({"a": 1, "b": 1}), "by_group", 0.5, 42)
    assert sorted(got.values()) == ["train", "val"]
    assert assign_splits([("only", "g")], "by_group", 0.5, 42) == {"only": "train"}
    assert assign_splits([], "by_group", 0.2, 42) == {}


@pytest.fixture
def labelled_project(client, project, import_source, tmp_path, make_jpeg):
    """Nine labelled frames in two flights plus one unlabelled frame."""
    pid = project["id"]
    folder = tmp_path / "frames"
    seed = 0
    for flight, count in FLIGHTS.items():
        for i in range(1, count + 1):
            seed += 1  # every frame needs its own noise or the import dedupes it away
            make_jpeg(folder / f"IX-12-02491_{flight}_{i:04d}.jpg", WIDTH, HEIGHT, seed=seed)
    make_jpeg(folder / "IX-12-02491_0035_0001.jpg", WIDTH, HEIGHT, seed=99)  # never labelled
    import_source(pid, folder)
    classes = [c["id"] for c in project["classes"]]
    images = client.get(f"/api/v1/projects/{pid}/images", params={"limit": 100}).json()["items"]
    for image in images:
        if image["group_key"] == "0035":
            continue
        boxes = 2 if image["group_key"] == "0033" else 1
        for n in range(boxes):
            r = client.post(
                f"/api/v1/projects/{pid}/images/{image['id']}/boxes",
                json={"class_id": classes[n], "x": 100, "y": 60, "w": 40, "h": 60},
            )
            assert r.status_code == 201, r.text
    return {"pid": pid, "classes": project["classes"], "images": images}


def _create_dataset(client, pid, **body):
    return client.post(f"/api/v1/projects/{pid}/datasets", json={"name": "v1", **body})


def test_create_dataset_freezes_labelled_images(client, labelled_project, wait_job, project_dir):
    pid = labelled_project["pid"]
    r = _create_dataset(client, pid, split_method="by_group", val_fraction=0.2, seed=42)
    assert r.status_code == 202, r.text
    body = r.json()
    dataset, job = body["dataset"], body["job"]
    assert job["type"] == "dataset"
    assert dataset["name"] == "v1" and dataset["path"] == "datasets/v1"
    assert dataset["split_method"] == "by_group"
    assert dataset["split_params"] == {"val_fraction": 0.2, "seed": 42}
    assert [c["name"] for c in dataset["classes"]] == [c["name"] for c in labelled_project["classes"]]
    assert dataset["image_count"] == 9  # the unlabelled frame is excluded
    assert dataset["train_count"] + dataset["val_count"] == 9
    assert (dataset["train_count"], dataset["val_count"]) == (6, 3)  # flight 0033 is the smaller group

    finished = wait_job(pid, job["id"])
    assert finished["state"] == "succeeded", finished
    assert finished["result"] == {"dataset_id": dataset["id"], "train": 6, "val": 3}

    root = project_dir / "datasets" / "v1"
    assert len(list((root / "images" / "train").glob("*.jpg"))) == 6
    assert len(list((root / "images" / "val").glob("*.jpg"))) == 3
    assert {p.name for p in (root / "images" / "val").glob("*.jpg")} == {
        f"IX-12-02491_0033_{i:04d}.jpg" for i in (1, 2, 3)
    }

    label = (root / "labels" / "train" / "IX-12-02491_0031_0001.txt").read_text().strip().splitlines()
    assert len(label) == 1
    index, cx, cy, w, h = label[0].split()
    assert index == "0"
    assert (float(cx), float(cy), float(w), float(h)) == (0.3, 0.3, 0.1, 0.2)
    assert len((root / "labels" / "val" / "IX-12-02491_0033_0001.txt").read_text().strip().splitlines()) == 2

    data = yaml.safe_load((root / "data.yaml").read_text())
    assert data["path"] == str(root)
    assert data["train"] == "images/train" and data["val"] == "images/val"
    assert data["names"] == {i: c["name"] for i, c in enumerate(labelled_project["classes"])}


def test_dataset_stats(client, labelled_project, wait_job):
    pid = labelled_project["pid"]
    created = _create_dataset(client, pid).json()
    wait_job(pid, created["job"]["id"])
    stats = client.get(f"/api/v1/projects/{pid}/datasets/{created['dataset']['id']}/stats").json()
    assert (stats["image_count"], stats["train_count"], stats["val_count"]) == (9, 6, 3)
    per_class = {c["class_name"]: (c["train"], c["val"]) for c in stats["boxes_per_class"]}
    assert per_class["excavator"] == (6, 3)  # class 0: one box on every image
    assert per_class["wheel_loader"] == (0, 3)  # class 1: only the second box of flight 0033
    assert per_class["crane"] == (0, 0)  # classes without boxes are still listed
    assert sorted((g["group_key"], g["split"], g["image_count"]) for g in stats["groups"]) == [
        ("0031", "train", 6),
        ("0033", "val", 3),
    ]


def test_dataset_list_get_and_unknown_id(client, labelled_project, wait_job):
    pid = labelled_project["pid"]
    first = _create_dataset(client, pid, name="a1").json()["dataset"]
    wait_job(pid, first["job_id"])
    second = _create_dataset(client, pid, name="a2").json()["dataset"]
    wait_job(pid, second["job_id"])
    page = client.get(f"/api/v1/projects/{pid}/datasets", params={"limit": 1}).json()
    assert [d["name"] for d in page["items"]] == ["a2"] and page["next_cursor"]  # newest first
    page2 = client.get(
        f"/api/v1/projects/{pid}/datasets", params={"limit": 1, "cursor": page["next_cursor"]}
    ).json()
    assert [d["name"] for d in page2["items"]] == ["a1"] and page2["next_cursor"] is None
    assert client.get(f"/api/v1/projects/{pid}/datasets/{first['id']}").json()["name"] == "a1"
    assert client.get(f"/api/v1/projects/{pid}/datasets/nope").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/datasets/nope/stats").status_code == 404


def test_duplicate_dataset_name_conflicts(client, labelled_project, wait_job):
    pid = labelled_project["pid"]
    wait_job(pid, _create_dataset(client, pid).json()["job"]["id"])
    again = _create_dataset(client, pid)
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_exists"


def test_dataset_without_labelled_images_conflicts(client, project, import_source, tmp_path, make_jpeg):
    pid = project["id"]
    make_jpeg(tmp_path / "bare" / "a.jpg", 64, 64, seed=1)
    import_source(pid, tmp_path / "bare")
    r = _create_dataset(client, pid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert _create_dataset(client, pid, image_ids=["no-such-image"]).status_code == 409


def test_explicit_image_ids_are_used_verbatim(client, labelled_project, wait_job, project_dir):
    pid = labelled_project["pid"]
    ids = [i["id"] for i in labelled_project["images"] if i["group_key"] == "0031"][:4]
    created = _create_dataset(client, pid, image_ids=ids, val_fraction=0.5).json()
    assert created["dataset"]["image_count"] == 4
    wait_job(pid, created["job"]["id"])
    root = project_dir / "datasets" / "v1"
    assert len(list((root / "images").rglob("*.jpg"))) == 4


def test_dataset_names_that_are_not_a_folder_are_rejected(client, labelled_project):
    pid = labelled_project["pid"]
    assert _create_dataset(client, pid, name="..").status_code == 422
    assert _create_dataset(client, pid, name=".").status_code == 422


def test_dataset_from_real_frames(client, project, import_source, ahmadia_sample, wait_job, project_dir):
    pid = project["id"]
    import_source(pid, ahmadia_sample, site="ahmadia")
    images = client.get(f"/api/v1/projects/{pid}/images", params={"limit": 4}).json()["items"]
    class_id = project["classes"][3]["id"]
    for image in images:
        client.post(
            f"/api/v1/projects/{pid}/images/{image['id']}/boxes",
            json={"class_id": class_id, "x": 2000, "y": 1333, "w": 400, "h": 266},
        )
    created = _create_dataset(client, pid, val_fraction=0.5).json()
    assert created["dataset"]["image_count"] == 4
    assert wait_job(pid, created["job"]["id"])["state"] == "succeeded"
    labels = list((project_dir / "datasets" / "v1" / "labels").rglob("*.txt"))
    assert len(labels) == 4
    index, cx, cy, w, h = labels[0].read_text().split()
    assert index == "3" and abs(float(cx) - (2000 + 200) / 4000) < 1e-6
    assert abs(float(cy) - (1333 + 133) / 2667) < 1e-6


def test_images_frozen_into_a_dataset_cannot_be_deleted(client, labelled_project, wait_job):
    pid = labelled_project["pid"]
    created = _create_dataset(client, pid).json()
    wait_job(pid, created["job"]["id"])
    frozen = [i["id"] for i in labelled_project["images"] if i["group_key"] != "0035"][:1]
    r = client.post(f"/api/v1/projects/{pid}/images/bulk-delete", json={"image_ids": frozen})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert r.json()["error"]["details"]["image_ids"] == frozen
    # an image the dataset does not hold is still deletable
    spare = [i["id"] for i in labelled_project["images"] if i["group_key"] == "0035"]
    assert client.post(f"/api/v1/projects/{pid}/images/bulk-delete", json={"image_ids": spare}).json() == {
        "deleted": 1
    }
