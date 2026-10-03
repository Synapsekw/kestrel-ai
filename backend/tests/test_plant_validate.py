"""Plant spec validation (spec 2026-10-03-plant-model-generator §5; plan pm-f0 Task 8): errors that
block, item problems the GLB survives, warnings, and large specs validated in the GLB job."""

import math
import time

import pytest

from app.asset_models.builders import base
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import ASYNC_VALIDATE_ITEMS, is_large, validate

PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 1000, "thickness": 10, "height": 2000},
    "source": {"kind": "assumed"},
}


def item(i, **over) -> dict:
    raw = {
        "id": f"i{i}",
        "name": f"Item {i}",
        "type": "other",
        "footprint": {"kind": "rect", "center": [i * 20.0, 0.0], "size": [8, 4]},
        "source": {"kind": "assumed"},
    }
    raw.update(over)
    return raw


def spec(*items, environment=()) -> AssetSpec:
    return AssetSpec.model_validate({"items": list(items), "environment": list(environment)})


def codes(issues) -> list[tuple[str, str]]:
    return [(i.code, i.part_id) for i in issues]


@pytest.fixture
def no_tank_builder(monkeypatch):
    base.load_all()
    scratch = dict(base.REGISTRY)
    scratch.pop("tank_lng", None)
    monkeypatch.setattr(base, "REGISTRY", scratch)


def test_an_m1_spec_reports_as_before():
    report = validate(AssetSpec.model_validate({"parts": [PART]}))
    assert report.ok and report.errors == [] and report.warnings == []


def test_a_clean_plant_spec_is_ok():
    report = validate(spec(item(1), item(2)))
    assert report.ok and report.errors == [] and report.warnings == []


def test_blocking_errors():
    report = validate(
        spec(
            item(1),
            item(1),
            item(2, type="made_up"),
            item(3, base_el=10.0, top_el=5.0),
            item(
                4, type="composite", parts=[{**PART, "params": {"id": 1000, "thickness": 600, "height": 10}}]
            ),
        )
    )
    assert not report.ok
    assert codes(report.blocking) == [
        ("duplicate_item_id", "i1"),
        ("unknown_type", "i2"),
        ("bad_heights", "i3"),
        ("bad_geometry", "i4/shell"),
    ]


def test_item_problems_the_glb_survives_are_errors_that_do_not_block():
    report = validate(
        spec(
            item(1, footprint={"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]}),
            item(2, footprint={"kind": "line", "pts": [[5, 5], [5, 5]], "width": 2}),
            item(3, params={"material": "Chrome"}),
            item(4, params={"material": math.nan}),
        )
    )
    assert report.ok and report.blocking == []
    assert codes(report.errors) == [
        ("bad_footprint", "i1"),
        ("bad_footprint", "i2"),
        ("invalid_params", "i3"),
        ("invalid_params", "i4"),
    ]
    assert "Chrome" not in report.errors[2].message  # never echoes the input


def test_warnings(no_tank_builder):
    report = validate(
        spec(
            item(1, type="tank_lng"),
            item(2, tag="T-2", confidence="high"),
            item(3, flags=[{"code": "plan_offset", "value": 1.5}, {"code": "height_mismatch"}]),
            item(4, footprint={"kind": "rect", "center": [80.5, 0.0], "size": [8, 4]}),
            item(
                5,
                type="composite",
                parts=[PART],
                footprint={"kind": "rect", "center": [80.0, 0.0], "size": [8, 4]},
            ),
        )
    )
    assert report.ok
    assert codes(report.warnings) == [
        ("builder_missing", "i1"),
        ("assumed_high_confidence", "i2"),
        ("item_flags", "i3"),
    ]  # i4 and i5 overlap but are different types
    overlapping = validate(
        spec(
            item(4, footprint={"kind": "rect", "center": [80.5, 0.0], "size": [8, 4]}),
            item(9, footprint={"kind": "rect", "center": [80.0, 0.0], "size": [8, 4]}),
        )
    )
    assert codes(overlapping.warnings) == [("overlap", "i4")]


def test_environment_outlines_and_ids_are_checked():
    sea = {
        "id": "sea",
        "kind": "sea",
        "pts": [[0, 0], [100, 0], [100, 100]],
        "el": 92.5,
        "source": {"kind": "assumed"},
    }
    bowtie = {**sea, "id": "land", "kind": "land", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]}
    report = validate(spec(environment=[sea, sea, bowtie]))
    assert codes(report.errors) == [("duplicate_env_id", "sea"), ("bad_footprint", "land")]
    assert not report.ok


def test_large_means_over_200_items_and_features():
    assert not is_large(spec(*[item(i) for i in range(ASYNC_VALIDATE_ITEMS)]))
    assert is_large(spec(*[item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]))


def test_two_thousand_items_validate_quickly():
    big = spec(*[item(i) for i in range(2000)])
    t = time.perf_counter()
    assert validate(big).ok
    assert time.perf_counter() - t < 10.0


# ----- over HTTP: the request path stays schema-only for a large spec (Review Focus 2)


@pytest.fixture
def model_url(client, project_id):
    base_url = f"/api/v1/projects/{project_id}/asset-models"
    return f"{base_url}/{client.post(base_url, json={'name': 'Plant'}).json()['id']}"


def test_a_small_spec_with_a_blocking_error_is_refused_at_once(client, model_url):
    r = client.post(f"{model_url}/versions", json={"spec": {"items": [item(1, type="made_up")]}})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["errors"][0]["code"] == "unknown_type"


def test_a_small_spec_shows_its_fallback_errors_as_warnings(client, model_url, project_id, wait_job):
    bowtie = item(2, footprint={"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]})
    r = client.post(f"{model_url}/versions", json={"spec": {"items": [item(1), bowtie]}})
    assert r.status_code == 201, r.text
    wait_job(project_id, r.json()["job"]["id"])
    detail = client.get(f"{model_url}/versions/1").json()
    assert [(w["code"], w["part_id"]) for w in detail["warnings"]] == [("bad_footprint", "i2")]


def test_a_large_spec_is_validated_in_its_glb_job(client, model_url, project_id, wait_job):
    items = [item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]
    items[7] = item(7, base_el=10.0, top_el=5.0)
    r = client.post(f"{model_url}/versions", json={"spec": {"items": items}})
    assert r.status_code == 201, r.text  # not refused in the request
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed"
    version = client.get(f"{model_url}/versions/1").json()
    assert version["glb_status"] == "failed"
    assert version["meta"]["validation"]["error_count"] == 1
    assert [(w["code"], w["part_id"]) for w in version["warnings"]] == [("bad_heights", "i7")]


def test_a_large_valid_spec_builds_and_keeps_its_report(client, model_url, project_id, wait_job):
    items = [item(i) for i in range(ASYNC_VALIDATE_ITEMS + 1)]
    items[3] = item(3, flags=[{"code": "plan_offset"}])
    r = client.post(f"{model_url}/versions", json={"spec": {"items": items}})
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    version = client.get(f"{model_url}/versions/1").json()
    assert version["glb_status"] == "ready"
    assert version["meta"]["validation"]["warning_count"] == 1
    assert [(w["code"], w["part_id"]) for w in version["warnings"]] == [("item_flags", "i3")]
