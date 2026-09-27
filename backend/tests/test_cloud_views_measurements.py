"""A measurement's report view in its row (spec section 12 row 18) and on delete (section 11.2)."""

import pytest
from cloud_views import meta_json, png
from pointclouds import insert_cloud
from sqlalchemy import func, select

from app.db.models import CloudView
from app.pointclouds import views

API = "/api/v1/projects"


@pytest.fixture
def cloud_id(handle) -> str:
    return insert_cloud(handle)


def _murl(project_id, cloud_id, mid=""):
    return f"{API}/{project_id}/pointclouds/{cloud_id}/measurements" + (f"/{mid}" if mid else "")


def _measurement(client, project_id, cloud_id, z=1.0) -> str:
    body = {"kind": "point", "points": [{"x": 243500.0, "y": 3178000.0, "z": z, "uncertainty_m": 0.01}]}
    r = client.post(_murl(project_id, cloud_id), json=body)
    assert r.status_code == 201, r.text
    assert r.json()["view"] is None
    return r.json()["id"]


def _store(handle, cloud_id, mid):
    meta = views.parse_meta(meta_json(), "cloud_measurement")
    return views.store(handle, views.measurement_subject(handle, cloud_id, mid), png(), meta)


def test_the_list_carries_each_measurements_view(client, project_id, handle, cloud_id):
    with_view = _measurement(client, project_id, cloud_id)
    without = _measurement(client, project_id, cloud_id, z=2.0)
    stored = _store(handle, cloud_id, with_view)
    items = {m["id"]: m for m in client.get(_murl(project_id, cloud_id)).json()["items"]}
    assert items[with_view]["view"]["sha256"] == stored.sha256
    assert items[with_view]["view"]["stale"] is False
    assert items[without]["view"] is None


def test_the_update_answer_carries_the_view(client, project_id, handle, cloud_id):
    mid = _measurement(client, project_id, cloud_id)
    stored = _store(handle, cloud_id, mid)
    r = client.patch(_murl(project_id, cloud_id, mid), json={"name": "Stack top"})
    assert r.status_code == 200, r.text
    assert r.json()["view"]["sha256"] == stored.sha256


def test_deleting_a_measurement_removes_its_view_row_and_file(client, project_id, handle, cloud_id):
    mid = _measurement(client, project_id, cloud_id)
    _store(handle, cloud_id, mid)
    path = views.views_dir(handle, cloud_id) / f"cloud_measurement-{mid}.png"
    assert path.is_file()
    assert client.delete(_murl(project_id, cloud_id, mid)).status_code == 204
    assert not path.exists()
    with handle.session() as s:
        assert s.execute(select(func.count()).select_from(CloudView)).scalar_one() == 0


def test_a_measurement_delete_survives_a_locked_view_file(client, project_id, handle, cloud_id, monkeypatch):
    mid = _measurement(client, project_id, cloud_id)
    _store(handle, cloud_id, mid)
    real = views.Path.unlink

    def locked(self, missing_ok=False):
        if self.name.startswith("cloud_measurement-"):
            raise PermissionError("in use")
        return real(self, missing_ok=missing_ok)

    monkeypatch.setattr(views.Path, "unlink", locked)
    assert client.delete(_murl(project_id, cloud_id, mid)).status_code == 204
