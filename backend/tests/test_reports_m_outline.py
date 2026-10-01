"""R9-M sections' etags (R2 protocol `fingerprint(ctx)`, spec §14): each moves when the data it prints
changes, and only then, so the preview refetches exactly the stale sections."""

from datetime import UTC, date, datetime

import pytest
from reports_m_rows import add_dem, add_geomap, map_finding, map_measurement, map_run, ready_volume, site_area
from reports_rows import add_cloud, add_findings, add_report, add_type, config
from sqlalchemy import update

from app.db.models import Finding, MapRun, VolumeMeasurement

API = "/api/v1"
SECTIONS = ("summary", "findings_table", "measurements", "comparison", "object_counts")
R9M = {"measurements", "comparison", "object_counts"}


@pytest.fixture
def seeded(handle, project):
    exc = project["classes"][0]["id"]
    aug = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    sep = add_geomap(handle, name="Sep", captured_on=date(2026, 9, 1))
    run = map_run(handle, map_id=aug, counts={exc: 3})
    t, c = add_type(handle, "crack"), add_cloud(handle)
    ids = add_findings(handle, [{"type_id": t, "severity": 2, "anchor": "cloud", "target": c}])
    rid = add_report(handle, config(sections=SECTIONS))
    return {"rid": rid, "aug": aug, "sep": sep, "run": run, "exc": exc, "finding": ids[0]}


def _etags(client, pid, rid):
    body = client.get(f"{API}/projects/{pid}/reports/{rid}/outline").json()
    return {s["key"]: s["etag"] for s in body["sections"]}


def _moved(client, pid, rid, change) -> set[str]:
    before = _etags(client, pid, rid)
    change()
    after = _etags(client, pid, rid)
    assert _etags(client, pid, rid) == after  # stable between reads
    return {k for k in before if before[k] != after[k]}


def test_a_new_measurement_moves_only_the_measurements_etag(client, project_id, handle, seeded):
    moved = _moved(
        client,
        project_id,
        seeded["rid"],
        lambda: map_measurement(
            handle, kind="distance", vertices=[[500010, 4982990], [500040, 4982960]], map_id=seeded["sep"]
        ),
    )
    assert moved == {"measurements"}


def test_a_volume_turning_stale_moves_the_measurements_etag(client, project_id, handle, seeded):
    vid = ready_volume(handle, add_dem(handle))

    def stale():
        with handle.session() as s:
            s.execute(
                update(VolumeMeasurement)
                .where(VolumeMeasurement.id == vid)
                .values(status="stale", updated_at=datetime(2026, 9, 29, tzinfo=UTC))
            )

    assert "measurements" in _moved(client, project_id, seeded["rid"], stale)


def test_a_new_map_run_moves_comparison_and_object_counts(client, project_id, handle, seeded):
    moved = _moved(
        client,
        project_id,
        seeded["rid"],
        lambda: map_run(handle, map_id=seeded["sep"], counts={seeded["exc"]: 5}),
    )
    assert moved == {"comparison", "object_counts"}


def test_verifying_on_a_run_moves_the_counts_sections(client, project_id, handle, seeded):
    def verify():
        with handle.session() as s:
            s.execute(
                update(MapRun).where(MapRun.id == seeded["run"]).values(verified_counts={seeded["exc"]: 2})
            )

    assert _moved(client, project_id, seeded["rid"], verify) == {"comparison", "object_counts"}


def test_a_new_site_area_moves_the_counts_sections(client, project_id, handle, seeded):
    moved = _moved(
        client, project_id, seeded["rid"], lambda: site_area(handle, name="Yard", px=(0, 0, 10, 10))
    )
    assert {"comparison", "object_counts"} <= moved and "measurements" not in moved


def test_a_finding_on_a_survey_map_moves_the_comparison_frame(client, project_id, handle, seeded):
    moved = _moved(
        client,
        project_id,
        seeded["rid"],
        lambda: map_finding(
            handle,
            map_id=seeded["aug"],
            geometry={"type": "Point", "coordinates": [500050.0, 4982950.0]},
            number=99,
            type_id=seeded["exc"],
            lon=15.0006,
            lat=44.99955,
        ),
    )
    assert "comparison" in moved and not moved & {"measurements", "object_counts"}


def test_a_finding_severity_edit_moves_no_r9m_section(client, project_id, handle, seeded):
    def edit():
        with handle.session() as s:
            s.execute(
                update(Finding)
                .where(Finding.id == seeded["finding"])
                .values(severity=4, updated_at=datetime(2026, 9, 29, tzinfo=UTC))
            )

    moved = _moved(client, project_id, seeded["rid"], edit)
    assert {"summary", "findings_table"} <= moved and not moved & R9M
