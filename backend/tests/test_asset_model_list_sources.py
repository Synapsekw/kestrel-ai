"""list_sources groups a PDF's pages by source file (index "Backend: intake"; I1 Ruling 13)."""

import json
import uuid

from app.asset_models.agent.tools import RunContext, group_drawing_sources, run_tool
from app.asset_models.spec import AssetSpec

SOURCES = [
    {
        "type": "drawing",
        "id": "a2",
        "label": "T5 · p2",
        "facts": "view: yes",
        "file": "T5.pdf",
        "sha256": "s1",
        "page": 2,
    },
    {
        "type": "drawing",
        "id": "a1",
        "label": "T5 · p1",
        "facts": "view: yes",
        "file": "T5.pdf",
        "sha256": "s1",
        "page": 1,
    },
    {
        "type": "drawing",
        "id": "b1",
        "label": "GA",
        "facts": "view: no, text: yes",
        "file": "GA.dxf",
        "sha256": "s2",
        "page": None,
    },
    {"type": "drawing", "id": "gone", "label": "gone", "facts": "missing"},
    {"type": "point_cloud", "id": "c1", "label": "Scan", "facts": "12 points"},
]


def test_pages_of_one_file_group_by_sha_in_page_order():
    groups = group_drawing_sources(SOURCES)
    assert [g["file"] for g in groups] == ["T5.pdf", "GA.dxf", "gone"]
    assert groups[0] == {
        "file": "T5.pdf",
        "facts": "view: yes",
        "pages": [{"id": "a1", "page": 1, "label": "T5 · p1"}, {"id": "a2", "page": 2, "label": "T5 · p2"}],
    }
    assert groups[2]["pages"] == [{"id": "gone", "page": None, "label": "gone"}]


def test_the_tool_lists_one_line_per_file_then_the_other_sources(handle, tmp_path):
    ctx = RunContext(
        handle=handle,
        model_id=str(uuid.uuid4()),
        run_id=str(uuid.uuid4()),
        sources=SOURCES,
        spec=AssetSpec(),
        samples={},
    )
    ctx.run_dir = tmp_path
    out = run_tool(ctx, "list_sources", {})
    lines = out.text.splitlines()
    assert len(lines) == 4
    first = json.loads(lines[0].removeprefix("drawing file "))
    assert first["file"] == "T5.pdf" and [p["id"] for p in first["pages"]] == ["a1", "a2"]
    assert lines[3] == "point_cloud c1: Scan 12 points"
    assert out.summary == "Listed 5 sources"
    assert "\\" not in out.text and ":/" not in out.text
