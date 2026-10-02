"""The Gemini branch of llm.complete: request shape, parsing, replay, images, errors (spec §7.1)."""

import asyncio
import base64

import pytest

from app.project_agent import llm
from app.project_agent.history import HistoryEntry, LlmError, ToolCall, ToolResult, ToolSpec

genai = pytest.importorskip("google.genai")
from google.genai import errors, types  # noqa: E402

TOOLS = [
    ToolSpec("render", "Render the model.", {"type": "object", "properties": {"views": {"type": "array"}}})
]


class FakeModels:
    def __init__(self, state):
        self.state = state

    async def generate_content(self, *, model, contents, config):
        self.state["requests"].append({"model": model, "contents": contents, "config": config})
        if self.state.get("error"):
            raise self.state["error"]
        return self.state["response"]


class FakeClient:
    def __init__(self, state, **kwargs):
        state["clients"].append(kwargs)
        self.aio = type("Aio", (), {"models": FakeModels(state)})()


def response(parts, finish="STOP", usage=(10, 5)):
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=parts), finish_reason=finish)],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=usage[0], candidates_token_count=usage[1]
        ),
    )


@pytest.fixture
def state(monkeypatch):
    st = {
        "requests": [],
        "clients": [],
        "error": None,
        "response": response([types.Part.from_text(text="hello")]),
    }
    monkeypatch.setattr(genai, "Client", lambda **kw: FakeClient(st, **kw))
    return st


def call(history, tools=TOOLS):
    return asyncio.run(
        llm.complete("gemini", api_key="k", model="gemini-x", system="sys", history=history, tools=tools)
    )


def test_request_shape(state):
    call([HistoryEntry(role="user", text="build it")])
    req = state["requests"][0]
    assert req["model"] == "gemini-x"
    assert req["config"].system_instruction == "sys"
    assert [f.name for f in req["config"].tools[0].function_declarations] == ["render"]
    assert req["contents"][0].role == "user" and req["contents"][0].parts[0].text == "build it"


def test_function_call_is_parsed_and_payload_replays(state):
    state["response"] = response(
        [types.Part(function_call=types.FunctionCall(id="c1", name="render", args={"views": ["iso"]}))]
    )
    reply = call([HistoryEntry(role="user", text="go")])
    assert reply.tool_calls == [ToolCall(id="c1", name="render", input={"views": ["iso"]})]
    assert reply.usage == {"input_tokens": 10, "output_tokens": 5}
    img = base64.b64encode(b"\xff\xd8jpeg").decode()
    history = [
        HistoryEntry(role="user", text="go"),
        HistoryEntry(
            role="assistant",
            tool_calls=list(reply.tool_calls),
            provider="gemini",
            model="gemini-x",
            provider_payload=reply.provider_payload,
        ),
        HistoryEntry(role="tool_results", results=[ToolResult("c1", "render", "ok", image_jpeg_b64=img)]),
    ]
    call(history)
    contents = state["requests"][-1]["contents"]
    assert contents[1].parts[0].function_call.name == "render"  # replayed as sent
    fr = contents[2].parts[0].function_response
    assert fr.name == "render" and fr.id == "c1" and fr.response == {"result": "ok"}
    assert contents[2].parts[1].inline_data.mime_type == "image/jpeg"


def test_error_result_is_marked(state):
    history = [
        HistoryEntry(role="user", text="go"),
        HistoryEntry(role="assistant", tool_calls=[ToolCall("c1", "render", {})]),
        HistoryEntry(role="tool_results", results=[ToolResult("c1", "render", "bad view", is_error=True)]),
    ]
    call(history)
    assert state["requests"][-1]["contents"][2].parts[0].function_response.response == {"error": "bad view"}


@pytest.mark.parametrize("finish,message", [("SAFETY", llm._REFUSED), ("MAX_TOKENS", llm._TRUNCATED)])
def test_finish_reasons(state, finish, message):
    state["response"] = response([types.Part.from_text(text="x")], finish=finish)
    with pytest.raises(LlmError) as e:
        call([HistoryEntry(role="user", text="go")])
    assert e.value.message == message


@pytest.mark.parametrize(
    "code,message",
    [(429, llm._RATE_LIMITED), (401, llm._KEY_REJECTED), (403, llm._KEY_REJECTED), (500, llm._FAILED)],
)
def test_errors_are_fixed_text(state, code, message):
    state["error"] = errors.APIError(code, {"error": {"message": "secret detail sk-123"}})
    with pytest.raises(LlmError) as e:
        call([HistoryEntry(role="user", text="go")])
    assert e.value.message == message and "sk-123" not in e.value.message
