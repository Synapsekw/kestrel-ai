"""Project agent: in-process dispatch, image selectors and the tool registry (Task 4).

Every tool call runs on the TestClient's event loop (`client.portal.call`), the same loop that
ran the app's lifespan, exactly as the turn runner will call them on the server's loop.
"""

import base64
import io
import json
import time

import pytest
from PIL import Image as PILImage

from app.db.models import Model
from app.project_agent import dispatch, tools
from app.project_agent.dispatch import ApiCaller, ApiCallError, ImageSelector, resolve_selection
from app.project_agent.tools import (
    REGISTRY,
    Prepared,
    Tool,
    ToolContext,
    ToolOutcome,
    execute_approved,
    render_image_b64,
    run_tool,
    tool_specs,
)
from app.providers.base import TileResult

TOKEN = "test-token"
N_IMAGES = 12


@pytest.fixture
def folder(tmp_path, make_jpeg):
    """Twelve small noise images; the first one is large enough to test the 1024 px render."""
    src = tmp_path / "flight_a"
    make_jpeg(src / "img00.jpg", 1600, 1000, seed=100)
    for i in range(1, N_IMAGES):
        make_jpeg(src / f"img{i:02d}.jpg", 96, 64, seed=100 + i)
    return src


@pytest.fixture
def source_id(project_id, folder, import_source):
    return import_source(project_id, folder)


@pytest.fixture
def image_ids(client, project_id, source_id) -> list[str]:
    page = client.get(f"/api/v1/projects/{project_id}/images", params={"limit": 100}).json()
    assert len(page["items"]) == N_IMAGES
    return [i["id"] for i in page["items"]]  # path order


@pytest.fixture
def agent(client, app, project_id):
    """Run `fn(ctx)` (an async callable) on the app's loop with a fresh ApiCaller."""

    def _run(fn, user_texts=()):
        async def main():
            async with ApiCaller(app, TOKEN, project_id) as api:
                return await fn(ToolContext(api=api, project_id=project_id, user_texts=list(user_texts)))

        return client.portal.call(main)

    return _run


@pytest.fixture
def tool(agent):
    """Call one tool through `run_tool` and return its outcome (or Prepared)."""

    def _tool(name, args=None, user_texts=()):
        return agent(lambda ctx: run_tool(ctx, name, args or {}), user_texts)

    return _tool


def ok(outcome) -> dict:
    assert isinstance(outcome, ToolOutcome), outcome
    assert not outcome.is_error, outcome.result
    return json.loads(outcome.result)


class EmptyProvider:
    name = "fake"

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        return TileResult(tile=tile, detections=[], raw={})


@pytest.fixture
def fake_provider(monkeypatch):
    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: EmptyProvider())


@pytest.fixture
def model_id(handle) -> str:
    with handle.session() as s:
        m = Model(name="coco-n", kind="imported", weights_path="models/m.pt", class_names=["excavator"])
        s.add(m)
        s.flush()
        return m.id


# -------------------------------------------------------------------- dispatch


def test_the_caller_resolves_relative_and_absolute_paths_and_raises_the_envelope(agent, project_id):
    async def go(ctx):
        project = await ctx.api.call("GET", "")
        starters = await ctx.api.call("GET", "/api/v1/starter-models")
        with pytest.raises(ApiCallError) as err:
            await ctx.api.call("GET", "/images/ghost")
        return project, starters, err.value

    project, starters, err = agent(go)
    assert project["id"] == project_id
    assert starters["items"]
    assert (err.status, err.code) == (404, "not_found")
    assert "ghost" in err.message


def test_selector_pages_follow_the_cursor(agent, image_ids, monkeypatch):
    monkeypatch.setattr(dispatch, "SELECT_PAGE", 5)
    pages = []

    async def go(ctx):
        real = ctx.api.call

        async def counting(method, path, **kw):
            pages.append(kw.get("params", {}).get("limit"))
            return await real(method, path, **kw)

        ctx.api.call = counting
        return await resolve_selection(ctx.api, ImageSelector(limit=N_IMAGES))

    assert agent(go) == image_ids
    assert pages == [5, 5, 2]


@pytest.mark.parametrize(("offset", "limit"), [(0, 4), (3, 4), (4, 5), (10, 5), (12, 5)])
def test_selector_offset_and_limit(agent, image_ids, monkeypatch, offset, limit):
    monkeypatch.setattr(dispatch, "SELECT_PAGE", 5)
    got = agent(lambda ctx: resolve_selection(ctx.api, ImageSelector(offset=offset, limit=limit)))
    assert got == image_ids[offset : offset + limit]


def test_selector_sort_and_filters(agent, image_ids):
    desc = agent(lambda ctx: resolve_selection(ctx.api, ImageSelector(order="desc", limit=3)))
    assert desc == image_ids[::-1][:3]
    none = agent(lambda ctx: resolve_selection(ctx.api, ImageSelector(labeled=True)))
    assert none == []
    one = agent(lambda ctx: resolve_selection(ctx.api, ImageSelector(search="IMG05")))
    assert one == [image_ids[5]]


def test_selector_ids_keep_the_given_order_and_drop_unknown_ids(agent, image_ids):
    sel = ImageSelector(image_ids=[image_ids[5], "ghost", image_ids[1], image_ids[5]])
    assert agent(lambda ctx: resolve_selection(ctx.api, sel)) == [image_ids[5], image_ids[1]]


def test_selector_rejects_unknown_fields_and_bounds():
    with pytest.raises(ValueError):
        ImageSelector(marked=True)
    with pytest.raises(ValueError):
        ImageSelector(limit=5001)
    with pytest.raises(ValueError):
        ImageSelector(image_ids=["x"] * 201)


def test_render_image_b64_is_a_jpeg_at_most_1024_px(agent, image_ids):
    b64 = agent(lambda ctx: render_image_b64(ctx.api, image_ids[0]))
    im = PILImage.open(io.BytesIO(base64.b64decode(b64)))
    assert im.format == "JPEG"
    assert max(im.size) == 1024
    assert agent(lambda ctx: render_image_b64(ctx.api, "ghost")) is None


# ------------------------------------------------------------------- registry


EXPECTED = {
    "get_project": "read",
    "list_sources": "read",
    "find_images": "read",
    "get_image": "read",
    "view_image": "read",
    "list_models": "read",
    "list_starter_models": "read",
    "list_datasets": "read",
    "get_dataset": "read",
    "list_query_runs": "read",
    "list_jobs": "read",
    "get_job": "read",
    "estimate_labeling": "read",
    "update_classes": "write",
    "label_images": "write",
    "accept_suggestions": "write",
    "undo_accept_suggestions": "write",
    "review_boxes": "write",
    "mark_images_empty": "write",
    "create_box": "write",
    "update_box": "write",
    "import_folder": "write",
    "acquire_starter_model": "write",
    "create_dataset": "write",
    "export_results": "write",
    "export_model": "write",
    "update_project": "write",
    "cancel_job": "write",
    "wait_for_job": "write",
    "open_screen": "write",
    "train_model": "approval",
    "delete_images": "approval",
    "delete_boxes": "approval",
    "delete_dataset": "approval",
    "delete_model": "approval",
}


def test_the_registry_holds_every_tool_with_its_risk():
    assert {name: t.risk for name, t in REGISTRY.items()} == EXPECTED
    for t in REGISTRY.values():
        assert t.label and len(t.description) > 40


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_tool_specs_are_self_contained_json_schemas():
    specs = {s.name: s for s in tool_specs()}
    assert set(specs) == set(EXPECTED)
    for spec in specs.values():
        schema = spec.input_schema
        assert schema["type"] == "object"
        text = json.dumps(schema)
        assert "$ref" not in text and "$defs" not in text
        for node in _walk(schema):
            assert "title" not in node or not isinstance(node["title"], str), spec.name
    label = specs["label_images"].input_schema
    assert "selection" in label["properties"]
    assert label["properties"]["selection"]["properties"]["limit"]["maximum"] == 5000
    rename = specs["update_classes"].input_schema["properties"]["rename"]
    assert set(rename["items"]["properties"]) == {"from", "to"}


def test_an_unknown_tool_is_an_error_outcome(tool):
    out = tool("format_disk", {})
    assert out.is_error and "format_disk" in out.result


def test_bad_arguments_are_an_error_outcome_that_names_the_field(tool):
    out = tool("find_images", {"selection": {"limit": 0}})
    assert out.is_error
    assert "limit" in out.result
    out = tool("get_image", {})
    assert out.is_error and "image_id" in out.result


def test_an_api_error_is_an_error_outcome_with_the_envelope_message(tool):
    out = tool("get_image", {"image_id": "ghost"})
    assert out.is_error
    assert "not found" in out.result


def test_results_are_truncated_to_8000_chars(tool, monkeypatch):
    from pydantic import BaseModel

    class NoArgs(BaseModel):
        pass

    class Long(Tool):
        name = "long"
        description = "returns a very long result for the truncation test"
        Args = NoArgs
        risk = "read"
        label = "Long"

        async def run(self, ctx, args):
            return ToolOutcome(result="x" * 20_000, summary="long")

    monkeypatch.setitem(REGISTRY, "long", Long())
    out = tool("long")
    assert len(out.result) <= 8000
    assert out.result.startswith("xxx")


# ----------------------------------------------------------------- read tools


def test_get_project_reports_classes_and_counts(tool, image_ids, project):
    body = ok(tool("get_project"))
    assert body["name"] == "T"
    assert body["classes"][0] == {"id": project["classes"][0]["id"], "name": "excavator"}
    assert body["stats"]["image_count"] == N_IMAGES
    assert body["stats"]["labeled_count"] == 0


def test_list_sources(tool, source_id, folder):
    body = ok(tool("list_sources"))
    assert body["sources"][0]["id"] == source_id
    assert body["sources"][0]["image_count"] == N_IMAGES


def test_find_images_counts_and_lists_at_most_50_rows(tool, image_ids):
    body = ok(tool("find_images", {"selection": {"limit": 5000}}))
    assert body["selected"] == N_IMAGES
    assert [r["id"] for r in body["images"]] == image_ids
    assert set(body["images"][0]) == {
        "id",
        "file_name",
        "labeled",
        "box_count",
        "pending_count",
        "marked_empty",
    }
    body = ok(tool("find_images", {"selection": {"offset": 2, "limit": 3}}))
    assert body["selected"] == 3
    assert [r["id"] for r in body["images"]] == image_ids[2:5]


def test_find_images_caps_the_rows_at_50(tool, monkeypatch, image_ids):
    monkeypatch.setattr(tools, "FIND_ROWS", 4)
    body = ok(tool("find_images", {}))
    assert body["selected"] == N_IMAGES
    assert len(body["images"]) == 4


def test_get_image_resolves_class_names(tool, client, project_id, project, image_ids):
    cls = project["classes"][1]
    client.post(
        f"/api/v1/projects/{project_id}/images/{image_ids[1]}/boxes",
        json={"class_id": cls["id"], "x": 1, "y": 1, "w": 10, "h": 10},
    )
    body = ok(tool("get_image", {"image_id": image_ids[1]}))
    assert body["image"]["id"] == image_ids[1]
    assert body["image"]["file_name"] == "img01.jpg"
    assert body["boxes"][0]["class"] == "wheel_loader"
    assert body["boxes"][0]["review_state"] == "accepted"


def test_view_image_hands_the_image_to_the_runner(tool, image_ids):
    out = tool("view_image", {"image_id": image_ids[0]})
    assert not out.is_error
    assert out.image_id == image_ids[0]
    assert "img00.jpg" in out.result and "1600" in out.result


def test_model_starter_dataset_run_and_job_lists(tool, model_id, image_ids):
    models = ok(tool("list_models"))
    assert models["models"][0]["id"] == model_id
    starters = ok(tool("list_starter_models"))
    assert any(s["key"] == "yolo11n" for s in starters["starters"])
    assert ok(tool("list_datasets")) == {"datasets": []}
    assert ok(tool("list_query_runs")) == {"query_runs": []}
    jobs = ok(tool("list_jobs"))
    assert jobs["jobs"][0]["type"] == "import"
    job = ok(tool("get_job", {"job_id": jobs["jobs"][0]["id"]}))
    assert job["state"] == "succeeded"
    assert isinstance(job["log"], list) and len(job["log"]) <= 40


def test_estimate_labeling_uses_the_resolved_selection(tool, image_ids):
    body = ok(
        tool(
            "estimate_labeling",
            {
                "selection": {"limit": 3},
                "labeler": {"kind": "cloud_provider", "provider": "anthropic", "query": "excavators"},
            },
        )
    )
    assert body["images"] == 3
    assert body["requests"] >= 3
    assert body["estimated_cost"] > 0


# ---------------------------------------------------------------- write tools


def test_update_classes_adds_and_renames_keeping_ids(tool, client, project_id, project):
    before = {c["name"]: c["id"] for c in project["classes"]}
    out = tool(
        "update_classes",
        {"add": ["tower_crane", "pump"], "rename": [{"from": "roller", "to": "compactor"}]},
    )
    ok(out)
    after = client.get(f"/api/v1/projects/{project_id}").json()["classes"]
    names = [c["name"] for c in after]
    assert names[-2:] == ["tower_crane", "pump"]
    assert "roller" not in names
    by_name = {c["name"]: c for c in after}
    assert by_name["compactor"]["id"] == before["roller"]
    assert by_name["excavator"]["hotkey"] == "1"
    assert by_name["tower_crane"]["colour"].startswith("#")
    assert by_name["tower_crane"]["hotkey"] == "9"


def test_update_classes_rename_of_an_unknown_class_is_an_error(tool):
    out = tool("update_classes", {"rename": [{"from": "spaceship", "to": "x"}]})
    assert out.is_error and "spaceship" in out.result


def test_label_images_with_a_local_model_starts_a_job(
    tool, image_ids, model_id, fake_provider, wait_job, project_id
):
    out = tool(
        "label_images",
        {"selection": {"limit": 5}, "labeler": {"kind": "local_model", "model_id": model_id}, "conf": 0.3},
    )
    body = ok(out)
    assert body["images"] == 5
    assert out.job_ids == [body["job_id"]]
    assert body["query_run_id"]
    wait_job(project_id, body["job_id"])


def test_label_images_with_an_unknown_model_is_an_error(tool, image_ids):
    out = tool(
        "label_images",
        {"selection": {"limit": 2}, "labeler": {"kind": "local_model", "model_id": "ghost"}},
    )
    assert out.is_error and "not found" in out.result


def test_label_images_with_no_matching_images_is_an_error(tool, image_ids, model_id):
    out = tool(
        "label_images",
        {"selection": {"labeled": True}, "labeler": {"kind": "local_model", "model_id": model_id}},
    )
    assert out.is_error and "No images" in out.result


def test_cloud_labeling_needs_approval_with_the_estimate(
    tool, agent, app, image_ids, fake_provider, wait_job, project_id
):
    app.state.keys.set("anthropic", "sk-fake-key")
    args = {
        "selection": {"offset": 1, "limit": 4},
        "labeler": {"kind": "cloud_provider", "provider": "anthropic", "query": "excavators"},
    }
    prepared = tool("label_images", args)
    assert isinstance(prepared, Prepared)
    assert prepared.title == "Label 4 images with anthropic"
    assert "4 images" in prepared.detail and "requests" in prepared.detail and "$" in prepared.detail
    assert prepared.estimated_cost > 0
    assert prepared.args["image_ids"] == image_ids[1:5]
    assert "sk-fake-key" not in json.dumps(prepared.args) + prepared.detail
    # Nothing exists until the approval executes it.
    assert ok(tool("list_query_runs")) == {"query_runs": []}

    out = agent(lambda ctx: execute_approved(ctx, "label_images", prepared.args))
    body = ok(out)
    assert out.job_ids == [body["job_id"]]
    runs = ok(tool("list_query_runs"))["query_runs"]
    assert runs[0]["image_count"] == 4 and runs[0]["provider"] == "anthropic"
    wait_job(project_id, body["job_id"])


def test_cloud_labeling_without_a_key_is_refused_before_approval(tool, image_ids):
    out = tool(
        "label_images",
        {
            "selection": {"limit": 2},
            "labeler": {"kind": "cloud_provider", "provider": "openai", "query": "excavators"},
        },
    )
    assert isinstance(out, ToolOutcome) and out.is_error
    assert "key" in out.result.lower()


def test_import_folder_only_accepts_a_folder_the_user_typed(tool, tmp_path, make_jpeg, project_id, wait_job):
    other = tmp_path / "Other Site"
    make_jpeg(other / "a.jpg", 96, 64, seed=7)
    refused = tool("import_folder", {"folder": str(other)}, user_texts=["import my photos please"])
    assert refused.is_error and "user" in refused.result.lower()

    typed = str(other).replace("\\", "/").upper()
    out = tool("import_folder", {"folder": str(other) + "\\"}, user_texts=[f"please import {typed} now"])
    body = ok(out)
    assert out.job_ids == [body["job_id"]]
    assert wait_job(project_id, body["job_id"])["state"] == "succeeded"


def test_review_mark_empty_and_box_tools(tool, client, project_id, project, image_ids):
    created = ok(
        tool(
            "create_box",
            {"image_id": image_ids[2], "class_name": "crane", "x": 2, "y": 3, "w": 20, "h": 10},
        )
    )
    assert created["class"] == "crane"
    moved = ok(tool("update_box", {"box_id": created["id"], "x": 5, "class_name": "roller"}))
    assert (moved["x"], moved["class"]) == (5, "roller")
    assert tool(
        "create_box", {"image_id": image_ids[2], "class_name": "ufo", "x": 0, "y": 0, "w": 1, "h": 1}
    ).is_error

    marked = ok(tool("mark_images_empty", {"selection": {"image_ids": image_ids[3:6]}, "empty": True}))
    assert marked == {"images": 3, "updated": 3, "skipped": 0}
    assert ok(tool("review_boxes", {"box_ids": [created["id"]], "action": "reject"}))["updated"] == 0


def test_accept_and_undo_suggestions_errors_name_the_run(tool, image_ids):
    out = tool("accept_suggestions", {"query_run_id": "ghost", "min_confidence": 0.5})
    assert out.is_error and "not found" in out.result
    assert tool("undo_accept_suggestions", {"query_run_id": "ghost"}).is_error


def test_update_project_open_screen_cancel_and_wait(tool, client, project_id, image_ids):
    ok(tool("update_project", {"name": "Renamed"}))
    assert client.get(f"/api/v1/projects/{project_id}").json()["name"] == "Renamed"

    nav = tool("open_screen", {"screen": "editor", "image_id": image_ids[0]})
    assert nav.navigate == {"screen": "editor", "image_id": image_ids[0]}
    assert tool("open_screen", {"screen": "editor"}).is_error
    assert tool("open_screen", {"screen": "review"}).navigate == {"screen": "review", "image_id": None}

    job_id = ok(tool("list_jobs"))["jobs"][0]["id"]
    started = time.monotonic()
    waited = ok(tool("wait_for_job", {"job_id": job_id, "seconds": 5}))
    assert waited["state"] == "succeeded"
    assert time.monotonic() - started < 3
    assert ok(tool("cancel_job", {"job_id": job_id}))["state"] == "succeeded"


# ------------------------------------------------------------- approval tools


def test_approval_tools_return_prepared_and_change_nothing(tool, client, project_id, image_ids, model_id):
    prepared = tool("delete_images", {"selection": {"limit": 2}})
    assert isinstance(prepared, Prepared)
    assert prepared.title == "Delete 2 images"
    assert "originals on disk are not touched" in prepared.detail
    assert prepared.args == {"image_ids": image_ids[:2]}
    assert prepared.estimated_cost is None

    boxes = tool("delete_boxes", {"box_ids": ["a", "b"]})
    assert isinstance(boxes, Prepared) and boxes.title == "Delete 2 boxes"

    model = tool("delete_model", {"model_id": model_id})
    assert isinstance(model, Prepared) and "coco-n" in model.title
    assert tool("delete_model", {"model_id": "ghost"}).is_error
    assert tool("delete_dataset", {"dataset_id": "ghost"}).is_error
    assert tool("train_model", {"name": "v2", "dataset_id": "ghost", "base_model_id": model_id}).is_error

    assert client.get(f"/api/v1/projects/{project_id}/images").json()["total"] == N_IMAGES


def test_execute_approved_deletes_the_prepared_images(tool, agent, client, project_id, image_ids):
    prepared = tool("delete_images", {"selection": {"image_ids": image_ids[:3]}})
    out = agent(lambda ctx: execute_approved(ctx, "delete_images", prepared.args))
    assert ok(out) == {"deleted": 3}
    assert "3" in out.summary
    assert client.get(f"/api/v1/projects/{project_id}/images").json()["total"] == N_IMAGES - 3


def test_dataset_training_and_deletion_flow(
    tool, agent, client, project_id, project, image_ids, model_id, wait_job
):
    cls = project["classes"][0]["id"]
    for image_id in image_ids[:4]:
        client.post(
            f"/api/v1/projects/{project_id}/images/{image_id}/boxes",
            json={"class_id": cls, "x": 1, "y": 1, "w": 10, "h": 10},
        )
    created = tool("create_dataset", {"name": "v1", "split_method": "random"})
    body = ok(created)
    assert created.job_ids == [body["job_id"]]
    wait_job(project_id, body["job_id"])
    ds = ok(tool("get_dataset", {"dataset_id": body["dataset_id"]}))
    assert ds["name"] == "v1" and ds["image_count"] == 4
    assert ok(tool("list_datasets"))["datasets"][0]["id"] == body["dataset_id"]

    train = tool(
        "train_model", {"name": "yolo-v2", "dataset_id": body["dataset_id"], "base_model_id": model_id}
    )
    assert isinstance(train, Prepared)
    assert train.title == "Train yolo-v2 for 50 epochs"
    assert train.detail == "Dataset v1 · base coco-n · imgsz 1280"

    delete = tool("delete_dataset", {"dataset_id": body["dataset_id"]})
    assert isinstance(delete, Prepared) and "v1" in delete.title
    ok(agent(lambda ctx: execute_approved(ctx, "delete_dataset", delete.args)))
    assert ok(tool("list_datasets")) == {"datasets": []}


@pytest.mark.parametrize(
    ("folder", "texts", "allowed"),
    [
        (r"E:\Data\Site A", [r"import E:\Data\Site A please"], True),
        (r"e:/data/site a/", [r'import "E:\Data\Site A\"'], True),
        (r"E:\Data\Site A", [r"import E:\Data\Site A."], True),
        (r"E:\Data", [r"import E:\Data\Site A"], False),  # a parent of what was typed
        ("E:\\", [r"import E:\Data\Site A"], False),  # the drive
        (r"Data\Site A", [r"import Data\Site A"], False),  # not absolute
        (r"E:\Data\Site", [r"import E:\Data\Sites"], False),
        (r"E:\Other", ["import my photos"], False),
    ],
)
def test_a_folder_counts_as_typed_only_as_a_whole_absolute_path(folder, texts, allowed):
    assert tools._typed_by_user(folder, texts) is allowed


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("mark_images_empty", {"empty": True}),
        ("label_images", {"labeler": {"kind": "local_model", "model_id": "MODEL"}}),
        ("delete_images", {}),
    ],
)
def test_mutating_tools_require_an_explicit_selection(
    tool, client, project_id, image_ids, model_id, name, args
):
    if "labeler" in args:
        args = {"labeler": {**args["labeler"], "model_id": model_id}}
    out = tool(name, args)
    assert isinstance(out, ToolOutcome) and out.is_error
    assert "selection" in out.result
    page = client.get(f"/api/v1/projects/{project_id}/images", params={"limit": 100}).json()
    assert page["total"] == N_IMAGES
    assert not any(i["marked_empty"] for i in page["items"])
    assert client.get(f"/api/v1/projects/{project_id}/query-runs").json()["items"] == []


def test_read_tools_keep_the_default_selection(tool, image_ids):
    assert ok(tool("find_images", {}))["selected"] == N_IMAGES
    est = tool(
        "estimate_labeling", {"labeler": {"kind": "cloud_provider", "provider": "anthropic", "query": "x"}}
    )
    assert ok(est)["images"] == N_IMAGES
    schemas = {s.name: s.input_schema for s in tool_specs()}
    for name in ("mark_images_empty", "label_images", "delete_images"):
        assert "selection" in schemas[name]["required"], name


# ------------------------------------------------------------ final review fixes


@pytest.mark.parametrize("bad", ["", ".", "..", "a/b", "a\\b", "../projects"])
def test_seg_refuses_dot_segments_and_separators(bad):
    with pytest.raises(tools.ToolError):
        tools._seg(bad)


def test_seg_keeps_a_uuid():
    assert tools._seg("10000000-5555-4000-8000-000000000001") == "10000000-5555-4000-8000-000000000001"


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("delete_boxes", {"box_ids": [".."]}),
        ("update_box", {"box_id": "..", "x": 1}),
        ("get_image", {"image_id": ".."}),
        ("get_job", {"job_id": ".."}),
        ("delete_dataset", {"dataset_id": ".."}),
        ("view_image", {"image_id": "a/b"}),
        ("find_images", {"selection": {"image_ids": ["a,b"]}}),
        ("label_images", {"selection": {}, "labeler": {"kind": "local_model", "model_id": ".."}}),
    ],
)
def test_a_dot_segment_id_is_rejected_before_any_request(tool, client, project_id, name, args):
    out = tool(name, args)
    assert isinstance(out, ToolOutcome) and out.is_error
    assert "Invalid arguments" in out.result
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_an_approved_delete_boxes_with_a_dot_segment_never_reaches_the_project(agent, client, project_id):
    out = agent(lambda ctx: execute_approved(ctx, "delete_boxes", {"box_ids": ["..", ".", "x/y"]}))
    assert out.is_error
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200


def test_find_images_reports_the_true_total_beyond_the_limit(tool, image_ids):
    body = ok(tool("find_images", {"selection": {"limit": 3}}))
    assert body["total"] == N_IMAGES
    assert body["selected"] == 3
    assert body["returned"] == 3
    assert [r["id"] for r in body["images"]] == image_ids[:3]
    body = ok(tool("find_images", {"selection": {"image_ids": image_ids[:2] + ["ghost"]}}))
    assert body["total"] == 2 and body["selected"] == 2
    assert "total" in REGISTRY["find_images"].description


def test_update_classes_summary_keeps_the_case_of_class_names(tool):
    out = tool("update_classes", {"add": ["Crawler_Crane"]})
    assert out.summary == "Added Crawler_Crane"
    out = tool("update_classes", {"rename": [{"from": "Crawler_Crane", "to": "CC"}]})
    assert out.summary == "Renamed Crawler_Crane to CC"


def test_execute_approved_turns_a_non_outcome_into_an_error(agent, monkeypatch):
    class Odd(Tool):
        name = "odd"
        description = "returns a Prepared from run, which execute_approved must not pass on"
        Args = tools.NoArgs
        risk = "approval"
        label = "Odd"

        async def run(self, ctx, args):
            return Prepared(title="t", detail="d", estimated_cost=None, args={})

    monkeypatch.setitem(REGISTRY, "odd", Odd())
    out = agent(lambda ctx: execute_approved(ctx, "odd", {}))
    assert isinstance(out, ToolOutcome) and out.is_error


def test_the_labeler_union_is_any_of_not_one_of():
    specs = {s.name: s for s in tool_specs()}
    for name in ("label_images", "estimate_labeling"):
        text = json.dumps(specs[name].input_schema)
        assert "oneOf" not in text
        assert "anyOf" in json.dumps(specs[name].input_schema["properties"]["labeler"])


def test_get_project_lists_the_cloud_providers_with_a_key(tool, app, image_ids):
    app.state.keys.set("anthropic", "sk-fake-key")
    out = tool("get_project")
    body = ok(out)
    assert body["cloud_providers"] == [
        {"name": "openai", "has_key": False},
        {"name": "anthropic", "has_key": True},
    ]
    assert "sk-fake-key" not in out.result
    assert "provider" in REGISTRY["get_project"].description
