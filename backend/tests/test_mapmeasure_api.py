"""`/map-measurements` over HTTP (plan maps-b4 Task 5; spec §12): status codes, the event and
`?frame=site`."""

import json
from pathlib import Path

import jsonschema_rs
import pytest
import yaml
from mapmeasure_rows import set_site_frame
from surfaces import EPSG, X0, Y1, fixture_spec, plane
from volume_rows import add_surface

BASE = "/api/v1/projects"
LINE = [[X0 + 5, Y1 - 5], [X0 + 45, Y1 - 5]]
RING = [[X0 + 5, Y1 - 5], [X0 + 25, Y1 - 5], [X0 + 25, Y1 - 25], [X0 + 5, Y1 - 25]]

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
_CONTRACT = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
BRANCH_SCHEMA = {"distance": "MapDistanceResults", "area": "MapAreaResults", "profile": "MapProfileResults"}


def url(pid: str, mid: str | None = None) -> str:
    return f"{BASE}/{pid}/map-measurements" + (f"/{mid}" if mid else "")


def _validator(name: str, *, strict: bool = False) -> jsonschema_rs.Draft202012Validator:
    """A validator for one `#/components/schemas/<name>` of the merged contract, `$ref`s resolved
    through the shared `components`. `strict` additionally forbids extra properties on the three
    `Map*Results` branches; the contract itself allows them (no `additionalProperties: false`), so
    this is a diagnostic, not an assertion - `MapMeasurementOut.results` is deliberately one flat
    shape (schemas.py), and a profile's own non-null `grid_length_m` alone already satisfies
    `MapDistanceResults`'s single non-nullable field under a strict `anyOf` read too."""
    doc = json.loads(json.dumps(_CONTRACT))
    if strict:
        for k in ("MapDistanceResults", "MapAreaResults", "MapProfileResults"):
            doc["components"]["schemas"][k]["additionalProperties"] = False
    schema = {"$ref": f"#/components/schemas/{name}", "components": doc["components"]}
    return jsonschema_rs.Draft202012Validator(schema)


def _errors(name: str, instance: dict, *, strict: bool = False) -> list[str]:
    return [str(e) for e in _validator(name, strict=strict).iter_errors(instance)]


def _assert_conforms(name: str, instance: dict) -> None:
    errors = _errors(name, instance)
    assert errors == [], f"{name}: {errors}"


@pytest.fixture
def dsm(handle) -> str:
    set_site_frame(handle, EPSG)
    return add_surface(handle, fixture_spec(0.1), plane, name="DSM")


@pytest.fixture
def dtm(handle, dsm) -> str:
    return add_surface(handle, fixture_spec(0.25), lambda x, y: plane(x, y) - 1.0, name="DTM")


@pytest.fixture
def events(app, monkeypatch) -> list[dict]:
    seen: list[dict] = []
    monkeypatch.setattr(app.state.events, "publish", seen.append)
    return seen


def _changed(events) -> list[dict]:
    return [e["payload"] for e in events if e["type"] == "map_measurements.changed"]


def test_crud_round_trip_publishes_map_measurements_changed(client, project_id, dsm, events):
    r = client.post(url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": [dsm]})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert r.json()["results"]["series"][0]["surface_id"] == dsm
    assert client.get(url(project_id, mid), params={"frame": "site"}).json()["vertices"] == LINE
    patched = client.patch(url(project_id, mid), json={"note": "north ramp"})
    assert patched.status_code == 200 and patched.json()["note"] == "north ramp"
    page = client.get(url(project_id), params={"frame": "site"}).json()
    assert [i["id"] for i in page["items"]] == [mid] and page["items"][0]["results"]["series"] == []
    assert page["next_cursor"] is None
    assert client.delete(url(project_id, mid)).status_code == 204
    assert client.get(url(project_id, mid)).status_code == 404
    assert _changed(events) == [{"measurement_ids": [mid]}] * 3


def test_refusals_answer_their_own_codes(client, project_id, dsm, events):
    far = [[X0 + 200, Y1 - 5], [X0 + 240, Y1 - 5]]
    r = client.post(url(project_id), json={"kind": "profile", "vertices": far, "surface_ids": [dsm]})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "no_surface_under_line")
    nan_body = '{"kind": "distance", "vertices": [[1, 2], [NaN, 2]]}'
    r = client.post(url(project_id), content=nan_body, headers={"content-type": "application/json"})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")
    missing = client.post(
        url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": ["nope"]}
    )
    assert missing.status_code == 404
    assert _changed(events) == []


def test_no_site_frame_is_409(client, project_id):
    r = client.post(url(project_id), json={"kind": "distance", "vertices": LINE})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "no_site_frame")
    assert client.get(url(project_id), params={"frame": "site"}).status_code == 409
    assert client.get(url(project_id)).json() == {"items": [], "next_cursor": None}


def test_an_unknown_project_is_404(client):
    assert client.get(url("nope")).status_code == 404


def test_list_kind_filter(client, project_id, dsm):
    r = client.post(url(project_id), json={"kind": "profile", "vertices": LINE, "surface_ids": [dsm]})
    assert r.status_code == 201, r.text
    profile_id = r.json()["id"]
    dist = client.post(url(project_id), json={"kind": "distance", "vertices": LINE})
    assert dist.status_code == 201, dist.text

    profiles = client.get(url(project_id), params={"kind": "profile"}).json()
    assert [i["id"] for i in profiles["items"]] == [profile_id]

    distances = client.get(url(project_id), params={"kind": "distance"}).json()
    assert [i["id"] for i in distances["items"]] == [dist.json()["id"]]

    areas = client.get(url(project_id), params={"kind": "area"}).json()
    assert areas["items"] == []


def test_success_bodies_conform_to_the_contract(client, project_id, dsm, dtm):
    """201 create for each kind, both list flavours and a site-frame get, all validated against
    the merged `contract/openapi.yaml` (`$ref`s resolved). Each `results` is also checked against
    its own kind's schema, non-strictly (matching the contract, which allows extra properties -
    `MapMeasurementOut.results` is deliberately one flat shape), so C4 (`dsm_surface_id`), C5 (no
    `step_m`) and C6 (no per-series `nodata_fraction`) are exercised through the schema's required
    keys and forbidden fields alike."""
    bodies = {
        "distance_with_dsm": {"kind": "distance", "vertices": LINE, "surface_ids": [dsm]},
        "distance_without_dsm": {"kind": "distance", "vertices": LINE},
        "area": {"kind": "area", "vertices": RING},
        "profile_two_surfaces": {"kind": "profile", "vertices": LINE, "surface_ids": [dsm, dtm]},
    }
    created = {}
    for label, body in bodies.items():
        r = client.post(url(project_id), json=body)
        assert r.status_code == 201, r.text
        j = r.json()
        _assert_conforms("MapMeasurement", j)
        assert _errors(BRANCH_SCHEMA[j["kind"]], j["results"]) == [], (label, j["results"])
        assert "step_m" not in j["results"]  # C5
        for series in j["results"].get("series") or []:
            assert "nodata_fraction" not in series  # C6
        created[label] = j["id"]

    page = client.get(url(project_id)).json()
    _assert_conforms("MapMeasurementPage", page)
    page_site = client.get(url(project_id), params={"frame": "site"}).json()
    _assert_conforms("MapMeasurementPage", page_site)
    for row in page["items"] + page_site["items"]:  # listed profiles carry empty placeholders
        assert _errors(BRANCH_SCHEMA[row["kind"]], row["results"]) == [], row["results"]

    one = client.get(url(project_id, created["area"]), params={"frame": "site"}).json()
    _assert_conforms("MapMeasurement", one)


def test_create_rejects_an_explicit_null_note(client, project_id):
    r = client.post(url(project_id), json={"kind": "distance", "vertices": LINE, "note": None})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error")


def test_patch_rejects_empty_body_and_nulled_nonnullable_fields(client, project_id, dsm):
    created = client.post(url(project_id), json={"kind": "distance", "vertices": LINE})
    mid = created.json()["id"]
    empty = client.patch(url(project_id, mid), json={})
    assert (empty.status_code, empty.json()["error"]["code"]) == (422, "validation_error")
    for field in ("name", "vertices", "surface_ids"):
        r = client.patch(url(project_id, mid), json={field: None})
        assert (r.status_code, r.json()["error"]["code"]) == (422, "validation_error"), field
    # note is the one field the contract lets a PATCH null out
    cleared = client.patch(url(project_id, mid), json={"note": None})
    assert cleared.status_code == 200 and cleared.json()["note"] is None
