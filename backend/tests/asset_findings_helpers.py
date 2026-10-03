"""Shared helpers for the asset findings tests (plan 2026-10-03-asset-findings-j4). Hand-made rows
only: no customer data (index Global Constraints)."""

from sqlalchemy import select

from app.db.models import AssetModel, Box, Finding, FindingCount, FindingSighting, Image, Source
from app.findings import counts, sightings

API = "/api/v1"
FRAME = {
    "origin": {"lat": 25.0, "lon": 55.0, "ground_alt_m": 3.0},
    "north_offset_deg": 0.0,
    "height_m": 30.0,
    "datum_label": "Ground",
    "datum_note": "",
    "line_azimuth_deg": None,
    "silhouette": [[0.0, 2.0], [30.0, 1.0]],
    "levels": [],
    "presets": [],
}
RECT = {"x": 10.0, "y": 20.0, "w": 30.0, "h": 40.0, "angle": 0.0}


def review_dict(profile_id: str = "telecom_tower", height_m: float = 30.0) -> dict:
    from app.asset_review.profiles import resolve

    return resolve(profile_id, height_m).model_dump(mode="json")


def make_model(handle, *, name: str = "Tower", review: bool = True, profile_id: str = "telecom_tower") -> str:
    """A ready asset model row with the fixture frame and, unless `review=False`, a resolved profile
    (telecom tower by default: region unit; `profile_id="stack"` is the photo unit). Without a
    review, grouping is region-unit with max(0.75, 0.02 H) = 0.75 m."""
    from app.asset_review.frame import Frame

    Frame.model_validate(FRAME)  # the fixture frame must stay valid for P1's model
    with handle.session() as s:
        row = AssetModel(
            name=name,
            status="ready",
            current_version=1,
            frame=dict(FRAME),
            review=review_dict(profile_id) if review else None,
        )
        s.add(row)
        s.flush()
        return row.id


def make_photos(client, project: dict, import_source, tmp_path, make_jpeg, n: int = 3) -> list[str]:
    """`n` real 320x240 photos imported into `project`; returns their image ids."""
    folder = tmp_path / "photos"
    for i in range(n):
        make_jpeg(folder / f"P_{i:04d}.jpg", 320, 240, seed=i + 1)
    import_source(project["id"], folder)
    items = client.get(f"{API}/projects/{project['id']}/images").json()["items"]
    assert len(items) == n
    return [i["id"] for i in items]


def post_asset(client, project_id: str, type_id: str, model_id: str, photo_ids: list[str], **body) -> dict:
    """`POST /findings` with one rectangle sighting per photo."""
    anchor = {
        "kind": "asset",
        "asset_model_id": model_id,
        "sightings": [{"image_id": pid, "box": RECT} for pid in photo_ids],
    }
    r = client.post(
        f"{API}/projects/{project_id}/findings", json={"type_id": type_id, "anchor": anchor, **body}
    )
    assert r.status_code == 201, r.text
    return r.json()


def sightings_of(handle, finding_id: str) -> list[FindingSighting]:
    with handle.session() as s:
        rows = sightings.of_finding(s, finding_id)
        for r in rows:
            s.expunge(r)
    return rows


def by_photo(handle, finding_id: str) -> dict[str, FindingSighting]:
    return {r.image_id: r for r in sightings_of(handle, finding_id)}


def update_sighting(handle, sighting_id: str, **fields) -> None:
    with handle.session() as s:
        row = s.get(FindingSighting, sighting_id)
        for k, v in fields.items():
            setattr(row, k, v)


def place(handle, sighting_id: str, center, normal=(1.0, 0.0, 0.0), **fields) -> None:
    """What J3's `asset_place` writes for a point placement."""
    (cx, cy, cz), (nx, ny, nz) = center, normal
    update_sighting(
        handle,
        sighting_id,
        placement="point",
        cx=cx,
        cy=cy,
        cz=cz,
        nx=nx,
        ny=ny,
        nz=nz,
        placed_version=1,
        **fields,
    )


def refresh_finding(handle, finding_id: str) -> None:
    with handle.session() as s:
        sightings.refresh(s, s.get(Finding, finding_id))


def finding_row(handle, finding_id: str) -> Finding | None:
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        if row is not None:
            s.expunge(row)
    return row


def set_finding(handle, finding_id: str, **fields) -> None:
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        for k, v in fields.items():
            setattr(row, k, v)


def seed_images(handle, n: int) -> list[str]:
    """`n` image rows without files (grouping never opens a photo)."""
    with handle.session() as s:
        src = Source(folder="C:/flights/tower", site="T")
        s.add(src)
        s.flush()
        ids = []
        for i in range(n):
            image = Image(path=f"images/tower_{i:03d}.jpg", width=4000, height=3000, source_id=src.id)
            s.add(image)
            s.flush()
            ids.append(image.id)
        return ids


def seed_sighting(
    handle,
    *,
    model_id: str,
    image_id: str,
    type_id: str,
    center=None,
    severity: int | None = 1,
    tag: str | None = None,
    coverage: float | None = None,
) -> str:
    """An ungrouped sighting with its person-drawn box, as J5's import leaves it; placed at `center`
    (normal +X) when given."""
    with handle.session() as s:
        box = Box(
            image_id=image_id,
            class_id=type_id,
            x=100.0,
            y=100.0,
            w=50.0,
            h=50.0,
            provenance_kind="person",
            review_state="accepted",
        )
        s.add(box)
        s.flush()
        row = FindingSighting(
            asset_model_id=model_id,
            finding_id=None,
            image_id=image_id,
            annotation_id=box.id,
            severity=severity,
            group_tag=tag,
            placement="point" if center is not None else "pending",
            coverage=coverage,
        )
        if center is not None:
            row.cx, row.cy, row.cz = center
            row.nx, row.ny, row.nz = 1.0, 0.0, 0.0
            row.placed_version = 1
        s.add(row)
        s.flush()
        return row.id


def finding_of_sighting(handle, sighting_id: str) -> Finding:
    with handle.session() as s:
        fid = s.get(FindingSighting, sighting_id).finding_id
        row = s.get(Finding, fid)
        s.expunge(row)
    return row


def assert_counts_true(handle) -> None:
    """`finding_count` says what a recount from the finding table says (counts.py stays the only
    writer, and every write here went through it)."""

    def snapshot(s) -> dict:
        return {
            (r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n
        }

    with handle.session() as s:
        stored = snapshot(s)
        counts.recount(s)
        s.flush()
        fresh = snapshot(s)
        s.rollback()
    assert stored == fresh
