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
    # the site stays part of the name so two sites cannot collapse into one file
    assert {p.name for p in (root / "images" / "val").glob("*.jpg")} == {
        f"frames__IX-12-02491_0033_{i:04d}.jpg" for i in (1, 2, 3)
    }

    label = (root / "labels" / "train" / "frames__IX-12-02491_0031_0001.txt").read_text().strip().splitlines()
    assert len(label) == 1
    index, cx, cy, w, h = label[0].split()
    assert index == "0"
    assert (float(cx), float(cy), float(w), float(h)) == (0.3, 0.3, 0.1, 0.2)
    val_label = (root / "labels" / "val" / "frames__IX-12-02491_0033_0001.txt").read_text()
    assert len(val_label.strip().splitlines()) == 2

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


def test_dataset_without_labelled_images_is_refused_as_nothing_to_train_on(
    client, project, import_source, tmp_path, make_jpeg
):
    pid = project["id"]
    make_jpeg(tmp_path / "bare" / "a.jpg", 64, 64, seed=1)
    import_source(pid, tmp_path / "bare")
    r = _create_dataset(client, pid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert "Nothing to train on" in r.json()["error"]["message"]
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


def test_same_file_name_in_two_sites_stays_two_images(
    client, project, import_source, wait_job, tmp_path, make_jpeg, project_dir
):
    """Two sites can hold the same file name; the dataset must not collapse them into one."""
    pid = project["id"]
    for site, seed in (("sitea", 1), ("siteb", 2)):
        make_jpeg(tmp_path / site / "DJI_0001.jpg", WIDTH, HEIGHT, seed=seed)
        import_source(pid, tmp_path / site, site=site)
    classes = [c["id"] for c in project["classes"]]
    images = client.get(f"/api/v1/projects/{pid}/images").json()["items"]
    assert len(images) == 2
    boxes = {
        "images/sitea/DJI_0001.jpg": (classes[0], 100, 60, 40, 60),
        "images/siteb/DJI_0001.jpg": (classes[1], 200, 120, 80, 30),
    }
    for image in images:
        class_id, x, y, w, h = boxes[image["path"]]
        r = client.post(
            f"/api/v1/projects/{pid}/images/{image['id']}/boxes",
            json={"class_id": class_id, "x": x, "y": y, "w": w, "h": h},
        )
        assert r.status_code == 201, r.text

    created = _create_dataset(client, pid, val_fraction=0.05).json()  # both frames land in train
    assert created["dataset"]["train_count"] == 2 and created["dataset"]["val_count"] == 0
    assert wait_job(pid, created["job"]["id"])["state"] == "succeeded"

    root = project_dir / "datasets" / "v1"
    jpgs = sorted(p.name for p in (root / "images" / "train").glob("*.jpg"))
    assert jpgs == ["sitea__DJI_0001.jpg", "siteb__DJI_0001.jpg"]
    labels = {p.stem: p.read_text().split() for p in (root / "labels" / "train").glob("*.txt")}
    assert len(labels) == 2
    assert labels["sitea__DJI_0001"][0] == "0"
    assert labels["siteb__DJI_0001"][0] == "1"
    assert float(labels["siteb__DJI_0001"][1]) == (200 + 40) / WIDTH  # the second image kept its own box


def test_place_refuses_to_overwrite_an_existing_file(tmp_path):
    from app.datasets.materialise import _place

    src, dest = tmp_path / "a.jpg", tmp_path / "b.jpg"
    src.write_bytes(b"x")
    dest.write_bytes(b"y")
    with pytest.raises(FileExistsError):
        _place(src, dest)


def test_a_failed_materialise_releases_the_dataset_name(
    client, labelled_project, wait_job, monkeypatch, project_dir
):
    """A dataset is immutable, so a half-written one must not survive to hold its name."""
    from app.datasets import materialise

    def _boom(src, dest):
        raise OSError("disk on fire")

    monkeypatch.setattr(materialise, "_place", _boom)
    pid = labelled_project["pid"]
    created = _create_dataset(client, pid).json()
    assert wait_job(pid, created["job"]["id"])["state"] == "failed"
    assert client.get(f"/api/v1/projects/{pid}/datasets/{created['dataset']['id']}").status_code == 404
    assert client.get(f"/api/v1/projects/{pid}/datasets").json()["items"] == []
    assert not (project_dir / "datasets" / "v1").exists()

    monkeypatch.undo()
    retry = _create_dataset(client, pid)
    assert retry.status_code == 202, retry.text  # the name is free again
    assert wait_job(pid, retry.json()["job"]["id"])["state"] == "succeeded"
