"""Finding output read from migration 0016's columns (asset findings spec §8): the asset anchor, the
asset fields and the sighting count. C0's `test_asset_findings_out.py` covers the older kinds;
`representative` for an asset finding is J4's."""

from app.db.models import AssetModel, Finding

API = "/api/v1"


def _asset_finding(handle, type_id: str) -> tuple[str, str]:
    """An asset model and one placed asset finding on it, as the grouping job writes it."""
    with handle.session() as s:
        model = AssetModel(name="Flare stack", status="ready")
        s.add(model)
        s.flush()
        finding = Finding(
            number=900,
            type_id=type_id,
            severity=2,
            anchor_kind="asset",
            asset_model_id=model.id,
            asset_version=1,
            ax=1.0,
            ay=42.5,
            az=-3.0,
            an_x=0.0,
            an_y=0.0,
            an_z=1.0,
            placement="patch",
            height_m=42.5,
            bearing_deg=90.0,
            side="E",
            zone="shaft",
            component="Shell",
            sighting_count=3,
            data_type="asset_model",
            data_id=model.id,
        )
        s.add(finding)
        s.flush()
        return finding.id, model.id


def test_an_asset_finding_returns_its_asset_fields(client, project_id, handle, crack):
    finding_id, model_id = _asset_finding(handle, crack["id"])
    detail = client.get(f"{API}/projects/{project_id}/findings/{finding_id}").json()
    page = client.get(f"{API}/projects/{project_id}/findings").json()
    assert [f["id"] for f in page["items"]] == [finding_id]
    for f in (detail, page["items"][0]):
        assert f["anchor"] == {
            "kind": "asset",
            "asset_model_id": model_id,
            "asset_version": 1,
            "point": [1.0, 42.5, -3.0],
            "normal": [0.0, 0.0, 1.0],
        }
        assert (f["asset_model_id"], f["height_m"], f["bearing_deg"]) == (model_id, 42.5, 90.0)
        assert (f["side"], f["zone"], f["component"], f["placement"]) == ("E", "shaft", "Shell", "patch")
        assert f["sighting_count"] == 3


def test_an_unplaced_asset_finding_has_no_point(client, project_id, handle, crack):
    finding_id, _ = _asset_finding(handle, crack["id"])
    with handle.session() as s:
        row = s.get(Finding, finding_id)
        row.ax = row.ay = row.az = row.an_x = row.an_y = row.an_z = None
        row.placement, row.height_m, row.side, row.zone = "none", None, None, None
    f = client.get(f"{API}/projects/{project_id}/findings/{finding_id}").json()
    assert (f["anchor"]["point"], f["anchor"]["normal"], f["placement"]) == (None, None, "none")
    assert (f["height_m"], f["side"], f["zone"]) == (None, None, None)


def test_an_asset_model_answers_its_stored_frame(client, project_id, handle):
    m = client.post(f"{API}/projects/{project_id}/asset-models", json={"name": "Flare stack"}).json()
    frame = {"height_m": 74.4, "north_offset_deg": 0.0, "silhouette": [[0.0, 5.0]], "levels": []}
    with handle.session() as s:
        s.get(AssetModel, m["id"]).frame = frame
    got = client.get(f"{API}/projects/{project_id}/asset-models/{m['id']}").json()
    assert (got["frame"], got["review"]) == (frame, None)
