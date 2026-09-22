"""The project agent's LLM adapters: wire format, replay, parsing and sanitized errors (no network)."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from anthropic.types import TextBlock, ThinkingBlock, ToolUseBlock
from openai.types.responses import (
    ResponseFunctionToolCall,
    ResponseOutputMessage,
    ResponseOutputRefusal,
    ResponseOutputText,
    ResponseReasoningItem,
)

from app.project_agent import llm
from app.project_agent.history import HistoryEntry, LlmError, ToolCall, ToolResult, ToolSpec

KEY = "secret-test-key"
TOOLS = [
    ToolSpec(
        name="list_images",
        description="List images.",
        input_schema={"type": "object", "properties": {"limit": {"type": "integer"}}},
    )
]


def _anthropic_message(content, stop_reason="end_turn"):
    return SimpleNamespace(content=content, stop_reason=stop_reason)


def _openai_response(output, status="completed"):
    texts = [
        part.text
        for item in output
        if item.type == "message"
        for part in item.content
        if part.type == "output_text"
    ]
    return SimpleNamespace(output=output, status=status, output_text="".join(texts))


def _openai_message(text):
    return ResponseOutputMessage(
        id="msg_1",
        role="assistant",
        status="completed",
        type="message",
        content=[ResponseOutputText(type="output_text", text=text, annotations=[])],
    )


@pytest.fixture
def sdk(monkeypatch):
    state = {"requests": [], "clients": [], "error": None, "anthropic": None, "openai": None}

    def make(kind):
        class FakeClient:
            def __init__(self, **kwargs):
                state["clients"].append(kwargs)
                self.responses = self.messages = self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def create(self, **kwargs):
                state["requests"].append(kwargs)
                if state["error"] is not None:
                    raise state["error"]
                return state[kind]

        return FakeClient

    import anthropic
    import openai

    monkeypatch.setattr(anthropic, "AsyncAnthropic", make("anthropic"))
    monkeypatch.setattr(openai, "AsyncOpenAI", make("openai"))
    state["anthropic"] = _anthropic_message([TextBlock(type="text", text="Done.")])
    state["openai"] = _openai_response([_openai_message("Done.")])
    return state


def run(provider, history, tools=TOOLS):
    return asyncio.run(
        llm.complete(
            provider, api_key=KEY, model="the-model", system="Be useful.", history=history, tools=tools
        )
    )


# --- request shape -------------------------------------------------------------------------------


def test_anthropic_request_shape(sdk):
    reply = run("anthropic", [HistoryEntry(role="user", text="Hi")])
    assert reply.text == "Done."
    assert reply.tool_calls == []
    assert sdk["clients"] == [{"api_key": KEY, "timeout": llm.MODEL_TIMEOUT_S, "max_retries": 0}]
    request = sdk["requests"][0]
    assert request == {
        "model": "the-model",
        "system": "Be useful.",
        "messages": [{"role": "user", "content": "Hi"}],
        "tools": [
            {"name": "list_images", "description": "List images.", "input_schema": TOOLS[0].input_schema}
        ],
        "max_tokens": llm.MAX_OUTPUT_TOKENS,
    }
    assert "thinking" not in request and "temperature" not in request
    assert KEY not in json.dumps(request)
    assert llm.MODEL_TIMEOUT_S == 300 and llm.MAX_OUTPUT_TOKENS == 16000
    assert llm._DEADLINE_S > llm.MODEL_TIMEOUT_S


def test_openai_request_shape(sdk):
    reply = run("openai", [HistoryEntry(role="user", text="Hi")])
    assert reply.text == "Done."
    assert sdk["clients"] == [{"api_key": KEY, "timeout": llm.MODEL_TIMEOUT_S, "max_retries": 0}]
    request = sdk["requests"][0]
    assert request == {
        "model": "the-model",
        "instructions": "Be useful.",
        "input": [{"role": "user", "content": "Hi"}],
        "tools": [
            {
                "type": "function",
                "name": "list_images",
                "description": "List images.",
                "parameters": TOOLS[0].input_schema,
                "strict": False,
            }
        ],
        "store": False,
        "include": ["reasoning.encrypted_content"],
        "max_output_tokens": llm.MAX_OUTPUT_TOKENS,
    }
    assert KEY not in json.dumps(request)


def test_unknown_provider(sdk):
    with pytest.raises(LlmError) as info:
        run("gemini", [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == "Unknown provider."
    assert sdk["requests"] == []


# --- history conversion --------------------------------------------------------------------------

CALL = ToolCall(id="call_1", name="list_images", input={"limit": 5})
RESULT = ToolResult(call_id="call_1", name="list_images", content="3 images")
IMAGE_RESULT = ToolResult(call_id="call_2", name="view_image", content="img.jpg", image_jpeg_b64="QUJD")
ERROR_RESULT = ToolResult(call_id="call_3", name="list_images", content="bad input", is_error=True)


def test_anthropic_neutral_history(sdk):
    history = [
        HistoryEntry(role="user", text="Count images"),
        HistoryEntry(role="assistant", text="Looking.", tool_calls=[CALL]),
        HistoryEntry(role="tool_results", results=[RESULT, IMAGE_RESULT, ERROR_RESULT]),
        HistoryEntry(role="assistant", tool_calls=[CALL]),
        HistoryEntry(role="tool_results", results=[RESULT]),
        HistoryEntry(role="assistant", text=""),
        HistoryEntry(role="user", text="Thanks"),
    ]
    run("anthropic", history)
    messages = sdk["requests"][0]["messages"]
    tool_result = {
        "type": "tool_result",
        "tool_use_id": "call_1",
        "content": [{"type": "text", "text": "3 images"}],
        "is_error": False,
    }
    assert messages == [
        {"role": "user", "content": "Count images"},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Looking."},
                {"type": "tool_use", "id": "call_1", "name": "list_images", "input": {"limit": 5}},
            ],
        },
        {
            "role": "user",
            "content": [
                tool_result,
                {
                    "type": "tool_result",
                    "tool_use_id": "call_2",
                    "content": [
                        {"type": "text", "text": "img.jpg"},
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"},
                        },
                    ],
                    "is_error": False,
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "call_3",
                    "content": [{"type": "text", "text": "bad input"}],
                    "is_error": True,
                },
            ],
        },
        {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": "call_1", "name": "list_images", "input": {"limit": 5}}],
        },
        {"role": "user", "content": [tool_result]},
        {"role": "assistant", "content": [{"type": "text", "text": "(no text)"}]},
        {"role": "user", "content": "Thanks"},
    ]


def test_anthropic_merges_user_after_tool_results(sdk):
    history = [
        HistoryEntry(role="user", text="Count"),
        HistoryEntry(role="assistant", tool_calls=[CALL]),
        HistoryEntry(role="tool_results", results=[RESULT]),
        HistoryEntry(role="user", text="Stop, do something else"),
    ]
    run("anthropic", history)
    messages = sdk["requests"][0]["messages"]
    assert len(messages) == 3
    assert messages[2]["role"] == "user"
    assert messages[2]["content"][-1] == {"type": "text", "text": "Stop, do something else"}
    assert messages[2]["content"][0]["type"] == "tool_result"


def test_anthropic_merges_consecutive_user_texts(sdk):
    run("anthropic", [HistoryEntry(role="user", text="One"), HistoryEntry(role="user", text="Two")])
    assert sdk["requests"][0]["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "One"}, {"type": "text", "text": "Two"}]}
    ]


def test_anthropic_replays_own_payload_unchanged(sdk):
    payload = [
        {"type": "thinking", "thinking": "hmm", "signature": "sig"},
        {"type": "tool_use", "id": "call_1", "name": "list_images", "input": {"limit": 5}},
    ]
    history = [
        HistoryEntry(role="user", text="Count"),
        HistoryEntry(
            role="assistant",
            tool_calls=[CALL],
            provider="anthropic",
            model="the-model",
            provider_payload=payload,
        ),
        HistoryEntry(role="tool_results", results=[RESULT]),
    ]
    run("anthropic", history)
    assert sdk["requests"][0]["messages"][1] == {"role": "assistant", "content": payload}


def test_openai_payload_not_replayed_to_anthropic(sdk):
    history = [
        HistoryEntry(role="user", text="Count"),
        HistoryEntry(
            role="assistant",
            text="Sure",
            provider="openai",
            provider_payload=[{"type": "reasoning", "id": "rs_1", "summary": []}],
        ),
    ]
    run("anthropic", history)
    assert sdk["requests"][0]["messages"][1] == {
        "role": "assistant",
        "content": [{"type": "text", "text": "Sure"}],
    }


def test_openai_neutral_history(sdk):
    history = [
        HistoryEntry(role="user", text="Count images"),
        HistoryEntry(role="assistant", text="Looking.", tool_calls=[CALL]),
        HistoryEntry(role="tool_results", results=[RESULT, IMAGE_RESULT, ERROR_RESULT]),
        HistoryEntry(role="assistant", text="", tool_calls=[]),
        HistoryEntry(role="user", text="Thanks"),
    ]
    run("openai", history)
    assert sdk["requests"][0]["input"] == [
        {"role": "user", "content": "Count images"},
        {"role": "assistant", "content": "Looking."},
        {"type": "function_call", "call_id": "call_1", "name": "list_images", "arguments": '{"limit": 5}'},
        {"type": "function_call_output", "call_id": "call_1", "output": "3 images"},
        {"type": "function_call_output", "call_id": "call_2", "output": "img.jpg"},
        {"type": "function_call_output", "call_id": "call_3", "output": "ERROR: bad input"},
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Image for tool call call_2:"},
                {"type": "input_image", "image_url": "data:image/jpeg;base64,QUJD"},
            ],
        },
        {"role": "user", "content": "Thanks"},
    ]


def test_openai_replays_own_payload_and_ignores_foreign(sdk):
    own = [
        {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "enc"},
        {"type": "function_call", "call_id": "call_1", "name": "list_images", "arguments": '{"limit": 5}'},
    ]
    history = [
        HistoryEntry(role="user", text="Count"),
        HistoryEntry(
            role="assistant", tool_calls=[CALL], provider="openai", model="the-model", provider_payload=own
        ),
        HistoryEntry(role="tool_results", results=[RESULT]),
        HistoryEntry(
            role="assistant",
            text="Three.",
            provider="anthropic",
            provider_payload=[{"type": "thinking", "thinking": "x", "signature": "s"}],
        ),
    ]
    run("openai", history)
    assert sdk["requests"][0]["input"] == [
        {"role": "user", "content": "Count"},
        *own,
        {"type": "function_call_output", "call_id": "call_1", "output": "3 images"},
        {"role": "assistant", "content": "Three."},
    ]


# --- response parsing ----------------------------------------------------------------------------


def test_anthropic_parses_tool_calls_and_payload(sdk):
    blocks = [
        ThinkingBlock(type="thinking", thinking="plan", signature="sig"),
        TextBlock(type="text", text="First."),
        ToolUseBlock(type="tool_use", id="toolu_1", name="list_images", input={"limit": 2}),
        TextBlock(type="text", text="Second."),
    ]
    sdk["anthropic"] = _anthropic_message(blocks, stop_reason="tool_use")
    reply = run("anthropic", [HistoryEntry(role="user", text="Hi")])
    assert reply.text == "First.\n\nSecond."
    assert reply.tool_calls == [ToolCall(id="toolu_1", name="list_images", input={"limit": 2})]
    assert reply.provider_payload == [
        {"type": "thinking", "thinking": "plan", "signature": "sig"},
        {"type": "text", "text": "First."},
        {"type": "tool_use", "id": "toolu_1", "name": "list_images", "input": {"limit": 2}},
        {"type": "text", "text": "Second."},
    ]
    json.dumps(reply.provider_payload)


def test_openai_parses_tool_calls_and_payload(sdk):
    output = [
        ResponseReasoningItem(type="reasoning", id="rs_1", summary=[], encrypted_content="enc"),
        _openai_message("Checking."),
        ResponseFunctionToolCall(
            type="function_call", call_id="call_9", name="list_images", arguments='{"limit": 3}', id="fc_1"
        ),
        ResponseFunctionToolCall(
            type="function_call", call_id="call_10", name="list_images", arguments="{not json"
        ),
    ]
    sdk["openai"] = _openai_response(output)
    reply = run("openai", [HistoryEntry(role="user", text="Hi")])
    assert reply.text == "Checking."
    assert reply.tool_calls == [
        ToolCall(id="call_9", name="list_images", input={"limit": 3}),
        ToolCall(id="call_10", name="list_images", input={}),
    ]
    assert reply.provider_payload[0] == {
        "type": "reasoning",
        "id": "rs_1",
        "summary": [],
        "encrypted_content": "enc",
    }
    assert reply.provider_payload[2]["call_id"] == "call_9"
    json.dumps(reply.provider_payload)


def test_openai_non_object_arguments_become_empty_input(sdk):
    output = [
        ResponseFunctionToolCall(type="function_call", call_id="c", name="list_images", arguments="[1, 2]")
    ]
    sdk["openai"] = _openai_response(output)
    reply = run("openai", [HistoryEntry(role="user", text="Hi")])
    assert reply.tool_calls == [ToolCall(id="c", name="list_images", input={})]


@pytest.mark.parametrize(
    ("stop_reason", "message"),
    [
        ("refusal", "The provider declined this request."),
        ("max_tokens", "The provider's answer was cut off. Try a smaller request."),
    ],
)
def test_anthropic_refusal_and_truncation(sdk, stop_reason, message):
    sdk["anthropic"] = _anthropic_message([TextBlock(type="text", text="partial")], stop_reason=stop_reason)
    with pytest.raises(LlmError) as info:
        run("anthropic", [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == message


def test_openai_incomplete(sdk):
    sdk["openai"] = _openai_response([_openai_message("partial")], status="incomplete")
    with pytest.raises(LlmError) as info:
        run("openai", [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == "The provider's answer was incomplete. Try again."


def test_openai_refusal(sdk):
    refusal = ResponseOutputMessage(
        id="msg_2",
        role="assistant",
        status="completed",
        type="message",
        content=[ResponseOutputRefusal(type="refusal", refusal="No.")],
    )
    sdk["openai"] = _openai_response([refusal])
    with pytest.raises(LlmError) as info:
        run("openai", [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == "The provider declined this request."


# --- error mapping -------------------------------------------------------------------------------

SECRET = f"{KEY} confidential provider payload"


def _sdk_errors(provider):
    if provider == "anthropic":
        import anthropic as sdk_module

        try:
            import httpx2 as http
        except ImportError:  # pragma: no cover - older SDKs use httpx
            http = httpx
    else:
        import openai as sdk_module

        http = httpx
    request = http.Request("POST", "https://provider.invalid/v1")

    def status(cls, code):
        return cls(SECRET, response=http.Response(code, request=request), body={"error": SECRET})

    return {
        "rate": status(sdk_module.RateLimitError, 429),
        "auth": status(sdk_module.AuthenticationError, 401),
        "denied": status(sdk_module.PermissionDeniedError, 403),
        "timeout": sdk_module.APITimeoutError(request=request),
        "server": status(sdk_module.InternalServerError, 500),
        "connection": sdk_module.APIConnectionError(message=SECRET, request=request),
    }


ERROR_MESSAGES = {
    "rate": "The provider is rate limiting requests. Wait a minute and try again.",
    "auth": "The provider rejected the API key. Check it in App settings.",
    "denied": "The provider rejected the API key. Check it in App settings.",
    "timeout": "The provider took too long to answer.",
    "server": "The provider could not complete this step. Try again.",
    "connection": "The provider could not complete this step. Try again.",
    "asyncio_timeout": "The provider took too long to answer.",
    "runtime": "The provider could not complete this step. Try again.",
}


@pytest.mark.parametrize("provider", ["anthropic", "openai"])
@pytest.mark.parametrize("kind", list(ERROR_MESSAGES))
def test_error_mapping_is_sanitized(sdk, provider, kind, caplog):
    if kind == "asyncio_timeout":
        sdk["error"] = TimeoutError()
    elif kind == "runtime":
        sdk["error"] = RuntimeError(SECRET)
    else:
        sdk["error"] = _sdk_errors(provider)[kind]
    with pytest.raises(LlmError) as info:
        run(provider, [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == ERROR_MESSAGES[kind]
    assert str(info.value) == ERROR_MESSAGES[kind]
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert KEY not in caplog.text and "confidential" not in caplog.text


def test_wall_clock_deadline(sdk, monkeypatch):
    async def stalled(*args, **kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(llm, "_DEADLINE_S", 0.05)
    monkeypatch.setattr(llm, "_anthropic", stalled)
    with pytest.raises(LlmError) as info:
        run("anthropic", [HistoryEntry(role="user", text="Hi")])
    assert info.value.message == "The provider took too long to answer."


# --- final review fixes --------------------------------------------------------------------------


def test_anthropic_payload_drops_empty_text_blocks(sdk):
    blocks = [
        ThinkingBlock(type="thinking", thinking="plan", signature="sig"),
        TextBlock(type="text", text=""),
        ToolUseBlock(type="tool_use", id="toolu_1", name="list_images", input={"limit": 2}),
    ]
    sdk["anthropic"] = _anthropic_message(blocks, stop_reason="tool_use")
    reply = run("anthropic", [HistoryEntry(role="user", text="Hi")])
    assert reply.provider_payload == [
        {"type": "thinking", "thinking": "plan", "signature": "sig"},
        {"type": "tool_use", "id": "toolu_1", "name": "list_images", "input": {"limit": 2}},
    ]


@pytest.mark.parametrize("provider", ["anthropic", "openai"])
def test_a_payload_from_another_model_is_not_replayed(sdk, provider):
    payload = (
        [
            {"type": "thinking", "thinking": "hmm", "signature": "sig"},
            {"type": "tool_use", "id": "call_1", "name": "list_images", "input": {"limit": 5}},
        ]
        if provider == "anthropic"
        else [
            {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "enc"},
            {"type": "function_call", "call_id": "call_1", "name": "list_images", "arguments": "{}"},
        ]
    )
    history = [
        HistoryEntry(role="user", text="Count"),
        HistoryEntry(
            role="assistant",
            tool_calls=[CALL],
            provider=provider,
            model="an-older-model",
            provider_payload=payload,
        ),
        HistoryEntry(role="tool_results", results=[RESULT]),
    ]
    run(provider, history)
    request = json.dumps(sdk["requests"][0])
    assert "sig" not in request and "rs_1" not in request
    assert "call_1" in request  # the neutral replay still names the resulted call
