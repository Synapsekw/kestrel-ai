"""I1's pydantic bodies mirror F0's contract schemas field for field (index "Backend: intake")."""

from pathlib import Path

import pytest
import yaml

from app.drawings.schemas import (
    DrawingPagesCreate,
    DrawingPagesWithJob,
    UnimportedDrawingList,
    UnimportedDrawingOut,
)

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
DOC = yaml.safe_load(SPEC.read_text("utf-8"))


def _props(name: str) -> set[str]:
    return set(DOC["components"]["schemas"][name]["properties"])


@pytest.mark.parametrize(
    ("model", "schema"),
    [
        (DrawingPagesCreate, "DrawingPagesCreate"),
        (DrawingPagesWithJob, "DrawingPagesWithJob"),
        (UnimportedDrawingList, "UnimportedDrawingList"),
        (UnimportedDrawingOut, "UnimportedDrawing"),
    ],
)
def test_models_mirror_the_contract(model, schema):
    assert set(model.model_fields) == _props(schema)


def test_operations_are_where_the_index_says():
    ops = {
        op["operationId"]: (method, path)
        for path, item in DOC["paths"].items()
        for method, op in item.items()
        if isinstance(op, dict) and "operationId" in op
    }
    assert ops["createDrawingPages"] == ("post", "/api/v1/projects/{projectId}/drawings/pages")
    assert ops["listUnimportedDrawings"] == (
        "get",
        "/api/v1/projects/{projectId}/drawings/unimported",
    )


def test_pages_takes_all_or_a_list():
    assert (
        DrawingPagesCreate.model_validate(
            {"inspection_id": "x", "name": "Set", "pages": "all", "placement": {"method": "none"}}
        ).pages
        == "all"
    )
    assert DrawingPagesCreate.model_validate(
        {"inspection_id": "x", "name": "Set", "pages": [3, 1], "placement": {"method": "none"}}
    ).pages == [3, 1]
    with pytest.raises(ValueError):
        DrawingPagesCreate.model_validate(
            {"inspection_id": "x", "name": "Set", "pages": [0], "placement": {"method": "none"}}
        )
