"""Persistence of project-agent turns and items, and the conversion to the neutral history the
turn loop replays (`app.project_agent.history`).

Every function takes the project's `ProjectHandle` first. `get_item`/`pending_approval_item`
return plain dicts with every column, including the internal ones (`tool_result`,
`provider_payload`, `result_image_id`, `tool_call_id`) that the API schemas never expose.
"""

from collections.abc import Callable
from typing import Any

from sqlalchemy import delete, func, select

from app.db.base import utcnow
from app.db.models import AgentItem, AgentTurn
from app.errors import AppError, not_found
from app.project_agent.history import HistoryEntry, ToolCall, ToolResult
from app.project_agent.schemas import AgentConversationOut, AgentItemOut, AgentTurnOut

ACTIVE_STATES = {"running", "awaiting_approval"}
RESULTED_STATUSES = {"ok", "error", "denied"}
ERROR_STATUSES = {"error", "denied"}
OMITTED_PLACEHOLDER = "[Earlier result omitted to save space.]"
SHOWN_EARLIER_NOTE = "\n[The image was shown to you earlier.]"


def _item_dict(row: AgentItem) -> dict[str, Any]:
    return {c.name: getattr(row, c.name) for c in AgentItem.__table__.columns}


def create_turn(handle, provider: str, model_name: str) -> AgentTurnOut:
    with handle.session() as s:
        row = AgentTurn(provider=provider, model_name=model_name, state="running")
        s.add(row)
        s.flush()
        return AgentTurnOut.from_row(row)


def get_turn(handle, turn_id: str) -> AgentTurnOut:
    with handle.session() as s:
        row = s.get(AgentTurn, turn_id)
        if row is None:
            raise not_found("agent turn", turn_id)
        return AgentTurnOut.from_row(row)


def active_turn(handle) -> AgentTurnOut | None:
    """The newest turn in `ACTIVE_STATES`, or `None`."""
    with handle.session() as s:
        row = (
            s.execute(
                select(AgentTurn)
                .where(AgentTurn.state.in_(ACTIVE_STATES))
                .order_by(AgentTurn.created_at.desc())
            )
            .scalars()
            .first()
        )
        return AgentTurnOut.from_row(row) if row is not None else None


def update_turn(handle, turn_id: str, **fields: Any) -> AgentTurnOut:
    with handle.session() as s:
        row = s.get(AgentTurn, turn_id)
        if row is None:
            raise not_found("agent turn", turn_id)
        for k, v in fields.items():
            setattr(row, k, v)
        s.flush()
        return AgentTurnOut.from_row(row)


def add_item(handle, turn_id: str, kind: str, **fields: Any) -> AgentItemOut:
    """Insert an item, assigning `seq = max(seq) + 1` across the whole project (monotonic per project)."""
    with handle.session() as s:
        max_seq = s.execute(select(func.max(AgentItem.seq))).scalar_one_or_none() or 0
        row = AgentItem(turn_id=turn_id, kind=kind, seq=max_seq + 1, **fields)
        s.add(row)
        s.flush()
        return AgentItemOut.from_row(row)


def update_item(handle, item_id: str, **fields: Any) -> AgentItemOut:
    with handle.session() as s:
        row = s.get(AgentItem, item_id)
        if row is None:
            raise not_found("agent item", item_id)
        for k, v in fields.items():
            setattr(row, k, v)
        s.flush()
        return AgentItemOut.from_row(row)


def get_item(handle, item_id: str) -> dict[str, Any]:
    with handle.session() as s:
        row = s.get(AgentItem, item_id)
        if row is None:
            raise not_found("agent item", item_id)
        return _item_dict(row)


def pending_approval_item(handle, turn_id: str) -> dict[str, Any] | None:
    """The tool item of `turn_id` with `tool_status == 'awaiting_approval'`, or `None`."""
    with handle.session() as s:
        row = (
            s.execute(
                select(AgentItem)
                .where(AgentItem.turn_id == turn_id, AgentItem.tool_status == "awaiting_approval")
                .order_by(AgentItem.seq.desc())
            )
            .scalars()
            .first()
        )
        return _item_dict(row) if row is not None else None


def conversation(handle, limit: int = 200) -> AgentConversationOut:
    """The last `limit` items, oldest first, and the newest turn."""
    with handle.session() as s:
        rows = s.execute(select(AgentItem).order_by(AgentItem.seq.desc()).limit(limit)).scalars().all()
        items = [AgentItemOut.from_row(r) for r in reversed(rows)]
        turn_row = (
            s.execute(select(AgentTurn).order_by(AgentTurn.created_at.desc()).limit(1)).scalars().first()
        )
        turn = AgentTurnOut.from_row(turn_row) if turn_row is not None else None
        return AgentConversationOut(items=items, turn=turn)


def clear(handle) -> None:
    """Delete the whole conversation. 409 `conflict` while a turn is running or awaiting approval."""
    with handle.session() as s:
        active = s.execute(
            select(func.count()).select_from(AgentTurn).where(AgentTurn.state.in_(ACTIVE_STATES))
        ).scalar_one()
        if active:
            raise AppError("conflict", "the agent is running; cancel or resolve it before clearing", 409)
        s.execute(delete(AgentItem))
        s.execute(delete(AgentTurn))


def user_texts(handle) -> list[str]:
    """Every user item's text, oldest first (used to check `import_folder`'s path was typed by the user)."""
    with handle.session() as s:
        rows = (
            s.execute(select(AgentItem.text).where(AgentItem.kind == "user").order_by(AgentItem.seq))
            .scalars()
            .all()
        )
        return list(rows)


def sweep_interrupted(handle) -> int:
    """On project open: a `running` turn left by a previous process failed; its `running` tool items
    become `error`. `awaiting_approval` turns are left alone (they stay resumable). Returns the
    number of turns swept.

    A hard kill never let the loop record the reply's unstarted calls, so the raw provider payloads
    of the swept turns (naming calls with no stored result) are dropped: replay falls back to the
    neutral text + resulted calls instead of a provider 400 on every later turn.
    """
    message = "Interrupted when the app closed."
    with handle.session() as s:
        turns = s.execute(select(AgentTurn).where(AgentTurn.state == "running")).scalars().all()
        if not turns:
            return 0
        turn_ids = [t.id for t in turns]
        now = utcnow()
        for t in turns:
            t.state = "failed"
            t.error = message
            t.finished_at = now
        assistants = (
            s.execute(select(AgentItem).where(AgentItem.turn_id.in_(turn_ids), AgentItem.kind == "assistant"))
            .scalars()
            .all()
        )
        for a in assistants:
            a.provider_payload = None
        items = (
            s.execute(
                select(AgentItem).where(
                    AgentItem.turn_id.in_(turn_ids),
                    AgentItem.kind == "tool",
                    AgentItem.tool_status == "running",
                )
            )
            .scalars()
            .all()
        )
        for it in items:
            it.tool_status = "error"
            it.tool_summary = message
            it.tool_result = message
        return len(turns)


def last_result_image_ids(handle) -> dict[str, str]:
    """`{tool_call_id: result_image_id}` for the tool items of the newest assistant item that has
    at least one tool item with status ok/error/denied — the same "newest group with a result"
    rule `build_history` uses to pick its last `tool_results` entry. A newest assistant item can be
    a plain-text reply with no tool items after it (the normal end of a turn); that group is
    skipped in favour of the newest one that actually resolved a tool call.
    """
    with handle.session() as s:
        assistants = (
            s.execute(select(AgentItem).where(AgentItem.kind == "assistant").order_by(AgentItem.seq.desc()))
            .scalars()
            .all()
        )
        for assistant in assistants:
            # Bound the group to items before the next user/assistant item, same as build_history's
            # grouping, so an older assistant's search never reaches into a newer group's tool items.
            next_boundary = s.execute(
                select(func.min(AgentItem.seq)).where(
                    AgentItem.seq > assistant.seq, AgentItem.kind.in_(("user", "assistant"))
                )
            ).scalar_one_or_none()
            query = select(AgentItem).where(
                AgentItem.turn_id == assistant.turn_id,
                AgentItem.kind == "tool",
                AgentItem.seq > assistant.seq,
            )
            if next_boundary is not None:
                query = query.where(AgentItem.seq < next_boundary)
            tool_rows = s.execute(query.order_by(AgentItem.seq)).scalars().all()

            resulted = [t for t in tool_rows if t.tool_status in RESULTED_STATUSES]
            if not resulted:
                continue
            return {t.tool_call_id: t.result_image_id for t in resulted if t.result_image_id}
        return {}


def build_history(
    handle,
    *,
    max_items: int = 40,
    max_chars: int = 60_000,
    load_image: Callable[[str], str | None] | None = None,
) -> list[HistoryEntry]:
    """Replay the last `max_items` items as the neutral history the turn loop and adapters use.

    See `project_agent/schemas.py`/the task brief for the exact rules; summarised:
    1. Take the newest `max_items` items by seq; drop leading items until the first is `user`. A
       single turn can exceed `max_items` (up to 1 user + 25 * (assistant + tool) = 51 items); if
       the window holds no `user` item at all, keep the whole conversation from the newest `user`
       item forward instead, so the turn's own user message and every later tool call/result pair
       is never dropped mid-turn — rule 5 (the char budget) is what trims that back down.
    2. `user` items become a `user` entry. `assistant` items become an `assistant` entry followed,
       when any of their tool items resolved, by one `tool_results` entry.
    3. Tool items still `running`/`awaiting_approval` are dropped; the assistant entry only lists
       calls that got a result (a provider rejects a tool call without one). When any call in the
       group was dropped this way, `provider_payload` is also dropped (set to `None`): the raw
       payload a provider adapter replays verbatim still names the skipped call, and replaying a
       tool call with no matching result is what the provider's API rejects with a 400.
    4. Only the last `tool_results` entry gets its image loaded; older ones note it was shown.
    5. Oldest tool result contents are replaced with a placeholder until under `max_chars`.
    """
    with handle.session() as s:
        rows = list(
            reversed(
                s.execute(select(AgentItem).order_by(AgentItem.seq.desc()).limit(max_items)).scalars().all()
            )
        )
        if any(r.kind == "user" for r in rows):
            while rows and rows[0].kind != "user":
                rows.pop(0)
        else:
            newest_user = (
                s.execute(
                    select(AgentItem).where(AgentItem.kind == "user").order_by(AgentItem.seq.desc()).limit(1)
                )
                .scalars()
                .first()
            )
            rows = (
                list(
                    s.execute(
                        select(AgentItem).where(AgentItem.seq >= newest_user.seq).order_by(AgentItem.seq)
                    )
                    .scalars()
                    .all()
                )
                if newest_user is not None
                else []
            )

        # Group into (kind, row, tool_rows) — tool_rows only populated for "assistant" groups.
        groups: list[tuple[str, AgentItem, list[AgentItem]]] = []
        i = 0
        while i < len(rows):
            row = rows[i]
            if row.kind == "user":
                groups.append(("user", row, []))
                i += 1
            elif row.kind == "assistant":
                j = i + 1
                tool_rows: list[AgentItem] = []
                while j < len(rows) and rows[j].kind == "tool":
                    tool_rows.append(rows[j])
                    j += 1
                groups.append(("assistant", row, tool_rows))
                i = j
            else:
                # A stray tool item with no preceding assistant in the window; skip defensively.
                i += 1

        tool_group_indices = [
            idx
            for idx, (kind, _row, tool_rows) in enumerate(groups)
            if kind == "assistant" and any(t.tool_status in RESULTED_STATUSES for t in tool_rows)
        ]
        last_tool_group_idx = tool_group_indices[-1] if tool_group_indices else None

        entries: list[HistoryEntry] = []
        for idx, (kind, row, tool_rows) in enumerate(groups):
            if kind == "user":
                entries.append(HistoryEntry("user", text=row.text))
                continue

            resulted = [t for t in tool_rows if t.tool_status in RESULTED_STATUSES]
            calls = [ToolCall(t.tool_call_id, t.tool_name, t.tool_input or {}) for t in resulted]
            # A skipped call (still running/awaiting_approval) has no result to replay; the raw
            # provider payload still names it, so it must not be replayed verbatim either (rule 3).
            # Likewise when the payload names calls that were never stored at all (a hard kill).
            any_skipped = len(resulted) != len(tool_rows) or not _payload_matches(
                row.provider_payload, {t.tool_call_id for t in resulted}
            )
            entries.append(
                HistoryEntry(
                    "assistant",
                    text=row.text,
                    tool_calls=calls,
                    provider=row.provider,
                    provider_payload=None if any_skipped else row.provider_payload,
                )
            )
            if not resulted:
                continue

            is_last_group = idx == last_tool_group_idx
            results: list[ToolResult] = []
            for t in resulted:
                content = t.tool_result or ""
                image_b64 = None
                if t.result_image_id:
                    if is_last_group:
                        image_b64 = load_image(t.result_image_id) if load_image is not None else None
                    else:
                        content += SHOWN_EARLIER_NOTE
                results.append(
                    ToolResult(
                        call_id=t.tool_call_id,
                        name=t.tool_name,
                        content=content,
                        is_error=t.tool_status in ERROR_STATUSES,
                        image_jpeg_b64=image_b64,
                    )
                )
            entries.append(HistoryEntry("tool_results", results=results))

        _shrink_to_budget(entries, max_chars)
        return entries


def _payload_matches(payload: Any, call_ids: set[str]) -> bool:
    """Whether a raw provider payload names exactly `call_ids` (Anthropic `tool_use` ids, OpenAI
    `function_call` call ids). A payload that is not a block list is never replayed by an adapter."""
    if not isinstance(payload, list):
        return True
    named = set()
    for block in payload:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_use":
            named.add(block.get("id"))
        elif block.get("type") == "function_call":
            named.add(block.get("call_id"))
    return named == call_ids


def _total_chars(entries: list[HistoryEntry]) -> int:
    return sum(len(e.text) for e in entries) + sum(len(r.content) for e in entries for r in e.results)


def _shrink_to_budget(entries: list[HistoryEntry], max_chars: int) -> None:
    """Replace the oldest tool result contents with a placeholder until `entries` is under budget."""
    oldest_first = [(e, ri) for e in entries if e.role == "tool_results" for ri in range(len(e.results))]
    k = 0
    while _total_chars(entries) > max_chars and k < len(oldest_first):
        entry, ri = oldest_first[k]
        old = entry.results[ri]
        if old.content != OMITTED_PLACEHOLDER:
            entry.results[ri] = ToolResult(
                call_id=old.call_id,
                name=old.name,
                content=OMITTED_PLACEHOLDER,
                is_error=old.is_error,
                image_jpeg_b64=old.image_jpeg_b64,
            )
        k += 1
