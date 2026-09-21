import asyncio
import json
from types import SimpleNamespace

import pytest

BODY = {"provider": "openai", "messages": [{"role": "user", "content": "Detect cranes"}]}
PLAN = {"name": "Site", "classes": ["crane"], "starter_model_key": "yolo11n",
        "image_guidance": "Use varied views.", "labeling_query": "Find cranes"}


@pytest.fixture
def sdk(monkeypatch):
    captured = {}
    state = {"result": {"message": "Review this plan", "plan": PLAN}, "error": None,
             "status": "completed", "stop_reason": "end_turn", "refusal": False}

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs
            self.responses = self.messages = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def create(self, **kwargs):
            captured["request"] = kwargs
            if state["error"]:
                raise state["error"]
            raw = json.dumps(state["result"])
            return SimpleNamespace(output_text=raw, status=state["status"],
                output=[SimpleNamespace(type="refusal" if state["refusal"] else "message")],
                stop_reason=state["stop_reason"], content=[SimpleNamespace(type="text", text=raw)])

    import anthropic
    import openai
    monkeypatch.setattr(openai, "AsyncOpenAI", FakeClient)
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeClient)
    return captured, state


def test_agent_requires_auth_and_key(client, anon):
    assert anon.post("/api/v1/agent/chat", json=BODY).status_code == 401
    assert client.post("/api/v1/agent/chat", json=BODY).status_code == 409


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_agent_structured_plan_and_budgets(client, app, sdk, provider):
    captured, _ = sdk
    app.state.keys.set(provider, "secret-test-key")
    app.state.provider_config.update(provider, model_name="configured-model")
    response = client.post("/api/v1/agent/chat", json={**BODY, "provider": provider, "plan": PLAN})
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Review this plan", "plan": PLAN,
                               "model_name": "configured-model"}
    assert captured["client"] == {"api_key": "secret-test-key", "timeout": 45, "max_retries": 0}
    call = captured["request"]
    assert call["model"] == "configured-model"
    assert "tools" not in call
    assert "secret-test-key" not in json.dumps(call)
    if provider == "openai":
        assert call["max_output_tokens"] == 4000
        assert call["text"]["format"]["strict"] is True
        assert call["store"] is False
    else:
        assert call["max_tokens"] == 4000
        schema = call["output_config"]["format"]["schema"]
        assert "maxLength" not in json.dumps(schema)
        assert "maxItems" not in json.dumps(schema)


@pytest.mark.parametrize("messages", [[], [{"role": "system", "content": "x"}],
    [{"role": "user", "content": "x" * 2001}], [{"role": "user", "content": " "}],
    [{"role": "user", "content": "x"}] * 13])
def test_agent_rejects_invalid_history(client, messages):
    expected = 409 if messages == [{"role": "user", "content": " "}] else 422
    assert client.post("/api/v1/agent/chat", json={**BODY, "messages": messages}).status_code == expected


@pytest.mark.parametrize("patch", [{"classes": ["crane", "crane"]}, {"classes": [" "]},
    {"starter_model_key": "../../bad"}, {"classes": ["x"] * 33}, {"name": "x" * 121}])
def test_agent_rejects_invalid_input_plan(client, patch):
    response = client.post("/api/v1/agent/chat", json={**BODY, "plan": {**PLAN, **patch}})
    assert response.status_code == (409 if patch.get("classes") in (["crane", "crane"], [" "]) else 422)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("failure", ["error", "refusal", "truncated", "bad_plan", "oversized"])
def test_agent_sanitizes_failures(client, app, sdk, provider, failure, caplog):
    _, state = sdk
    app.state.keys.set(provider, "secret-test-key")
    if failure == "error":
        state["error"] = RuntimeError("secret-test-key confidential provider payload")
    elif failure == "refusal":
        state["refusal"] = True
        state["stop_reason"] = "refusal"
    elif failure == "truncated":
        state["status"] = "incomplete"
        state["stop_reason"] = "max_tokens"
    elif failure == "bad_plan":
        state["result"]["plan"] = {**PLAN, "starter_model_key": "bad"}
    else:
        state["result"]["message"] = "x" * 4001
    response = client.post("/api/v1/agent/chat", json={**BODY, "provider": provider})
    assert response.status_code == 502, response.text
    assert "secret-test-key" not in response.text + caplog.text
    assert "confidential" not in response.text + caplog.text


def test_agent_can_ask_clarification(client, app, sdk):
    sdk[1]["result"] = {"message": "Which objects?", "plan": None}
    app.state.keys.set("openai", "secret-test-key")
    response = client.post("/api/v1/agent/chat", json=BODY)
    assert response.status_code == 200
    assert response.json()["plan"] is None


def test_agent_limits_concurrency_and_releases_cancelled_slots(app, monkeypatch):
    from app.agent import service
    from app.agent.schemas import AgentChatRequest, AgentOutput
    from app.errors import AppError

    app.state.keys.set("openai", "secret-test-key")

    async def run():
        entered = 0
        both_started = asyncio.Event()
        release = asyncio.Event()

        async def blocked(*args):
            nonlocal entered
            entered += 1
            if entered == 2:
                both_started.set()
            await release.wait()
            return AgentOutput(message="Ready", plan=None)

        monkeypatch.setattr(service, "_call", blocked)
        body = AgentChatRequest.model_validate(BODY)

        async def chat():
            return await service.chat(body, app.state.keys, app.state.provider_config)

        first = asyncio.create_task(chat())
        second = asyncio.create_task(chat())
        await asyncio.wait_for(both_started.wait(), timeout=2)
        with pytest.raises(AppError) as busy:
            await chat()
        assert busy.value.status == 409
        assert busy.value.code == "agent_busy"
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        assert (await second).message == "Ready"
        assert (await chat()).message == "Ready"

    asyncio.run(run())


def test_agent_deadline_sanitizes_and_releases_slot(app, monkeypatch):
    from app.agent import service
    from app.agent.schemas import AgentChatRequest, AgentOutput
    from app.errors import AppError

    app.state.keys.set("openai", "secret-test-key")
    monkeypatch.setattr(service, "TIMEOUT_SECONDS", 0.01)

    async def stalled(*args):
        await asyncio.Event().wait()

    async def ready(*args):
        return AgentOutput(message="Ready", plan=None)

    async def run():
        body = AgentChatRequest.model_validate(BODY)
        monkeypatch.setattr(service, "_call", stalled)
        with pytest.raises(AppError) as timeout:
            await service.chat(body, app.state.keys, app.state.provider_config)
        assert timeout.value.status == 502
        monkeypatch.setattr(service, "_call", ready)
        assert (await service.chat(body, app.state.keys, app.state.provider_config)).message == "Ready"

    asyncio.run(run())

