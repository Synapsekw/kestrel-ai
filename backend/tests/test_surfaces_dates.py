"""Surface.captured_on and elevation_role (map workspace spec §7, §12): the column is the date."""

from datetime import date
from pathlib import Path

import jsonschema_rs
import pytest
import yaml
from surfaces import WKT, cone_cloud, fixture_spec, plane, write_cloud
from volume_rows import add_cloud, add_surface

from app.db.models import Surface

BASE = "/api/v1/projects"
SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"


def validate(schema_name: str, body: dict) -> None:
    components = yaml.safe_load(SPEC.read_text("utf-8"))["components"]
    schema = {"$ref": f"#/components/schemas/{schema_name}", "components": components}
    jsonschema_rs.Draft202012Validator(schema, validate_formats=True).validate(body)


def set_columns(handle, surface_id: str, **columns) -> None:
    with handle.session() as s:
        row = s.get(Surface, surface_id)
        for key, value in columns.items():
            setattr(row, key, value)


def dated_cloud(handle, tmp_path, day=date(2026, 8, 14)) -> str:
    path = write_cloud(tmp_path / "c.las", cone_cloud(25, 0.02, 0.0, size=30.0))
    return add_cloud(handle, path, crs_wkt=WKT, captured_on=day)


def test_a_cloud_surface_build_stores_its_clouds_date(client, wait_job, project_id, handle, tmp_path):
    cloud = dated_cloud(handle, tmp_path)
    r = client.post(f"{BASE}/{project_id}/surfaces", json={"point_cloud_id": cloud})
    assert r.status_code == 202, r.text
    assert r.json()["surface"]["captured_on"] == "2026-08-14"
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    with handle.session() as s:
        assert s.get(Surface, r.json()["surface"]["id"]).captured_on == date(2026, 8, 14)


def test_the_column_wins_over_the_clouds_date(client, project_id, handle, tmp_path):
    sid = add_surface(handle, fixture_spec(0.5), plane, cloud_id=dated_cloud(handle, tmp_path))
    set_columns(handle, sid, captured_on=date(2026, 8, 15))
    assert client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()["captured_on"] == "2026-08-15"


def test_a_cloud_surface_without_the_column_reads_its_clouds_date(client, project_id, handle, tmp_path):
    """A row whose 0012 backfill failed (spec §12: best-effort) still shows its cloud's date."""
    sid = add_surface(handle, fixture_spec(0.5), plane, cloud_id=dated_cloud(handle, tmp_path))
    body = client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()
    assert body["captured_on"] == "2026-08-14" and body["elevation_role"] is None
    validate("Surface", body)


def test_a_dem_reports_its_kind_role_and_own_date(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, name="Pix4D DSM", kind="dem", method="dem_copy")
    set_columns(handle, sid, elevation_role="dtm", captured_on=date(2026, 9, 14))
    body = client.get(f"{BASE}/{project_id}/surfaces/{sid}").json()
    assert (body["kind"], body["elevation_role"], body["captured_on"]) == ("dem", "dtm", "2026-09-14")
    assert body["build_params"] is None and body["stats"] is None and body["point_cloud_id"] is None
    validate("Surface", body)
    listed = client.get(f"{BASE}/{project_id}/surfaces").json()["items"]
    assert [(i["id"], i["elevation_role"]) for i in listed] == [(sid, "dtm")]


def test_patch_sets_a_dems_date_and_role(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, kind="dem", method="dem_copy")
    set_columns(handle, sid, elevation_role="dsm")
    r = client.patch(
        f"{BASE}/{project_id}/surfaces/{sid}", json={"captured_on": "2026-08-14", "elevation_role": "dtm"}
    )
    assert r.status_code == 200, r.text
    assert (r.json()["captured_on"], r.json()["elevation_role"]) == ("2026-08-14", "dtm")
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json={"captured_on": None})
    assert r.json()["captured_on"] is None and r.json()["elevation_role"] == "dtm"
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json={"name": "Renamed"})
    assert (r.json()["name"], r.json()["elevation_role"]) == ("Renamed", "dtm")


def test_patch_dates_a_cloud_surface_over_its_cloud(client, project_id, handle, tmp_path):
    sid = add_surface(handle, fixture_spec(0.5), plane, cloud_id=dated_cloud(handle, tmp_path))
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json={"captured_on": "2026-08-20"})
    assert r.status_code == 200 and r.json()["captured_on"] == "2026-08-20"


@pytest.mark.parametrize(
    ("kind", "patch"),
    [("design", {"captured_on": "2026-08-14"}), ("cloud_dsm", {"elevation_role": "dsm"})],
)
def test_patch_refusals(client, project_id, handle, kind, patch):
    sid = add_surface(handle, fixture_spec(0.5), plane, kind=kind, method="median")
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json=patch)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_patch"


def test_patch_refuses_a_null_role(client, project_id, handle):
    """`elevation_role` is a non-nullable `ElevationRole`, so an explicit null never reaches the
    service: pydantic itself refuses it (controller ruling R3)."""
    sid = add_surface(handle, fixture_spec(0.5), plane, kind="dem", method="median")
    r = client.patch(f"{BASE}/{project_id}/surfaces/{sid}", json={"elevation_role": None})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
