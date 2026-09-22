import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.base import utcnow
from app.db.session import MIGRATIONS, open_project_db
from app.errors import AppError
from app.project_agent import store
from app.project_agent.schemas import AgentItemOut, AgentTurnOut

# -------------------------------------------------------------------------------- migration 0004


def test_migration_creates_agent_tables(project_dir):
    engine = open_project_db(project_dir)
    names = set(inspect(engine).get_table_names())
    assert {"agent_turn", "agent_item"} <= names


def test_migration_0004_downgrade_drops_agent_tables(tmp_path):
    db_path = tmp_path / "project.db"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0003")

    conn = sqlite3.connect(db_path)
    try:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    assert "agent_turn" not in names
    assert "agent_item" not in names


# -------------------------------------------------------------------------------------- turns


def test_create_turn_defaults(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    assert turn.state == "running"
    assert turn.provider == "anthropic"
    assert turn.model_name == "claude-opus-5"
    assert turn.error is None
    assert turn.tool_calls == 0
    assert turn.finished_at is None
    assert turn.created_at is not None


def test_get_turn_missing_raises_not_found(handle):
    with pytest.raises(AppError) as exc:
        store.get_turn(handle, "does-not-exist")
    assert exc.value.status == 404


def test_active_turn(handle):
    assert store.active_turn(handle) is None
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    active = store.active_turn(handle)
    assert active is not None and active.id == turn.id

    store.update_turn(handle, turn.id, state="succeeded", finished_at=utcnow())
    assert store.active_turn(handle) is None


def test_update_turn(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    updated = store.update_turn(
        handle, turn.id, state="failed", error="The provider could not complete this step."
    )
    assert updated.state == "failed"
    assert updated.error == "The provider could not complete this step."


# -------------------------------------------------------------------------------------- items


def test_add_item_seq_monotonic(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    a = store.add_item(handle, turn.id, "user", text="hi")
    b = store.add_item(handle, turn.id, "assistant", text="hello")
    c = store.add_item(handle, turn.id, "tool", tool_name="get_project", tool_call_id="tc1")
    assert [a.seq, b.seq, c.seq] == [1, 2, 3]


def test_add_item_seq_monotonic_across_turns(handle):
    t1 = store.create_turn(handle, "anthropic", "claude-opus-5")
    i1 = store.add_item(handle, t1.id, "user", text="a")
    t2 = store.create_turn(handle, "anthropic", "claude-opus-5")
    i2 = store.add_item(handle, t2.id, "user", text="b")
    assert i2.seq == i1.seq + 1


def test_update_item(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    item = store.add_item(
        handle, turn.id, "tool", tool_name="label_images", tool_call_id="tc1", tool_status="running"
    )
    updated = store.update_item(handle, item.id, tool_status="ok", tool_summary="Started labeling 500 images")
    assert updated.tool_status == "ok"
    assert updated.tool_summary == "Started labeling 500 images"


def test_update_item_missing_raises_not_found(handle):
    with pytest.raises(AppError) as exc:
        store.update_item(handle, "does-not-exist", tool_status="ok")
    assert exc.value.status == 404


def test_get_item_returns_internal_fields(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    item = store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc1",
        tool_status="ok",
        tool_result="secret result text",
        provider_payload={"raw": True},
        result_image_id="img-1",
    )
    row = store.get_item(handle, item.id)
    assert row["tool_result"] == "secret result text"
    assert row["provider_payload"] == {"raw": True}
    assert row["result_image_id"] == "img-1"
    assert row["tool_call_id"] == "tc1"


def test_get_item_missing_raises_not_found(handle):
    with pytest.raises(AppError) as exc:
        store.get_item(handle, "does-not-exist")
    assert exc.value.status == 404


def test_pending_approval_item(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    item = store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="train_model",
        tool_call_id="tc1",
        tool_status="awaiting_approval",
        approval={"title": "Train", "detail": "d", "estimated_cost": None},
    )
    pending = store.pending_approval_item(handle, turn.id)
    assert pending is not None
    assert pending["id"] == item.id
    assert pending["tool_call_id"] == "tc1"

    store.update_item(handle, item.id, tool_status="ok")
    assert store.pending_approval_item(handle, turn.id) is None


def test_user_texts(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="import C:/frames")
    store.add_item(handle, turn.id, "assistant", text="ok")
    assert store.user_texts(handle) == ["import C:/frames"]


def test_last_result_image_ids(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="look")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc1",
        tool_status="ok",
        result_image_id="img-1",
    )
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="get_project",
        tool_call_id="tc2",
        tool_status="ok",
        result_image_id=None,
    )
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc3",
        tool_status="running",
        result_image_id="img-3",
    )
    assert store.last_result_image_ids(handle) == {"tc1": "img-1"}


def test_last_result_image_ids_uses_newest_group_with_results(handle):
    """The newest *assistant* item may be a plain-text reply with no tool items after it (the
    normal end of a turn) — the function must fall back to the newest group that actually has a
    resolved tool item, the same rule `build_history` uses for its `tool_results` entries.
    """
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="look then summarize")
    store.add_item(handle, turn.id, "assistant", text="looking")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc1",
        tool_status="ok",
        result_image_id="img-1",
    )
    store.add_item(handle, turn.id, "assistant", text="Done, it shows an excavator.")

    assert store.last_result_image_ids(handle) == {"tc1": "img-1"}


# ------------------------------------------------------------------------------- conversation/clear


def test_conversation_limit_oldest_first(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    for i in range(5):
        store.add_item(handle, turn.id, "user", text=f"m{i}")
    convo = store.conversation(handle, limit=3)
    assert [it.text for it in convo.items] == ["m2", "m3", "m4"]
    assert convo.turn is not None
    assert convo.turn.id == turn.id


def test_conversation_empty(handle):
    convo = store.conversation(handle)
    assert convo.items == []
    assert convo.turn is None


def test_clear_conflict_while_active(handle):
    store.create_turn(handle, "anthropic", "claude-opus-5")  # state="running" -> active
    with pytest.raises(AppError) as exc:
        store.clear(handle)
    assert exc.value.status == 409
    assert exc.value.code == "conflict"


def test_clear_wipes_conversation_when_idle(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="hi")
    store.update_turn(handle, turn.id, state="succeeded", finished_at=utcnow())

    store.clear(handle)

    convo = store.conversation(handle)
    assert convo.items == []
    assert convo.turn is None


# --------------------------------------------------------------------------------- sweep_interrupted


def test_sweep_interrupted_fails_running_turn_and_its_running_tools(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    tool_item = store.add_item(
        handle, turn.id, "tool", tool_name="label_images", tool_call_id="tc1", tool_status="running"
    )

    n = store.sweep_interrupted(handle)

    assert n == 1
    swept_turn = store.get_turn(handle, turn.id)
    assert swept_turn.state == "failed"
    assert swept_turn.error == "Interrupted when the app closed."
    swept_item = store.get_item(handle, tool_item.id)
    assert swept_item["tool_status"] == "error"


def test_sweep_interrupted_drops_raw_payloads_and_finishes_the_turn(handle):
    """A hard kill (the shell kills the sidecar) leaves an assistant whose raw payload names three
    calls with only one stored tool item. Replaying that payload is a provider 400 forever after, so
    the sweep drops the swept turn's raw payloads and stamps `finished_at`."""
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="go")
    assistant = store.add_item(
        handle,
        turn.id,
        "assistant",
        text="",
        provider="anthropic",
        provider_payload=[{"type": "tool_use", "id": f"tc{i}"} for i in (1, 2, 3)],
    )
    store.add_item(handle, turn.id, "tool", tool_name="get_job", tool_call_id="tc1", tool_status="running")

    store.sweep_interrupted(handle)

    assert store.get_item(handle, assistant.id)["provider_payload"] is None
    assert store.get_turn(handle, turn.id).finished_at is not None
    history = store.build_history(handle)
    entry = next(e for e in history if e.role == "assistant")
    assert entry.provider_payload is None
    assert [c.id for c in entry.tool_calls] == ["tc1"]


def test_build_history_drops_payload_naming_more_calls_than_stored(handle):
    """Robust on its own: a payload naming three calls with one resulted tool item is not replayed."""
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.update_turn(handle, turn.id, state="failed")
    store.add_item(handle, turn.id, "user", text="go")
    store.add_item(
        handle,
        turn.id,
        "assistant",
        text="",
        provider="anthropic",
        provider_payload=[{"type": "tool_use", "id": f"tc{i}"} for i in (1, 2, 3)],
    )
    store.add_item(
        handle, turn.id, "tool", tool_name="get_job", tool_call_id="tc1", tool_status="ok", tool_result="x"
    )

    entry = next(e for e in store.build_history(handle) if e.role == "assistant")

    assert entry.provider_payload is None
    assert [c.id for c in entry.tool_calls] == ["tc1"]


def test_build_history_drops_openai_payload_naming_more_calls_than_stored(handle):
    turn = store.create_turn(handle, "openai", "gpt-5")
    store.add_item(handle, turn.id, "user", text="go")
    store.add_item(
        handle,
        turn.id,
        "assistant",
        text="",
        provider="openai",
        provider_payload=[
            {"type": "reasoning", "id": "rs_1"},
            {"type": "function_call", "call_id": "c1", "name": "get_job", "arguments": "{}"},
            {"type": "function_call", "call_id": "c2", "name": "get_job", "arguments": "{}"},
        ],
    )
    store.add_item(
        handle, turn.id, "tool", tool_name="get_job", tool_call_id="c1", tool_status="ok", tool_result="x"
    )

    entry = next(e for e in store.build_history(handle) if e.role == "assistant")

    assert entry.provider_payload is None


def test_sweep_interrupted_leaves_awaiting_approval_turns_alone(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.update_turn(handle, turn.id, state="awaiting_approval")

    n = store.sweep_interrupted(handle)

    assert n == 0
    assert store.get_turn(handle, turn.id).state == "awaiting_approval"


# ------------------------------------------------------------------------------------ schemas


def test_agent_item_out_field_set_matches_contract():
    expected = {
        "id",
        "seq",
        "turn_id",
        "kind",
        "text",
        "tool_name",
        "tool_input",
        "tool_status",
        "tool_summary",
        "job_ids",
        "approval",
        "navigate",
        "created_at",
    }
    assert set(AgentItemOut.model_fields) == expected
    assert "tool_result" not in AgentItemOut.model_fields
    assert "provider_payload" not in AgentItemOut.model_fields


def test_agent_turn_out_field_set_matches_contract():
    expected = {"id", "state", "provider", "model_name", "error", "tool_calls", "created_at", "finished_at"}
    assert set(AgentTurnOut.model_fields) == expected


def test_agent_turn_out_serialises_datetime_as_rfc3339_z(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    payload = turn.model_dump(mode="json")
    assert payload["created_at"].endswith("Z")
    assert payload["finished_at"] is None


def test_get_item_never_leaks_through_api_schema(handle):
    """`get_item`'s dict carries internal fields, but nothing in `AgentItemOut` can surface them."""
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    item = store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc1",
        tool_status="ok",
        tool_result="secret result text",
        provider_payload={"raw": True},
    )
    assert not hasattr(item, "tool_result")
    assert not hasattr(item, "provider_payload")


# -------------------------------------------------------------------------------- build_history


def test_build_history_rule1_drops_leading_items_until_first_user(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="first")
    store.add_item(handle, turn.id, "assistant", text="a1")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="get_project",
        tool_call_id="tc1",
        tool_status="ok",
        tool_result="ok result",
    )
    store.add_item(handle, turn.id, "user", text="second")
    store.add_item(handle, turn.id, "assistant", text="a2")

    history = store.build_history(handle, max_items=3)

    assert [e.role for e in history] == ["user", "assistant"]
    assert history[0].text == "second"
    assert history[1].text == "a2"


def test_build_history_rule1_keeps_whole_turn_when_it_exceeds_max_items(handle):
    """A single turn can hold 1 user item + up to 25 * (assistant + tool) = 51 items, more than
    `max_items` (40). The newest-40 window then holds no `user` item at all; instead of returning
    an empty history (which would drop the turn's own user message and desync every remaining
    tool call from its result), the whole turn must be kept from its `user` item forward, oversize
    window and all — `build_history`'s char budget (rule 5) is what trims it back down.
    """
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="do a lot of things")
    for i in range(25):
        store.add_item(handle, turn.id, "assistant", text=f"step {i}")
        store.add_item(
            handle,
            turn.id,
            "tool",
            tool_name="get_job",
            tool_call_id=f"tc{i}",
            tool_status="ok",
            tool_result=f"result {i}",
        )

    history = store.build_history(handle)  # default max_items=40; this turn has 51 items

    assert history[0].role == "user"
    assert history[0].text == "do a lot of things"
    assistant_entries = [e for e in history if e.role == "assistant"]
    assert len(assistant_entries) == 25
    for entry in assistant_entries:
        assert len(entry.tool_calls) == 1  # every call kept its result; none dropped by windowing


def test_build_history_rule2_groups_tool_results_after_assistant(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="label them")
    store.add_item(
        handle,
        turn.id,
        "assistant",
        text="working on it",
        provider="anthropic",
        provider_payload={"blocks": 1},
    )
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="label_images",
        tool_call_id="tc1",
        tool_input={"selection": {}},
        tool_status="ok",
        tool_result="started",
    )

    history = store.build_history(handle)

    assert [e.role for e in history] == ["user", "assistant", "tool_results"]
    assistant_entry = history[1]
    assert [c.id for c in assistant_entry.tool_calls] == ["tc1"]
    assert assistant_entry.tool_calls[0].name == "label_images"
    assert assistant_entry.tool_calls[0].input == {"selection": {}}
    assert assistant_entry.provider == "anthropic"
    assert assistant_entry.provider_payload == {"blocks": 1}
    results_entry = history[2]
    assert [r.call_id for r in results_entry.results] == ["tc1"]
    assert results_entry.results[0].content == "started"
    assert results_entry.results[0].is_error is False


def test_build_history_rule3_skips_running_and_awaiting_approval_tools(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="go")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(handle, turn.id, "tool", tool_name="get_job", tool_call_id="tc1", tool_status="running")
    store.add_item(
        handle, turn.id, "tool", tool_name="wait_for_job", tool_call_id="tc2", tool_status="awaiting_approval"
    )

    history = store.build_history(handle)

    assert [e.role for e in history] == ["user", "assistant"]
    assert history[1].tool_calls == []


def test_build_history_rule3_drops_provider_payload_when_any_call_skipped(handle):
    """The adapters replay `provider_payload` verbatim (raw provider blocks, including tool_use/
    function_call blocks for every call the model made). If any of an assistant's tool calls was
    skipped (still running/awaiting_approval, so it has no matching tool_result), replaying that
    raw payload sends the provider a tool call with no result and the provider call fails with a
    400. `provider_payload` must drop to `None` in that case so the adapter rebuilds the message
    from `text`/`tool_calls`, which only lists calls that got a result.
    """
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="go")
    store.add_item(
        handle,
        turn.id,
        "assistant",
        text="",
        provider="anthropic",
        provider_payload=[{"type": "tool_use", "id": "tc1"}, {"type": "tool_use", "id": "tc2"}],
    )
    store.add_item(
        handle, turn.id, "tool", tool_name="get_job", tool_call_id="tc1", tool_status="ok", tool_result="done"
    )
    store.add_item(
        handle, turn.id, "tool", tool_name="wait_for_job", tool_call_id="tc2", tool_status="running"
    )

    history = store.build_history(handle)

    assistant_entry = next(e for e in history if e.role == "assistant")
    assert assistant_entry.provider_payload is None


def test_build_history_rule3_keeps_provider_payload_when_all_calls_resulted(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="go")
    payload = [{"type": "tool_use", "id": "tc1"}]
    store.add_item(handle, turn.id, "assistant", text="", provider="anthropic", provider_payload=payload)
    store.add_item(
        handle, turn.id, "tool", tool_name="get_job", tool_call_id="tc1", tool_status="ok", tool_result="done"
    )

    history = store.build_history(handle)

    assistant_entry = next(e for e in history if e.role == "assistant")
    assert assistant_entry.provider_payload == payload


def test_build_history_marks_error_and_denied_as_is_error(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="go")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="delete_images",
        tool_call_id="tc1",
        tool_status="denied",
        tool_result="The user declined this action.",
    )
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="train_model",
        tool_call_id="tc2",
        tool_status="error",
        tool_result="budget exceeded",
    )

    history = store.build_history(handle)

    results = history[-1].results
    assert {r.call_id: r.is_error for r in results} == {"tc1": True, "tc2": True}


def test_build_history_rule4_only_last_tool_results_gets_image(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="look")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc1",
        tool_status="ok",
        tool_result="shown",
        result_image_id="img-old",
    )
    store.add_item(handle, turn.id, "user", text="again")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="view_image",
        tool_call_id="tc2",
        tool_status="ok",
        tool_result="shown",
        result_image_id="img-new",
    )

    loaded: dict[str, bool] = {}

    def load_image(image_id):
        loaded[image_id] = True
        return f"b64:{image_id}"

    history = store.build_history(handle, load_image=load_image)

    tool_result_entries = [e for e in history if e.role == "tool_results"]
    assert len(tool_result_entries) == 2
    old_entry, new_entry = tool_result_entries
    assert old_entry.results[0].image_jpeg_b64 is None
    assert old_entry.results[0].content == "shown\n[The image was shown to you earlier.]"
    assert new_entry.results[0].image_jpeg_b64 == "b64:img-new"
    assert loaded == {"img-new": True}


def test_build_history_rule5_shrinks_oldest_tool_results_to_budget(handle):
    turn = store.create_turn(handle, "anthropic", "claude-opus-5")
    store.add_item(handle, turn.id, "user", text="u1")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="find_images",
        tool_call_id="tc1",
        tool_status="ok",
        tool_result="x" * 100,
    )
    store.add_item(handle, turn.id, "user", text="u2")
    store.add_item(handle, turn.id, "assistant", text="")
    store.add_item(
        handle,
        turn.id,
        "tool",
        tool_name="find_images",
        tool_call_id="tc2",
        tool_status="ok",
        tool_result="y" * 100,
    )

    history = store.build_history(handle, max_chars=150)

    tool_result_entries = [e for e in history if e.role == "tool_results"]
    assert tool_result_entries[0].results[0].content == store.OMITTED_PLACEHOLDER
    assert tool_result_entries[1].results[0].content == "y" * 100
