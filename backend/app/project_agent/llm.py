"""Model adapters for the project agent: Anthropic Messages tool use and OpenAI Responses functions.

`complete` is the only entry point. It converts the provider-neutral history into the provider's wire
format, makes one bounded call, and turns the answer back into a `ModelReply`. Every failure surfaces
as an `LlmError` whose message is fixed text: SDK exception strings (which can echo request data) are
never passed on, logged or chained.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.project_agent.history import HistoryEntry, LlmError, ModelReply, ToolCall, ToolSpec

MODEL_TIMEOUT_S = 300
# The wall-clock bound around one call: the SDK timeout plus a little slack for connect/teardown.
_DEADLINE_S = MODEL_TIMEOUT_S + 5
MAX_OUTPUT_TOKENS = 16000

_NO_TEXT = "(no text)"
_REFUSED = "The provider declined this request."
_TRUNCATED = "The provider's answer was cut off. Try a smaller request."
_INCOMPLETE = "The provider's answer was incomplete. Try again."
_RATE_LIMITED = "The provider is rate limiting requests. Wait a minute and try again."
_KEY_REJECTED = "The provider rejected the API key. Check it in App settings."
_TOO_SLOW = "The provider took too long to answer."
_FAILED = "The provider could not complete this step. Try again."


async def complete(
    provider: str,
    *,
    api_key: str,
    model: str,
    system: str,
    history: list[HistoryEntry],
    tools: list[ToolSpec],
) -> ModelReply:
    """Ask `provider` for the next assistant step. Raises `LlmError` with a user-safe message."""
    if provider == "anthropic":
        call = _anthropic
    elif provider == "openai":
        call = _openai
    else:
        raise LlmError("Unknown provider.")
    try:
        return await asyncio.wait_for(
            call(api_key=api_key, model=model, system=system, history=history, tools=tools),
            _DEADLINE_S,
        )
    except LlmError:
        raise
    except Exception as exc:  # noqa: BLE001 - every SDK failure maps to fixed text
        raise LlmError(_error_message(provider, exc)) from None


def _error_message(provider: str, exc: Exception) -> str:
    if isinstance(exc, asyncio.TimeoutError):
        return _TOO_SLOW
    try:
        if provider == "anthropic":
            import anthropic as sdk
        else:
            import openai as sdk
    except ImportError:  # pragma: no cover - both SDKs ship with the backend
        return _FAILED
    if isinstance(exc, sdk.RateLimitError):
        return _RATE_LIMITED
    if isinstance(exc, (sdk.AuthenticationError, sdk.PermissionDeniedError)):
        return _KEY_REJECTED
    if isinstance(exc, sdk.APITimeoutError):
        return _TOO_SLOW
    return _FAILED


def _replayable(entry: HistoryEntry, provider: str, model: str) -> bool:
    """A raw payload goes back only to the provider *and* model that wrote it (thinking signatures and
    encrypted reasoning are model-bound); anything else replays neutrally from text and calls."""
    return entry.provider == provider and entry.model == model and isinstance(entry.provider_payload, list)


# --- Anthropic -----------------------------------------------------------------------------------


async def _anthropic(
    *, api_key: str, model: str, system: str, history: list[HistoryEntry], tools: list[ToolSpec]
) -> ModelReply:
    from anthropic import AsyncAnthropic

    async with AsyncAnthropic(api_key=api_key, timeout=MODEL_TIMEOUT_S, max_retries=0) as client:
        response = await client.messages.create(
            model=model,
            system=system,
            messages=_anthropic_messages(history, model),
            tools=[
                {"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in tools
            ],
            max_tokens=MAX_OUTPUT_TOKENS,
        )
    if response.stop_reason == "refusal":
        raise LlmError(_REFUSED)
    if response.stop_reason == "max_tokens":
        raise LlmError(_TRUNCATED)
    texts: list[str] = []
    calls: list[ToolCall] = []
    for block in response.content:
        if block.type == "text":
            if block.text:
                texts.append(block.text)
        elif block.type == "tool_use":
            calls.append(ToolCall(id=block.id, name=block.name, input=_as_object(block.input)))
    # Only thinking blocks must round-trip byte-exact; an empty text block is rejected on replay.
    payload = [
        block.model_dump(mode="json", exclude_none=True)
        for block in response.content
        if not (block.type == "text" and not block.text)
    ]
    return ModelReply(text="\n\n".join(texts), tool_calls=calls, provider_payload=payload)


def _anthropic_messages(history: list[HistoryEntry], model: str) -> list[dict]:
    messages: list[dict] = []
    for entry in history:
        if entry.role == "user":
            _append_anthropic(messages, {"role": "user", "content": entry.text})
        elif entry.role == "assistant":
            if _replayable(entry, "anthropic", model):
                content = entry.provider_payload
            else:
                content = [{"type": "text", "text": entry.text}] if entry.text else []
                content += [
                    {"type": "tool_use", "id": c.id, "name": c.name, "input": c.input}
                    for c in entry.tool_calls
                ]
            messages.append({"role": "assistant", "content": content or [{"type": "text", "text": _NO_TEXT}]})
        elif entry.role == "tool_results":
            blocks = []
            for result in entry.results:
                content: list[dict] = [{"type": "text", "text": result.content or _NO_TEXT}]
                if result.image_jpeg_b64:
                    content.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": result.image_jpeg_b64,
                            },
                        }
                    )
                blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": result.call_id,
                        "content": content,
                        "is_error": result.is_error,
                    }
                )
            if blocks:
                _append_anthropic(messages, {"role": "user", "content": blocks})
    return messages


def _append_anthropic(messages: list[dict], message: dict) -> None:
    """Append, merging into the previous message when both are user turns (Anthropic alternates)."""
    if messages and messages[-1]["role"] == "user" and message["role"] == "user":
        previous = messages[-1]
        previous["content"] = _as_blocks(previous["content"]) + _as_blocks(message["content"])
        return
    messages.append(message)


def _as_blocks(content: str | list[dict]) -> list[dict]:
    return [{"type": "text", "text": content}] if isinstance(content, str) else list(content)


# --- OpenAI --------------------------------------------------------------------------------------


async def _openai(
    *, api_key: str, model: str, system: str, history: list[HistoryEntry], tools: list[ToolSpec]
) -> ModelReply:
    from openai import AsyncOpenAI

    async with AsyncOpenAI(api_key=api_key, timeout=MODEL_TIMEOUT_S, max_retries=0) as client:
        result = await client.responses.create(
            model=model,
            instructions=system,
            input=_openai_input(history, model),
            tools=[
                {
                    "type": "function",
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                    "strict": False,
                }
                for t in tools
            ],
            store=False,
            include=["reasoning.encrypted_content"],
            max_output_tokens=MAX_OUTPUT_TOKENS,
        )
    if result.status != "completed":
        raise LlmError(_INCOMPLETE)
    calls: list[ToolCall] = []
    for item in result.output:
        if item.type == "message":
            if any(getattr(part, "type", None) == "refusal" for part in item.content):
                raise LlmError(_REFUSED)
        elif item.type == "function_call":
            calls.append(ToolCall(id=item.call_id, name=item.name, input=_parse_arguments(item.arguments)))
    payload = [item.model_dump(mode="json", exclude_none=True) for item in result.output]
    return ModelReply(text=result.output_text or "", tool_calls=calls, provider_payload=payload)


def _openai_input(history: list[HistoryEntry], model: str) -> list[dict]:
    items: list[dict] = []
    for entry in history:
        if entry.role == "user":
            items.append({"role": "user", "content": entry.text})
        elif entry.role == "assistant":
            if _replayable(entry, "openai", model):
                items.extend(entry.provider_payload)
                continue
            if entry.text:
                items.append({"role": "assistant", "content": entry.text})
            items.extend(
                {"type": "function_call", "call_id": c.id, "name": c.name, "arguments": json.dumps(c.input)}
                for c in entry.tool_calls
            )
        elif entry.role == "tool_results":
            images: list[dict] = []
            for result in entry.results:
                output = "ERROR: " + result.content if result.is_error else result.content
                items.append({"type": "function_call_output", "call_id": result.call_id, "output": output})
                if result.image_jpeg_b64:
                    images += [
                        {"type": "input_text", "text": f"Image for tool call {result.call_id}:"},
                        {
                            "type": "input_image",
                            "image_url": f"data:image/jpeg;base64,{result.image_jpeg_b64}",
                        },
                    ]
            if images:
                items.append({"role": "user", "content": images})
    return items


def _parse_arguments(arguments: str) -> dict:
    """Model-written JSON; anything but an object becomes `{}` so the tool reports the validation error."""
    try:
        return _as_object(json.loads(arguments))
    except (TypeError, ValueError):
        return {}


def _as_object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}
