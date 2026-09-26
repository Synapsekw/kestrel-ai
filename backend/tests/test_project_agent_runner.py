"""Project agent: the turn runner, its five endpoints, the system prompt and the startup sweep (Task 5).

The model is a scripted fake (`app.state.agent_llm`); tools are the real ones, running in-process
against the real routes on the TestClient's event loop. No test calls a paid provider: the cloud
labeling job runs with an empty fake provider.
"""

import asyncio
import copy
import time

import pytest

from app.project_agent import store, tools
from app.project_agent.history import LlmError, ModelReply, ToolCall
from app.project_agent.prompt import system_prompt
from app.project_agent.runner import AgentRunner
from app.project_agent.tools import NoArgs, Tool, ToolOutcome
from app.providers.base import TileResult

BASE = "/api/v1/projects"
SECRET_KEY = "sk-ant-test-SECRET-4f9a7c"
N_IMAGES = 6
STOP_TEXT = "I stopped after 25 actions in one turn. Send another message to continue."
TIMEOUT_TEXT = "This turn ran for 15 minutes and was stopped. Background jobs keep running."


class FakeLlm:
    """Replays a script. A step is a ModelReply, an exception to raise, or an async callable."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    async def __call__(self, provider, *, api_key, model, system, history, tools):
        self.calls.append(
            {
                "provider": provider,
                "api_key": api_key,
                "model": model,
                "system": system,
                "history": copy.deepcopy(history),
                "tools": tools,
            }
        )
        if not self.script:
            raise AssertionError("the fake model ran out of script")
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        if callable(step):
            return await step()
        return step


def answer(text: str) -> ModelReply:
    return ModelReply(text=text, tool_calls=[])


def calls(*pairs, text: str = "") -> ModelReply:
    return ModelReply(
        text=text,
        tool_calls=[ToolCall(f"call_{i}", name, args) for i, (name, args) in enumerate(pairs)],
        provider_payload={"raw": "blocks"},
    )


async def forever():
    await asyncio.Event().wait()
    raise AssertionError("unreachable")


class EmptyProvider:
    name = "fake"

    def detect_tile(self, image, tile, query, classes, *, conf, log, raw_ref=""):
        return TileResult(tile=tile, detections=[], raw={})


@pytest.fixture
def key(app):
    app.state.keys.set("anthropic", SECRET_KEY)
    return SECRET_KEY


@pytest.fixture
def llm(app):
    def _install(*script) -> FakeLlm:
        fake = FakeLlm(script)
        app.state.agent_llm = fake
        return fake

    return _install


@pytest.fixture
def events(client, app, monkeypatch):
    seen: list[dict] = []
    original = app.state.events.publish

    def record(event):
        seen.append(event)
        original(event)

    monkeypatch.setattr(app.state.events, "publish", record)
    return seen


@pytest.fixture
def start(client, project_id):
    def _start(message: str = "hello", provider: str = "anthropic"):
        return client.post(
            f"{BASE}/{project_id}/agent/turns", json={"provider": provider, "message": message}
        )

    return _start


@pytest.fixture
def conv(client, project_id):
    def _conv() -> dict:
        r = client.get(f"{BASE}/{project_id}/agent")
        assert r.status_code == 200, r.text
        return r.json()

    return _conv


@pytest.fixture
def settle(conv):
    """Poll the conversation until the newest turn is no longer `running`."""

    def _settle(timeout: float = 10.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            body = conv()
            if body["turn"] and body["turn"]["state"] != "running":
                return body
            time.sleep(0.02)
        raise AssertionError(f"the turn never left running: {conv()}")

    return _settle


@pytest.fixture
def wait_until(conv):
    def _wait(pred, timeout: float = 10.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            body = conv()
            if pred(body):
                return body
            time.sleep(0.02)
        raise AssertionError(f"condition never met: {conv()}")

    return _wait


@pytest.fixture
def image_ids(client, project_id, tmp_path, make_jpeg, import_source) -> list[str]:
    src = tmp_path / "flight"
    # Created in reverse so the path order differs from the creation order.
    for i in reversed(range(N_IMAGES)):
        make_jpeg(src / f"img{i:02d}.jpg", 96, 64, seed=200 + i)
    import_source(project_id, src)
    page = client.get(f"{BASE}/{project_id}/images", params={"limit": 100, "sort": "path"}).json()
    assert len(page["items"]) == N_IMAGES
    return [i["id"] for i in page["items"]]


def kinds(body: dict) -> list[str]:
    return [i["kind"] for i in body["items"]]


# ------------------------------------------------------------------- prompt


def test_the_system_prompt_names_the_project_classes_and_the_rules():
    text = system_prompt("Site 7", ["excavator", "dump_truck"])
    assert "Site 7" in text
    assert "excavator" in text and "dump_truck" in text
    for phrase in ("update_classes", "accept_suggestions", "wait_for_job", "sort", "path", "data"):
        assert phrase in text, phrase
    assert "Kestrel AI" in text


def test_the_system_prompt_says_how_to_pick_a_labeler():
    text = system_prompt("Site 7", ["excavator"])
    assert "Prefer a registered local model whose classes match" in text
    assert "cloud provider that has a key" in text and "get_project" in text


def test_the_system_prompt_handles_a_project_without_classes():
    assert "no classes" in system_prompt("Empty", []).lower()


# ------------------------------------------------------------------- turns


def test_a_plain_answer_succeeds_with_a_user_and_an_assistant_item(
    start, settle, llm, key, project, app, events
):
    fake = llm(answer("Hi, I can help with this project."))
    r = start("hello")
    assert r.status_code == 202, r.text
    assert r.json()["state"] == "running"
    assert r.json()["model_name"] == app.state.provider_config.get("anthropic").model_name

    body = settle()
    assert body["turn"]["state"] == "succeeded"
    assert body["turn"]["finished_at"] is not None
    assert kinds(body) == ["user", "assistant"]
    assert body["items"][1]["text"] == "Hi, I can help with this project."

    (call,) = fake.calls
    assert call["provider"] == "anthropic"
    assert call["api_key"] == key
    assert call["model"] == "claude-opus-5"
    assert project["name"] in call["system"] and "excavator" in call["system"]
    assert {t.name for t in call["tools"]} >= {"get_project", "label_images"}
    assert [(e.role, e.text) for e in call["history"]] == [("user", "hello")]

    changed = [e for e in events if e["type"] == "agent.changed"]
    assert changed, events
    assert all(e["project_id"] == project["id"] for e in changed)
    assert changed[-1]["payload"] == {"turn_id": body["turn"]["id"], "state": "succeeded"}
    assert changed[0]["job_id"] is None and changed[0]["progress"] is None


def test_a_tool_call_runs_and_its_result_goes_back_to_the_model(start, settle, llm, key, project):
    fake = llm(calls(("get_project", {})), answer("The project has 8 classes."))
    start("what is in this project?")
    body = settle()
    assert body["turn"]["state"] == "succeeded"
    assert body["turn"]["tool_calls"] == 1
    assert kinds(body) == ["user", "assistant", "tool", "assistant"]
    tool_item = body["items"][2]
    assert tool_item["tool_name"] == "get_project"
    assert tool_item["tool_status"] == "ok"
    assert tool_item["tool_summary"]
    assert "tool_result" not in tool_item and "provider_payload" not in tool_item

    second = fake.calls[1]["history"]
    assert [e.role for e in second] == ["user", "assistant", "tool_results"]
    (result,) = second[-1].results
    assert result.call_id == "call_0" and not result.is_error
    assert project["name"] in result.content


def test_a_tool_error_goes_back_to_the_model_without_failing_the_turn(start, settle, llm, key):
    fake = llm(calls(("get_image", {"image_id": "ghost"})), answer("That image does not exist."))
    start("show me image ghost")
    body = settle()
    assert body["turn"]["state"] == "succeeded"
    assert body["items"][2]["tool_status"] == "error"
    assert fake.calls[1]["history"][-1].results[0].is_error


def test_a_viewed_image_is_rendered_for_the_next_model_call(start, settle, llm, key, image_ids):
    fake = llm(calls(("view_image", {"image_id": image_ids[0]})), answer("An empty site."))
    start("look at the first image")
    assert settle()["turn"]["state"] == "succeeded"
    (result,) = fake.calls[1]["history"][-1].results
    assert result.image_jpeg_b64


def test_label_the_first_images_with_new_classes_after_approval(
    client, start, settle, llm, key, project_id, image_ids, monkeypatch, handle, app, wait_job
):
    """The headline: add a class, prepare a cloud labeling run, approve it, and the run covers
    exactly the first N images by path."""
    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: EmptyProvider())
    n = 3
    selection = {"sort": "path", "order": "asc", "offset": 0, "limit": n}
    labeler = {"kind": "cloud_provider", "provider": "anthropic", "query": "every excavator and pile driver"}
    fake = llm(
        calls(("update_classes", {"add": ["pile_driver"]})),
        calls(("label_images", {"selection": selection, "labeler": labeler})),
        answer("Labeling 3 images with excavator and pile_driver has started."),
    )
    start(f"Label the first {n} images with excavator and pile driver")
    body = settle()
    turn = body["turn"]
    assert turn["state"] == "awaiting_approval", body
    assert turn["finished_at"] is None
    card = body["items"][-1]
    assert card["tool_name"] == "label_images"
    assert card["tool_status"] == "awaiting_approval"
    assert card["tool_input"] == {"selection": selection, "labeler": labeler}
    assert card["approval"]["title"].startswith("Label 3 images")
    assert card["approval"]["estimated_cost"] > 0
    classes = [c["name"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]]
    assert "pile_driver" in classes
    assert client.get(f"{BASE}/{project_id}/query-runs").json()["items"] == []  # nothing ran yet
    # The approval survives: the prepared args live on the item, not in memory.
    assert store.pending_approval_item(handle, turn["id"])["provider_payload"]["prepared_args"]

    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn['id']}/approval", json={"approve": True})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "running"

    body = settle()
    assert body["turn"]["state"] == "succeeded", body
    assert body["turn"]["tool_calls"] == 2
    label_item = next(i for i in body["items"] if i["tool_name"] == "label_images")
    assert label_item["tool_status"] == "ok"
    assert len(label_item["job_ids"]) == 1
    assert body["items"][-1]["text"].startswith("Labeling 3 images")

    runs = client.get(f"{BASE}/{project_id}/query-runs").json()["items"]
    assert len(runs) == 1
    assert runs[0]["image_ids"] == image_ids[:n]
    assert runs[0]["kind"] == "cloud_provider"

    # The model saw the approved result, and no key reached anything it was sent.
    final_history = fake.calls[-1]["history"]
    assert final_history[-1].role == "tool_results"
    assert "query_run_id" in final_history[-1].results[0].content
    for call in fake.calls:
        assert SECRET_KEY not in call["system"]
        for entry in call["history"]:
            assert SECRET_KEY not in repr(entry)

    # The turn ends once the labeling job has started; let the job finish (and close its DB
    # connections) before reading the project files, or Windows refuses to read the locked -shm.
    assert wait_job(project_id, label_item["job_ids"][0])["state"] == "succeeded"
    # No key anywhere in the project folder (DB, WAL, labels, caches).
    for path in handle.folder.rglob("*"):
        if path.is_file():
            assert SECRET_KEY.encode() not in path.read_bytes(), path


def test_denying_an_approval_tells_the_model_and_runs_nothing(
    client, start, settle, llm, key, project_id, image_ids
):
    labeler = {"kind": "cloud_provider", "provider": "anthropic", "query": "excavators"}
    fake = llm(
        calls(
            ("label_images", {"selection": {"limit": 2}, "labeler": labeler}),
            ("get_project", {}),
        ),
        answer("Understood, nothing was labeled."),
    )
    start("label two images")
    body = settle()
    assert body["turn"]["state"] == "awaiting_approval"
    card, skipped = body["items"][-2:]
    assert card["tool_status"] == "awaiting_approval"
    assert skipped["tool_name"] == "get_project" and skipped["tool_status"] == "denied"

    turn_id = body["turn"]["id"]
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": False})
    assert r.status_code == 200 and r.json()["state"] == "running"
    body = settle()
    assert body["turn"]["state"] == "succeeded"
    card = next(i for i in body["items"] if i["tool_name"] == "label_images")
    assert card["tool_status"] == "denied" and card["tool_summary"] == "Declined"
    results = {r.name: r for r in fake.calls[1]["history"][-1].results}
    assert results["label_images"].content == "The user declined this action."
    assert results["label_images"].is_error
    assert results["get_project"].content.startswith("Not run: waiting for approval")
    assert client.get(f"{BASE}/{project_id}/query-runs").json()["items"] == []


def test_an_approval_decision_needs_a_turn_that_is_waiting(client, start, settle, llm, key, project_id):
    llm(answer("done"))
    start()
    turn_id = settle()["turn"]["id"]
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": True})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "conflict"


def test_unknown_turns_are_404_in_the_error_envelope(client, project_id):
    for path, body in (("cancel", None), ("approval", {"approve": True})):
        r = client.post(f"{BASE}/{project_id}/agent/turns/ghost/{path}", json=body)
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "not_found"


def test_a_fresh_project_has_an_empty_conversation(conv):
    assert conv() == {"items": [], "turn": None}


# ---------------------------------------------------------------- stopping


def test_cancel_while_the_model_is_thinking(client, start, llm, key, project_id, wait_until, conv):
    fake = llm(forever)
    turn_id = start().json()["id"]
    wait_until(lambda b: len(fake.calls) == 1)
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/cancel")
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "cancelled"
    assert r.json()["finished_at"] is not None
    assert conv()["turn"]["state"] == "cancelled"
    # A finished turn is returned unchanged.
    again = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/cancel")
    assert again.status_code == 200 and again.json() == r.json()
    # And the project is free for the next turn.
    llm(answer("ok"))
    assert (
        client.post(
            f"{BASE}/{project_id}/agent/turns", json={"provider": "anthropic", "message": "again"}
        ).status_code
        == 202
    )


class BlockingTool(Tool):
    name = "get_project"
    label = "Read the project"
    risk = "read"
    Args = NoArgs
    description = "blocks"

    async def run(self, ctx, args):
        await asyncio.Event().wait()
        return ToolOutcome(result="never", summary="never")


def test_cancel_during_a_tool_call_closes_every_call_of_the_reply(
    client, start, llm, key, project_id, wait_until, settle, monkeypatch
):
    monkeypatch.setitem(tools.REGISTRY, "get_project", BlockingTool())
    llm(calls(("get_project", {}), ("list_sources", {})))
    turn_id = start().json()["id"]
    wait_until(lambda b: any(i["tool_status"] == "running" for i in b["items"]))
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/cancel")
    assert r.json()["state"] == "cancelled"
    body = wait_until(lambda b: len([i for i in b["items"] if i["kind"] == "tool"]) == 2)
    blocked, unstarted = [i for i in body["items"] if i["kind"] == "tool"]
    assert blocked["tool_status"] == "error" and blocked["tool_summary"] == "Stopped"
    assert unstarted["tool_name"] == "list_sources" and unstarted["tool_status"] == "error"

    # The next turn replays both calls with a result, so the provider sees a complete history.
    fake = llm(answer("ok"))
    start("next")
    settle()
    results = fake.calls[0]["history"][2].results
    assert [r.call_id for r in results] == ["call_0", "call_1"]
    assert results[0].content == "Stopped by the user."


def test_a_turn_stops_after_25_tool_calls(start, settle, llm, key):
    llm(calls(*[("get_project", {})] * 26))
    start("read the project a lot")
    body = settle(timeout=30)
    assert body["turn"]["state"] == "failed"
    assert body["turn"]["error"] == STOP_TEXT
    assert body["turn"]["tool_calls"] == 25
    tool_items = [i for i in body["items"] if i["kind"] == "tool"]
    assert [i["tool_status"] for i in tool_items] == ["ok"] * 25 + ["denied"]
    assert body["items"][-1]["kind"] == "assistant" and body["items"][-1]["text"] == STOP_TEXT


def test_a_provider_error_fails_the_turn_with_its_message(start, settle, llm, key):
    llm(LlmError("The provider is rate limiting requests. Wait a minute and try again."))
    start()
    body = settle()
    assert body["turn"]["state"] == "failed"
    assert body["turn"]["error"] == "The provider is rate limiting requests. Wait a minute and try again."
    assert body["turn"]["finished_at"] is not None


def test_an_unexpected_error_fails_the_turn_with_a_fixed_message(start, settle, llm, key):
    llm(RuntimeError(f"boom {SECRET_KEY}"))
    start()
    body = settle()
    assert body["turn"]["state"] == "failed"
    assert body["turn"]["error"] == "Something went wrong in the agent. Try again."


def test_a_turn_over_its_wall_time_fails(start, settle, llm, key, monkeypatch):
    monkeypatch.setattr(AgentRunner, "MAX_TURN_SECONDS", 0.5)
    llm(forever)
    start()
    body = settle()
    assert body["turn"]["state"] == "failed"
    assert body["turn"]["error"] == TIMEOUT_TEXT


# ------------------------------------------------------------------ guards


def test_a_second_turn_while_one_is_active_is_busy(client, start, llm, key, project_id, wait_until):
    fake = llm(forever)
    turn_id = start().json()["id"]
    wait_until(lambda b: len(fake.calls) == 1)
    r = start("another")
    assert r.status_code == 409
    assert r.json()["error"] == {
        "code": "agent_busy",
        "message": "The agent is already working in this project.",
        "details": {},
    }
    client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/cancel")


def test_a_turn_without_a_key_is_refused(start, llm, conv):
    llm(answer("never"))
    r = start(provider="openai")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "provider_key_missing"
    assert r.json()["error"]["message"] == "Add this provider's API key in App settings."
    assert conv() == {"items": [], "turn": None}


def test_clearing_is_refused_while_a_turn_is_active_then_works(
    client, start, llm, key, project_id, wait_until, conv
):
    fake = llm(forever)
    turn_id = start().json()["id"]
    wait_until(lambda b: len(fake.calls) == 1)
    r = client.delete(f"{BASE}/{project_id}/agent")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/cancel")
    r = client.delete(f"{BASE}/{project_id}/agent")
    assert r.status_code == 204
    assert conv() == {"items": [], "turn": None}


def test_a_bad_message_is_a_422(start, key):
    r = start("")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


# ------------------------------------------------------------------- sweep


def _reopen(handle, tmp_path):
    from app.main import project_opened
    from app.projects.service import ProjectRegistry

    class _NoLiveJobs:
        def is_live(self, job_id):
            return False

    registry = ProjectRegistry(tmp_path / "appdata2", on_open=lambda h: project_opened(h, _NoLiveJobs()))
    return registry.open(handle.folder, remember=False)


def test_reopening_a_project_fails_a_turn_left_running(handle, tmp_path):
    running = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, running.id, "user", text="hi")
    store.add_item(
        handle, running.id, "tool", tool_name="get_project", tool_call_id="c", tool_status="running"
    )
    store.update_turn(handle, running.id, state="failed")  # keep one active turn at a time
    waiting = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.update_turn(handle, waiting.id, state="awaiting_approval")
    store.update_turn(handle, running.id, state="running")

    _reopen(handle, tmp_path)

    assert store.get_turn(handle, running.id).state == "failed"
    assert store.get_turn(handle, running.id).error == "Interrupted when the app closed."
    assert store.get_turn(handle, waiting.id).state == "awaiting_approval"


def test_a_failing_sweep_logs_and_the_project_still_opens(handle, tmp_path, monkeypatch, caplog):
    def boom(h):
        raise RuntimeError("sweep broke")

    monkeypatch.setattr(store, "sweep_interrupted", boom)
    reopened = _reopen(handle, tmp_path)
    assert reopened.id == handle.id
    assert any("agent turn sweep failed" in r.getMessage() for r in caplog.records)


# ------------------------------------------------------------- fix round 1


def _awaiting_turn(start, settle, llm, image_ids, *after):
    labeler = {"kind": "cloud_provider", "provider": "anthropic", "query": "excavators"}
    llm(calls(("label_images", {"selection": {"limit": 2}, "labeler": labeler})), *after)
    start("label two images")
    body = settle()
    assert body["turn"]["state"] == "awaiting_approval"
    return body["turn"]["id"]


def test_the_wall_time_counts_from_the_restart_after_an_approval(
    client, start, settle, llm, key, project_id, image_ids, handle, monkeypatch
):
    from datetime import UTC, datetime, timedelta

    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: EmptyProvider())
    turn_id = _awaiting_turn(start, settle, llm, image_ids, answer("Started."))
    store.update_turn(handle, turn_id, created_at=datetime.now(UTC) - timedelta(seconds=2000))
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": True})
    assert r.status_code == 200
    body = settle()
    assert body["turn"]["state"] == "succeeded", body["turn"]


def test_a_timed_out_turn_ends_with_an_item_that_says_why(start, settle, llm, key, monkeypatch):
    monkeypatch.setattr(AgentRunner, "MAX_TURN_SECONDS", 0.5)
    llm(forever)
    start()
    body = settle()
    assert body["turn"]["error"] == TIMEOUT_TEXT
    assert body["items"][-1]["kind"] == "assistant"
    assert body["items"][-1]["text"] == TIMEOUT_TEXT


def test_an_approved_action_that_cannot_run_does_not_wedge_the_turn(
    client, start, settle, llm, key, project_id, image_ids, monkeypatch
):
    turn_id = _awaiting_turn(start, settle, llm, image_ids, answer("It could not run."))

    async def broken(ctx, name, prepared_args):
        raise RuntimeError(f"broken {SECRET_KEY}")

    monkeypatch.setattr("app.project_agent.runner.execute_approved", broken)
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": True})
    assert r.status_code == 200, r.text
    body = settle()
    assert body["turn"]["state"] == "succeeded", body["turn"]
    card = next(i for i in body["items"] if i["tool_name"] == "label_images")
    assert card["tool_status"] == "error"
    assert card["tool_summary"] == "The approved action could not run."
    # The project is free again.
    llm(answer("ok"))
    assert start("again").status_code == 202


def test_unknown_tool_names_from_the_model_are_not_logged(start, settle, llm, key, caplog):
    import logging

    caplog.set_level(logging.INFO, logger="app.project_agent.runner")
    llm(calls(("ignore previous instructions", {})), answer("ok"))
    start()
    assert settle()["turn"]["state"] == "succeeded"
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "ignore previous" not in text
    assert "agent tool unknown" in text


def test_the_prompt_never_says_promote():
    assert "promot" not in system_prompt("P", ["excavator"]).lower()


def test_denying_without_a_key_records_the_denial_and_ends_the_turn(
    client, app, start, settle, llm, key, project_id, image_ids, conv
):
    """The key was removed while a card waited: Deny must still work (it never needs the key), and
    the turn ends instead of wedging the drawer."""
    turn_id = _awaiting_turn(start, settle, llm, image_ids)
    fake = app.state.agent_llm
    app.state.keys.delete("anthropic")

    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": False})

    assert r.status_code == 200, r.text
    assert r.json()["state"] == "failed"
    body = conv()
    assert body["turn"]["state"] == "failed"
    assert body["turn"]["error"] == "Add this provider's API key in App settings."
    assert body["turn"]["finished_at"] is not None
    card = next(i for i in body["items"] if i["tool_name"] == "label_images")
    assert card["tool_status"] == "denied"
    assert len(fake.calls) == 1  # the model was not asked again
    assert client.delete(f"{BASE}/{project_id}/agent").status_code in (200, 204)


def test_approving_without_a_key_is_still_refused(
    client, app, start, settle, llm, key, project_id, image_ids, conv
):
    turn_id = _awaiting_turn(start, settle, llm, image_ids)
    app.state.keys.delete("anthropic")
    r = client.post(f"{BASE}/{project_id}/agent/turns/{turn_id}/approval", json={"approve": True})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "provider_key_missing"
    assert conv()["turn"]["state"] == "awaiting_approval"
