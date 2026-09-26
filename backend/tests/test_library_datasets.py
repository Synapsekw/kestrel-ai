"""Datasets built across projects (foundation F §12.1-§12.3; plan BM Task 6 and decisions 5, 15
and 16): the build freezes items without copying an image, splits keep flights whole, and the
states read through their job."""

from collections import defaultdict

import pytest
from catalogue_fake import catalogue  # noqa: F401 - fixture
from library_datasets_helpers import (
    LIB,
    add_box,
    add_image,
    add_source,
    build_dataset,
    create_body,
    make_project,
)
from library_helpers import jobs_finish_before_submit_returns, wait_library_job
from sqlalchemy import func, select

from app.db.models import Job
from app.jobs.startup import sweep_orphans
from app.library.datasets.build import NOTHING_TO_TRAIN_ON, group_of
from app.library.db import LibraryDataset, LibraryDatasetItem


@pytest.fixture
def two_sites(app, tmp_path, make_jpeg, catalogue):  # noqa: F811
    """Site A: flights f1 (3) and f2 (2) with excavators, plus a marked-empty frame in f3.
    Site B: its own flight "f1" (2) with dump trucks, plus a frame with only an unreviewed proposal."""
    exc, truck = catalogue.add("Excavator"), catalogue.add("Dump truck")
    a = make_project(app, tmp_path / "a", "Site A")
    b = make_project(app, tmp_path / "b", "Site B")
    groups: dict[str, tuple[str, str]] = {}
    src = add_source(a)
    for flight, n in (("f1", 3), ("f2", 2)):
        for i in range(n):
            image_id = add_image(a, make_jpeg, src, f"{flight}-{i}.jpg", group_key=flight, seed=i)
            add_box(a, image_id, exc.id)
            groups[image_id] = (a.id, flight)
    empty = add_image(a, make_jpeg, src, "f3-0.jpg", group_key="f3", marked_empty=True)
    groups[empty] = (a.id, "f3")
    src = add_source(b)
    for i in range(2):
        image_id = add_image(b, make_jpeg, src, f"f1-{i}.jpg", group_key="f1", seed=10 + i)
        add_box(b, image_id, truck.id)
        groups[image_id] = (b.id, "f1")
    proposal = add_image(b, make_jpeg, src, "f1-9.jpg", group_key="f1")
    add_box(b, proposal, truck.id, review_state="unreviewed", provenance_kind="local_model")
    return a, b, exc, truck, groups


def _all_items(client, dataset_id) -> list[dict]:
    items, cursor = [], None
    while True:
        params = {"limit": 3, **({"cursor": cursor} if cursor else {})}
        page = client.get(f"{LIB}/datasets/{dataset_id}/items", params=params).json()
        items += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return items


def test_a_dataset_is_built_across_two_projects_without_copying_an_image(client, app, two_sites):
    a, b, exc, truck, _ = two_sites
    r = client.post(f"{LIB}/datasets", json=create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    assert r.status_code == 202, r.text
    assert r.json()["job"]["type"] == "dataset_build"
    assert r.json()["dataset"]["state"] == "resolving"
    assert r.json()["dataset"]["job_id"] == r.json()["job"]["id"]
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "succeeded", done["error"]

    d = client.get(f"{LIB}/datasets/{r.json()['dataset']['id']}").json()
    assert d["state"] == "ready" and d["origin"] == "built" and d["task"] == "detect"
    assert d["export_state"] == "none" and d["export_path"] is None
    assert d["classes"] == [
        {"type_id": exc.id, "name": "Excavator"},
        {"type_id": truck.id, "name": "Dump truck"},
    ]
    assert d["counts"]["images"] == 8  # A: 5 labelled + 1 negative; B: 2 (the proposal-only frame is out)
    assert d["counts"]["per_class"] == {exc.id: 5, truck.id: 2}
    assert d["counts"]["train"] + d["counts"]["val"] == 8
    assert {(s["project_id"], s["project_name"], s["image_count"]) for s in d["sources"]} == {
        (a.id, "Site A", 6),
        (b.id, "Site B", 2),
    }
    assert {s["project_folder"] for s in d["sources"]} == {str(a.folder), str(b.folder)}
    assert list(app.state.library.datasets_dir.iterdir()) == []  # referenced, not copied (D1, §12.2)


def test_the_create_answer_is_the_dataset_as_queued_even_when_the_build_is_quicker(
    client, app, two_sites, monkeypatch
):
    """The 202 says `resolving` (the contract's "dataset created in `resolving`, build job queued"),
    never a race with the build: here the build has finished before the route answers."""
    a, b, exc, truck, _ = two_sites
    jobs_finish_before_submit_returns(app, monkeypatch)
    r = client.post(f"{LIB}/datasets", json=create_body("quick", [a.id, b.id], [exc.id, truck.id]))
    assert r.status_code == 202, r.text
    assert r.json()["job"]["state"] == "queued"
    assert r.json()["dataset"]["state"] == "resolving"
    assert r.json()["dataset"]["job_id"] == r.json()["job"]["id"]
    assert r.json()["dataset"]["counts"]["images"] == 0
    assert client.get(f"{LIB}/datasets/{r.json()['dataset']['id']}").json()["state"] == "ready"


def test_splits_keep_each_flight_whole_and_items_page_with_a_cursor(client, two_sites):
    a, b, exc, truck, groups = two_sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    items = _all_items(client, d["id"])
    assert len(items) == 8 and len({(i["project_id"], i["image_id"]) for i in items}) == 8
    splits_of: dict[tuple[str, str], set[str]] = defaultdict(set)
    for item in items:
        splits_of[groups[item["image_id"]]].add(item["split"])
    assert all(len(s) == 1 for s in splits_of.values()), splits_of
    assert {i["label_count"] for i in items} == {0, 1}  # the negative has no label
    train_only = client.get(f"{LIB}/datasets/{d['id']}/items", params={"split": "train", "limit": 100}).json()
    assert {i["split"] for i in train_only["items"]} == {"train"}


def test_items_filter_by_project(client, two_sites):
    a, b, exc, truck, _ = two_sites
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    page = client.get(f"{LIB}/datasets/{d['id']}/items", params={"project_id": b.id, "limit": 100}).json()
    assert len(page["items"]) == 2 and {i["project_id"] for i in page["items"]} == {b.id}


def test_a_group_key_belongs_to_its_project():
    assert group_of("p1", "by_group", "f1", None, None) == "p1:f1"
    assert group_of("p2", "by_group", "f1", None, None) == "p2:f1"
    assert group_of("p1", "by_tile", "f1", 29.0, 47.6).startswith("p1:tile_")
    assert group_of("p1", "by_tile", "f1", None, None) == "p1:f1"


def test_the_build_pages_through_the_images(client, two_sites, monkeypatch):
    a, b, exc, truck, _ = two_sites
    monkeypatch.setattr("app.library.datasets.build.PAGE", 2)
    d = build_dataset(client, create_body("paged", [a.id, b.id], [exc.id, truck.id]))
    assert d["counts"]["images"] == 8 and d["counts"]["per_class"] == {exc.id: 5, truck.id: 2}


def test_nothing_to_train_on_fails_the_build_and_leaves_no_items(client, app, two_sites, catalogue):  # noqa: F811
    a, _, _, _, _ = two_sites
    crane = catalogue.add("Crane")
    r = client.post(f"{LIB}/datasets", json=create_body("cranes", [a.id], [crane.id]))
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "failed" and NOTHING_TO_TRAIN_ON in done["error"]
    d = client.get(f"{LIB}/datasets/{r.json()['dataset']['id']}").json()
    assert d["state"] == "failed"
    with app.state.library.session() as s:
        assert s.execute(select(func.count()).select_from(LibraryDatasetItem)).scalar_one() == 0


def test_create_refuses_unknown_ids_with_404_and_a_case_duplicate_with_409(client, two_sites):
    a, b, exc, truck, _ = two_sites
    unknown_type = client.post(f"{LIB}/datasets", json=create_body("x", [a.id], ["no-such-type"]))
    assert unknown_type.status_code == 404 and unknown_type.json()["error"]["code"] == "not_found"
    unknown_project = client.post(f"{LIB}/datasets", json=create_body("x", ["ghost"], [exc.id]))
    assert unknown_project.status_code == 404
    build_dataset(client, create_body("Machines", [a.id, b.id], [exc.id, truck.id]))
    again = client.post(f"{LIB}/datasets", json=create_body("machines", [a.id], [exc.id]))
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_exists"


def test_a_restart_during_the_build_shows_failed(client, app, two_sites):
    a, _, exc, _, _ = two_sites
    lib = app.state.library
    from app.library.datasets import service
    from app.library.datasets.schemas import LibraryDatasetCreate

    body = LibraryDatasetCreate(**create_body("interrupted", [a.id], [exc.id]))
    dataset_id = service.create_dataset(lib, app.state.projects, app.state.catalogue_port, body)
    with lib.session() as s:
        job = Job(type="dataset_build", state="running", params={"dataset_id": dataset_id}, log_path="")
        s.add(job)
        s.flush()
        job_id = job.id
    service.set_job(lib, dataset_id, job_id)
    assert client.get(f"{LIB}/datasets/{dataset_id}").json()["state"] == "resolving"
    sweep_orphans(lib, app.state.jobs)  # what the next start does to a job nobody runs
    assert client.get(f"{LIB}/datasets/{dataset_id}").json()["state"] == "failed"


def test_delete_is_refused_while_a_job_uses_the_dataset_then_removes_everything(client, app, two_sites):
    a, b, exc, truck, _ = two_sites
    lib = app.state.library
    d = build_dataset(client, create_body("machines", [a.id, b.id], [exc.id, truck.id]))
    with lib.session() as s:
        job = Job(type="train", state="running", params={"dataset_id": d["id"]}, log_path="")
        s.add(job)
        s.flush()
        job_id = job.id
    r = client.delete(f"{LIB}/datasets/{d['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    with lib.session() as s:
        s.get(Job, job_id).state = "succeeded"
    assert client.delete(f"{LIB}/datasets/{d['id']}").status_code == 204
    assert client.get(f"{LIB}/datasets/{d['id']}").status_code == 404
    with lib.session() as s:
        assert s.execute(select(func.count()).select_from(LibraryDatasetItem)).scalar_one() == 0
    assert a.folder.joinpath("images", "site").is_dir()  # project images are never touched


def test_the_list_is_newest_first_with_sources(client, two_sites):
    a, b, exc, truck, _ = two_sites
    first = build_dataset(client, create_body("first", [a.id], [exc.id]))
    second = build_dataset(client, create_body("second", [a.id, b.id], [exc.id, truck.id]))
    page = client.get(f"{LIB}/datasets", params={"limit": 1}).json()
    assert [d["id"] for d in page["items"]] == [second["id"]] and page["next_cursor"]
    rest = client.get(f"{LIB}/datasets", params={"limit": 1, "cursor": page["next_cursor"]}).json()
    assert [d["id"] for d in rest["items"]] == [first["id"]]
    assert len(page["items"][0]["sources"]) == 2


def test_the_list_filters_by_task(client, two_sites):
    a, _, exc, _, _ = two_sites
    build_dataset(client, create_body("boxes", [a.id], [exc.id]))
    rotated = build_dataset(client, create_body("rotated", [a.id], [exc.id], task="obb"))
    page = client.get(f"{LIB}/datasets", params={"task": "obb"}).json()
    assert [d["id"] for d in page["items"]] == [rotated["id"]]


def test_the_list_filters_by_origin(client, app, two_sites):
    a, _, exc, _, _ = two_sites
    built = build_dataset(client, create_body("built", [a.id], [exc.id]))
    with app.state.library.session() as s:
        s.add(
            LibraryDataset(
                name="v1 (Site A)", origin="legacy", state="ready", legacy_path=str(a.folder / "v1")
            )
        )
    assert [d["id"] for d in client.get(f"{LIB}/datasets", params={"origin": "built"}).json()["items"]] == [
        built["id"]
    ]
    legacy = client.get(f"{LIB}/datasets", params={"origin": "legacy"}).json()["items"]
    assert [d["name"] for d in legacy] == ["v1 (Site A)"] and legacy[0]["filter"] is None


def test_the_export_path_reads_absolute_and_the_job_id_is_the_latest_job(client, app, two_sites):
    a, _, exc, _, _ = two_sites
    lib = app.state.library
    d = build_dataset(client, create_body("Site: A/B", [a.id], [exc.id]))
    folder = f"site-a-b-{d['id'][:8]}"
    with lib.session() as s:
        row = s.get(LibraryDataset, d["id"])
        row.export_path, row.export_state, row.export_job_id = f"datasets/{folder}", "ready", "export-job"
    got = client.get(f"{LIB}/datasets/{d['id']}").json()
    assert got["export_path"] == str(lib.datasets_dir / folder)
    assert got["job_id"] == "export-job"
    assert got["export_state"] == "stale"  # ready on record, but no data.yaml on disk
