"""The model spec (spec 2026-10-02 §6.1-6.2)."""

import pytest
from pydantic import ValidationError

from app.asset_models.spec import SHAPE_PARAMS, AssetSpec, Part


def shell(**over):
    base = {
        "id": "shell_course_1",
        "name": "Shell course 1",
        "group": "Shell",
        "shape": "cylinder",
        "params": {"id": 4000, "thickness": 8, "height": 3000},
        "placement": {"origin_mm": [0, 0, 0]},
        "material": "paint",
        "source": {"kind": "drawing", "id": "d1", "region": [0.1, 0.1, 0.4, 0.3]},
        "confidence": "high",
    }
    base.update(over)
    return base


def test_minimal_spec_parses_with_defaults():
    spec = AssetSpec.model_validate({"asset": {}, "parts": [shell()]})
    part = spec.parts[0]
    assert part.placement.axis == [0.0, 1.0, 0.0]
    assert part.typed_params().height == 3000


def test_every_vocabulary_shape_has_a_params_model():
    assert set(SHAPE_PARAMS) == {
        "cylinder",
        "cone",
        "head_torispherical",
        "head_ellipsoidal",
        "head_hemispherical",
        "flat_plate",
        "box",
        "nozzle",
        "pipe_run",
        "lathe",
        "extrusion",
        "sweep",
    }


@pytest.mark.parametrize(
    "params",
    [
        {"id": 4000, "thickness": 8},  # height missing
        {"id": 4000, "thickness": 8, "height": -1},  # non-positive
        {"id": 4000, "thickness": 8, "height": 10, "x": 1},  # unknown key
    ],
)
def test_bad_params_are_rejected(params):
    with pytest.raises(ValidationError):
        AssetSpec.model_validate({"asset": {}, "parts": [shell(params=params)]})


def test_unknown_shape_is_rejected():
    with pytest.raises(ValidationError):
        Part.model_validate(shell(shape="torus"))


def test_region_must_be_inside_unit_square():
    with pytest.raises(ValidationError):
        Part.model_validate(shell(source={"kind": "drawing", "id": "d1", "region": [0, 0, 1.2, 1]}))


def test_shell_mounted_placement_needs_bearing_and_elevation():
    nozzle = shell(
        id="N1",
        group="Nozzle",
        shape="nozzle",
        params={"dn": 50, "od": 60.3, "projection": 200, "flange_od": 165, "flange_t": 20},
        placement={"host": "shell_course_1", "bearing_deg": 90},
    )
    with pytest.raises(ValidationError, match="elevation_mm"):
        Part.model_validate(nozzle)


def test_spec_round_trips_through_json():
    spec = AssetSpec.model_validate({"asset": {"tag": "710-D-130335"}, "parts": [shell()]})
    again = AssetSpec.model_validate_json(spec.model_dump_json())
    assert again == spec


@pytest.mark.parametrize(
    ("outline", "ok"),
    [
        ({"d": 1000}, True),
        ({"w": 500, "l": 800}, True),
        ({"d": 1000, "w": 500}, False),
        ({"d": 1000, "l": 800}, False),
        ({"d": 1000, "w": 500, "l": 800}, False),
        ({"w": 500}, False),
        ({}, False),
    ],
)
def test_flat_plate_takes_d_or_w_and_l_never_a_mix(outline, ok):
    data = shell(shape="flat_plate", group="Head", params={**outline, "thickness": 8})
    if ok:
        Part.model_validate(data)
    else:
        with pytest.raises(ValidationError, match="either d, or both w and l"):
            Part.model_validate(data)
