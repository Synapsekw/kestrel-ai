"""The timeline endpoint over real rows: ordering, deltas, and the honest markers."""

from datetime import UTC, date, datetime

import pytest

from app.db.models import GeoMap, MapRun

BASE = "/api/v1/projects"


@pytest.fixture
def three_surveys(handle):
    """April and June counted with the same model; May with another one."""
    with handle.session() as s:
        for i, (name, when) in enumerate(
            [("April", date(2026, 4, 1)), ("May", date(2026, 5, 1)), ("June", date(2026, 6, 1))],
            start=1,
        ):
            s.add(
                GeoMap(
                    id=f"map-{i}",
                    name=name,
                    status="ready",
                    source_path=f"E:/nowhere/{i}.tif",
                    source_size=1,
                    captured_on=when,
                    created_at=datetime(2026, 1, i, tzinfo=UTC),
                )
            )
        for i, (map_id, model, counts) in enumerate(
            [("map-1", "mod-a", {"c1": 5}), ("map-2", "mod-b", {"c1": 50}), ("map-3", "mod-a", {"c1": 9})],
            start=1,
        ):
            s.add(
                MapRun(
                    id=f"run-{i}",
                    map_id=map_id,
                    kind="local_model",
                    model_id=model,
                    model_name=model,
                    conf=0.25,
                    counts=counts,
                    created_at=datetime(2026, 2, i, tzinfo=UTC),
                )
            )


def test_timeline_is_oldest_first_with_deltas_between_comparable_surveys(client, project_id, three_surveys):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    # The newest run is June's (mod-a), so that is the basis.
    assert body["basis"]["model_name"] == "mod-a"
    assert [s["map_name"] for s in body["surveys"]] == ["April", "May", "June"]
    assert body["surveys"][1]["state"] == "not_comparable"
    assert body["surveys"][2]["deltas"] == {"c1": 4}  # June minus April, skipping May


def test_the_basis_can_be_chosen(client, project_id, three_surveys):
    body = client.get(
        f"{BASE}/{project_id}/survey-timeline", params={"model_id": "mod-b", "conf": 0.25}
    ).json()
    assert body["basis"]["model_id"] == "mod-b"
    assert [s["state"] for s in body["surveys"]] == ["not_comparable", "ok", "not_comparable"]


def test_a_project_with_no_maps_returns_an_empty_timeline(client, project_id):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    assert body["basis"] is None
    assert body["surveys"] == []


def test_the_timeline_carries_the_project_classes_for_the_chart(client, project_id, three_surveys):
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    assert len(body["classes"]) == 8
    assert {"id", "name", "colour"} <= set(body["classes"][0])


def test_a_map_that_was_never_run_is_listed_as_not_counted(client, project_id, handle, three_surveys):
    with handle.session() as s:
        s.add(
            GeoMap(
                id="map-4",
                name="July",
                status="ready",
                source_path="E:/nowhere/4.tif",
                source_size=1,
                captured_on=date(2026, 7, 1),
                created_at=datetime(2026, 1, 4, tzinfo=UTC),
            )
        )
    body = client.get(f"{BASE}/{project_id}/survey-timeline").json()
    july = body["surveys"][-1]
    assert july["map_name"] == "July"
    assert july["state"] == "not_counted"
    assert july["run_id"] is None
