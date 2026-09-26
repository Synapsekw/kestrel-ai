"""Test helpers for the models backend (plan BM): projects, images and boxes written directly,
so the tests do not depend on the project-creation API that BK and BC change in parallel."""

from pathlib import Path

from app.datasets.materialise import data_yaml
from app.db.models import Box, Dataset, DatasetImage, Image, Source
from app.projects.service import ProjectHandle

LIB = "/api/v1/library"


def make_project(app, folder: Path, name: str) -> ProjectHandle:
    """An empty project, created with the post-BK signature (no `kind`, foundation §6.1)."""
    registry = app.state.projects
    return registry.create(name, folder, [])


def add_source(handle: ProjectHandle, *, site: str = "site", captured_on=None) -> str:
    with handle.session() as s:
        row = Source(
            folder=str(handle.folder / "incoming" / site), site=site, kind="images", captured_on=captured_on
        )
        s.add(row)
        s.flush()
        return row.id


def add_image(
    handle: ProjectHandle,
    make_jpeg,
    source_id: str,
    name: str,
    *,
    site: str = "site",
    w: int = 64,
    h: int = 48,
    group_key: str = "g1",
    capture_time=None,
    alt: float | None = None,
    lat: float | None = None,
    lon: float | None = None,
    marked_empty: bool = False,
    exif: dict | None = None,
    seed: int = 0,
) -> str:
    """A real JPEG at `images/<site>/<name>` and its image row, exactly where import puts them."""
    rel = f"images/{site}/{name}"
    make_jpeg(handle.folder / rel, w, h, seed=seed, exif=exif)
    with handle.session() as s:
        row = Image(
            path=rel,
            width=w,
            height=h,
            source_id=source_id,
            group_key=group_key,
            capture_time=capture_time,
            alt=alt,
            lat=lat,
            lon=lon,
            marked_empty=marked_empty,
        )
        s.add(row)
        s.flush()
        return row.id


def add_box(
    handle: ProjectHandle,
    image_id: str,
    type_id: str,
    *,
    x: float = 4.0,
    y: float = 4.0,
    w: float = 20.0,
    h: float = 10.0,
    angle: float = 0.0,
    review_state: str = "accepted",
    provenance_kind: str = "person",
) -> str:
    with handle.session() as s:
        row = Box(
            image_id=image_id,
            class_id=type_id,
            x=x,
            y=y,
            w=w,
            h=h,
            angle=angle,
            review_state=review_state,
            provenance_kind=provenance_kind,
        )
        s.add(row)
        s.flush()
        return row.id


def create_body(name: str, project_ids: list[str], type_ids: list[str], **over) -> dict:
    body = {
        "name": name,
        "task": "detect",
        "filter": {"project_ids": project_ids, "type_ids": type_ids, "reviewed_only": False},
        "split_method": "by_group",
        "val_fraction": 0.4,
        "seed": 1,
    }
    body.update(over)
    return body


def build_dataset(client, body: dict) -> dict:
    """POST the dataset, wait for its `dataset_build` job, and return the finished dataset."""
    from library_helpers import wait_library_job

    r = client.post(f"{LIB}/datasets", json=body)
    assert r.status_code == 202, r.text
    done = wait_library_job(client, r.json()["job"]["id"])
    assert done["state"] == "succeeded", done["error"]
    return client.get(f"{LIB}/datasets/{r.json()['dataset']['id']}").json()


def two_projects(app, tmp_path: Path, make_jpeg, catalogue):
    """Two projects that both hold `images/site/DJI_0001.jpg` and `DJI_0002.jpg` (the same relative
    paths on purpose). A has an excavator on each; B has a dump truck on each, the second rotated 30°."""
    exc, truck = catalogue.add("Excavator"), catalogue.add("Dump truck")
    a = make_project(app, tmp_path / "a", "Site A")
    b = make_project(app, tmp_path / "b", "Site B")
    for handle, type_id, seed in ((a, exc.id, 0), (b, truck.id, 10)):
        src = add_source(handle)
        for i in (1, 2):
            image_id = add_image(
                handle, make_jpeg, src, f"DJI_000{i}.jpg", w=200, h=100, group_key=f"g{i}", seed=seed + i
            )
            angle = 30.0 if (handle is b and i == 2) else 0.0
            add_box(handle, image_id, type_id, x=50, y=20, w=60, h=30, angle=angle)
    return a, b, exc, truck


def legacy_project_dataset(
    handle: ProjectHandle,
    make_jpeg,
    *,
    name: str = "v1",
    classes: tuple[tuple[str, str], ...] = (("c1", "excavator"), ("c2", "dump_truck")),
    images: int = 2,
) -> str:
    """A dataset exactly as the old per-project materialise job left it: the `Dataset` row with its
    `dataset_image` rows, and `datasets/<name>/` holding images, labels and `data.yaml`. After the
    migration's step 2 the class ids are catalogue type ids; here they are whatever `classes` says."""
    folder = handle.datasets_dir / name
    site = f"legacy-{name}"
    src = add_source(handle, site=site)
    with handle.session() as s:
        row = Dataset(
            name=name,
            classes=[{"id": i, "name": n} for i, n in classes],
            split_method="random",
            split_params={"val_fraction": 0.5, "seed": 1},
            path=f"datasets/{name}",
        )
        s.add(row)
        s.flush()
        dataset_id = row.id
    for i in range(images):
        split = "train" if i % 2 == 0 else "val"
        image_id = add_image(handle, make_jpeg, src, f"{name}-{i}.jpg", site=site, seed=i)
        make_jpeg(folder / "images" / split / f"{name}-{i}.jpg", 64, 48, seed=i)
        (folder / "labels" / split).mkdir(parents=True, exist_ok=True)
        (folder / "labels" / split / f"{name}-{i}.txt").write_text("0 0.5 0.5 0.25 0.25\n", "utf-8")
        with handle.session() as s:
            s.add(DatasetImage(dataset_id=dataset_id, image_id=image_id, split=split, boxes=[]))
    (folder / "data.yaml").write_text(data_yaml(folder, [n for _, n in classes]), "utf-8")
    return dataset_id
