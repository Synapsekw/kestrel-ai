"""Shared helpers for the catalogue and finding tests (plan BC)."""

API = "/api/v1"


def add_type(client, name: str, *, kind: str = "defect", **body) -> dict:
    """A catalogue type, created through the API."""
    r = client.post(f"{API}/catalogue/types", json={"name": name, "kind": kind, **body})
    assert r.status_code == 201, r.text
    return r.json()


def use_types(client, project: dict, *types: dict) -> dict:
    """Append `types` to the project's type list; returns the updated project."""
    current = [c["id"] for c in client.get(f"{API}/projects/{project['id']}").json()["classes"]]
    r = client.put(
        f"{API}/projects/{project['id']}/types", json={"type_ids": current + [t["id"] for t in types]}
    )
    assert r.status_code == 200, r.text
    return r.json()


def insert_map(handle, *, name: str = "April", crs_wkt: str | None = None) -> str:
    """A ready map row, straight into the project DB (no GeoTIFF needed for anchors)."""
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name=name, status="ready", source_path="C:/maps/x.tif", source_size=1, crs_wkt=crs_wkt)
        s.add(row)
        s.flush()
        return row.id


def insert_cloud(handle, *, name: str = "Scan", crs_wkt: str | None = None) -> str:
    """A ready point-cloud row, straight into the project DB."""
    from app.db.models import PointCloud

    with handle.session() as s:
        row = PointCloud(
            name=name, status="ready", source_path="C:/clouds/x.laz", source_size=1, crs_wkt=crs_wkt
        )
        s.add(row)
        s.flush()
        return row.id


def insert_box(handle, class_id: str) -> tuple[str, str]:
    """An image (in a fresh image set) with one box of `class_id`; returns (image_id, box_id)."""
    from app.db.models import Box, Image, Source

    with handle.session() as s:
        src = Source(folder="C:/flights/a", site="A")
        s.add(src)
        s.flush()
        image = Image(path="images/a.jpg", width=100, height=100, source_id=src.id)
        s.add(image)
        s.flush()
        box = Box(image_id=image.id, class_id=class_id, x=0.5, y=0.5, w=0.1, h=0.1, provenance_kind="person")
        s.add(box)
        s.flush()
        return image.id, box.id
