# backend/tests/test_plant_fixture.py
"""The fixture plant (plan A1 task 5): committed JSON = the builder's output; every type once."""

import json

from plant_fixture import COWORK_COUNTS, FIXTURE, TYPES, build_fixture, fixture_plant_spec, synthetic_plant

from app.asset_models.builders.base import REGISTRY, load_all
from app.asset_models.jobs_glb import issue_item_id
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate


def test_committed_fixture_matches_the_builder():
    assert json.loads(FIXTURE.read_text("utf-8")) == fixture_plant_spec()


def test_fixture_is_a_valid_spec_covering_every_type():
    spec = AssetSpec.model_validate(fixture_plant_spec())
    assert 55 <= len(spec.items) <= 65
    assert {i.type for i in spec.items} == set(TYPES) | {"composite"}
    assert set(TYPES) == set(COWORK_COUNTS)
    assert {f.kind for f in spec.environment} == {"land", "sea", "road"}
    assert spec.site.crs.epsg == 32639
    assert len({i.id for i in spec.items}) == len(spec.items)


def test_fixture_errors_are_only_types_not_built_yet():
    load_all()
    spec = AssetSpec.model_validate(fixture_plant_spec())
    by_id = {i.id: i for i in spec.items}
    report = validate(spec)
    for issue in report.errors:
        assert by_id[issue_item_id(issue)].type not in REGISTRY, issue


def test_synthetic_plant_follows_coworks_mix():
    raw = synthetic_plant(2000)
    assert len(raw["items"]) == 2000 and len({i["id"] for i in raw["items"]}) == 2000
    pumps = sum(i["type"] == "pump" for i in raw["items"])
    assert abs(pumps - 2000 * 93 / 885) < 1
    only = synthetic_plant(10, types=("other", "pump"))
    assert [i["type"] for i in only["items"]].count("other") == 5
    AssetSpec.model_validate(raw)


def test_fixture_builds_a_glb_and_csv(tmp_path):
    glb, csv_path = build_fixture(tmp_path)
    assert glb.read_bytes()[:4] == b"glTF"
    lines = csv_path.read_text("utf-8").splitlines()
    assert len(lines) == 1 + len(fixture_plant_spec()["items"])
