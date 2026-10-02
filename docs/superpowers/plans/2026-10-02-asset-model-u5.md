# Asset model U5 — the build agent: run job, tools, Gemini, runs API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Build with AI" works end to end. A background job drives Claude, OpenAI or Gemini through the asset-model tools, writes a version at the end (or a draft when it stops early), and the runs API lets the UI start, watch and stop it.

**Architecture:**
- `project_agent/llm.complete` gains three optional, backwards-compatible arguments and one new field:
  - `effort`
  - `cache` (Anthropic automatic prompt caching)
  - a Gemini branch
  - `ModelReply.usage`, filled in by every adapter
- `app/asset_models/agent/` holds:
  - `tools.py`: one class per tool over a `RunContext` that owns the working spec, the cloud samples and the step thumbnails
  - `prompt.py`
  - `runner.py`: the `asset_model_run` job. It is a synchronous loop that calls the async `complete` through a small cancellable bridge, keeps an append-only history, and enforces the call, token, image and time budgets.
- `runs.py` replaces U3's run stubs. `/providers` switches to `KeyedProviderName` so a Gemini key can be stored and tested.

**Tech Stack:** anthropic (existing), openai (existing), google-genai (new), FastAPI, pytest with a scripted fake model.

**Spec:** §7 (as amended in the index: 3 M token budget, 40 images, append-only history, working.json checkpoint, `comparison`, `get_spec`). Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** U1, U3 and U4 merged. U2 is optional: if U2 hasn't merged, Task 3 registers `render` and `compare_to_cloud` behind an import guard, and its tests for those two tools are skipped with `pytest.importorskip("app.asset_models.raster")`. Rebase onto `main` once U2 lands and remove the skip. **Worktree:** `scripts\start-task.ps1 -Name am-u5`. This unit adds a package (`google-genai`): use an overlay venv as in U1.

---

### Task 1: `llm.complete` — usage, effort, caching, Gemini

**Files:**
- Modify: `backend/requirements.txt`, `backend/requirements-lock.txt` (add `google-genai`), `backend/kestrel_backend.spec` (`collect_submodules("google.genai")`, with a comment)
- Modify: `backend/app/project_agent/history.py` (`ModelReply.usage`)
- Modify: `backend/app/project_agent/llm.py`
- Test: `backend/tests/test_project_agent_llm.py` (extend), `backend/tests/test_llm_gemini.py` (new)

**Interfaces:**
- Produces:
  - `ModelReply(text, tool_calls, provider_payload=None, usage: dict | None = None)`, where usage is `{"input_tokens": int, "output_tokens": int}`
  - `complete(provider, *, api_key, model, system, history, tools, effort: str | None = None, cache: bool = False) -> ModelReply`
  - `provider == "gemini"` is accepted. The project agent's calls don't change: it passes neither new argument.

- [ ] **Step 1: Add the dependency in an overlay venv**

```powershell
cd .claude\worktrees\am-u5\backend
uv venv .venv-overlay --python 3.11 --system-site-packages
.\.venv-overlay\Scripts\python.exe -m pip install "google-genai==1.*"
.\.venv-overlay\Scripts\python.exe -c "from google.genai import types; import inspect; print(inspect.signature(types.FunctionDeclaration)); print([n for n in dir(types.Part) if n.startswith('from_')])"
```

Check that `FunctionDeclaration` accepts `parameters_json_schema`, and that `Part.from_function_response`, `Part.from_bytes` and `Part.from_text` exist. If one is missing in the installed version, use the equivalent field form (`types.Part(function_response=types.FunctionResponse(...))`) in Step 4. Add `google-genai  # Gemini for asset model runs (spec 2026-10-02 §7.1)` to `requirements.txt`, and its exact pin plus any new transitive pins that `pip install` added to `requirements-lock.txt`.

- [ ] **Step 2: Write the failing tests**

Extend `tests/test_project_agent_llm.py`. Its `sdk` fixture already fakes `anthropic.AsyncAnthropic` and `openai.AsyncOpenAI` and records the request kwargs. Make each fake response carry `usage` (Anthropic: `usage.input_tokens/output_tokens`; OpenAI: `usage.input_tokens/output_tokens`), then add:

```python
def test_usage_is_reported(sdk):
    reply = run("anthropic", HISTORY)
    assert reply.usage == {"input_tokens": sdk["anthropic"].usage.input_tokens,
                           "output_tokens": sdk["anthropic"].usage.output_tokens}


def test_effort_and_cache_reach_anthropic_only_when_asked(sdk):
    run("anthropic", HISTORY)
    plain = sdk["requests"][-1]
    assert "output_config" not in plain and "cache_control" not in plain
    asyncio.run(llm.complete("anthropic", api_key="k", model="m", system="s", history=HISTORY, tools=TOOLS,
                             effort="high", cache=True))
    asked = sdk["requests"][-1]
    assert asked["output_config"] == {"effort": "high"}
    assert asked["cache_control"] == {"type": "ephemeral"}
```

(Use the existing file's own names for the history and tools constants. If they're called something other than `HISTORY`/`TOOLS`, adapt.)

```python
# backend/tests/test_llm_gemini.py
"""The Gemini branch of llm.complete: request shape, parsing, replay, images, errors (spec §7.1)."""

import asyncio
import base64

import pytest

from app.project_agent import llm
from app.project_agent.history import HistoryEntry, LlmError, ToolCall, ToolResult, ToolSpec

genai = pytest.importorskip("google.genai")
from google.genai import errors, types  # noqa: E402

TOOLS = [ToolSpec("render", "Render the model.", {"type": "object", "properties": {"views": {"type": "array"}}})]


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
        usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=usage[0], candidates_token_count=usage[1]),
    )


@pytest.fixture
def state(monkeypatch):
    st = {"requests": [], "clients": [], "error": None,
          "response": response([types.Part.from_text(text="hello")])}
    monkeypatch.setattr(genai, "Client", lambda **kw: FakeClient(st, **kw))
    return st


def call(history, tools=TOOLS):
    return asyncio.run(llm.complete("gemini", api_key="k", model="gemini-x", system="sys", history=history, tools=tools))


def test_request_shape(state):
    call([HistoryEntry(role="user", text="build it")])
    req = state["requests"][0]
    assert req["model"] == "gemini-x"
    assert req["config"].system_instruction == "sys"
    assert [f.name for f in req["config"].tools[0].function_declarations] == ["render"]
    assert req["contents"][0].role == "user" and req["contents"][0].parts[0].text == "build it"


def test_function_call_is_parsed_and_payload_replays(state):
    state["response"] = response([types.Part(function_call=types.FunctionCall(id="c1", name="render", args={"views": ["iso"]}))])
    reply = call([HistoryEntry(role="user", text="go")])
    assert reply.tool_calls == [ToolCall(id="c1", name="render", input={"views": ["iso"]})]
    assert reply.usage == {"input_tokens": 10, "output_tokens": 5}
    img = base64.b64encode(b"\xff\xd8jpeg").decode()
    history = [
        HistoryEntry(role="user", text="go"),
        HistoryEntry(role="assistant", tool_calls=list(reply.tool_calls), provider="gemini", model="gemini-x",
                     provider_payload=reply.provider_payload),
        HistoryEntry(role="tool_results", results=[ToolResult("c1", "render", "ok", image_jpeg_b64=img)]),
    ]
    call(history)
    contents = state["requests"][-1]["contents"]
    assert contents[1].parts[0].function_call.name == "render"           # replayed as sent
    fr = contents[2].parts[0].function_response
    assert fr.name == "render" and fr.id == "c1" and fr.response == {"result": "ok"}
    assert contents[2].parts[1].inline_data.mime_type == "image/jpeg"


def test_error_result_is_marked(state):
    history = [HistoryEntry(role="user", text="go"),
               HistoryEntry(role="assistant", tool_calls=[ToolCall("c1", "render", {})]),
               HistoryEntry(role="tool_results", results=[ToolResult("c1", "render", "bad view", is_error=True)])]
    call(history)
    assert state["requests"][-1]["contents"][2].parts[0].function_response.response == {"error": "bad view"}


@pytest.mark.parametrize("finish,message", [("SAFETY", llm._REFUSED), ("MAX_TOKENS", llm._TRUNCATED)])
def test_finish_reasons(state, finish, message):
    state["response"] = response([types.Part.from_text(text="x")], finish=finish)
    with pytest.raises(LlmError) as e:
        call([HistoryEntry(role="user", text="go")])
    assert e.value.message == message


@pytest.mark.parametrize("code,message", [(429, llm._RATE_LIMITED), (401, llm._KEY_REJECTED),
                                          (403, llm._KEY_REJECTED), (500, llm._FAILED)])
def test_errors_are_fixed_text(state, code, message):
    state["error"] = errors.APIError(code, {"error": {"message": "secret detail sk-123"}})
    with pytest.raises(LlmError) as e:
        call([HistoryEntry(role="user", text="go")])
    assert e.value.message == message and "sk-123" not in e.value.message
```

If `errors.APIError`'s constructor differs in the installed version, build the exception the way its own tests do. The assertion that matters is that the fixed text is used and the detail isn't.

- [ ] **Step 3: Run them to verify they fail**

Run: `.\.venv-overlay\Scripts\python.exe -m pytest tests/test_llm_gemini.py tests/test_project_agent_llm.py -v`
Expected: the new tests FAIL. `"Unknown provider."` for Gemini; `usage` is None; `output_config` is absent.

- [ ] **Step 4: Implement**

`history.py`:

```python
@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    provider_payload: Any = None
    usage: dict | None = None  # {"input_tokens", "output_tokens"} when the provider reports it
```

(Keep the existing field order and defaults. Only `usage` is new, and it's added last.)

`llm.py` changes:

```python
async def complete(provider: str, *, api_key: str, model: str, system: str, history: list[HistoryEntry],
                   tools: list[ToolSpec], effort: str | None = None, cache: bool = False) -> ModelReply:
    if provider == "anthropic":
        call = _anthropic
    elif provider == "openai":
        call = _openai
    elif provider == "gemini":
        call = _gemini
    else:
        raise LlmError("Unknown provider.")
    try:
        return await asyncio.wait_for(
            call(api_key=api_key, model=model, system=system, history=history, tools=tools, effort=effort, cache=cache),
            _DEADLINE_S,
        )
    except LlmError:
        raise
    except Exception as exc:  # noqa: BLE001 - every SDK failure becomes fixed text
        raise LlmError(_error_message(provider, exc)) from None
```

In `_error_message`, before the SDK import, add the Gemini branch:

```python
    if provider == "gemini":
        from google.genai import errors as gerrors

        if isinstance(exc, gerrors.APIError):
            if exc.code == 429:
                return _RATE_LIMITED
            if exc.code in (401, 403) or (exc.code == 400 and "API key" in str(getattr(exc, "message", ""))):
                return _KEY_REJECTED
        import httpx

        if isinstance(exc, httpx.TimeoutException):
            return _TOO_SLOW
        return _FAILED
```

`_replayable` accepts Gemini's dict payload:

```python
def _replayable(entry: HistoryEntry, provider: str, model: str) -> bool:
    return (entry.provider == provider and entry.model == model
            and isinstance(entry.provider_payload, dict if provider == "gemini" else list))
```

`_anthropic` gets `effort` and `cache`, and reports usage:

```python
async def _anthropic(*, api_key, model, system, history, tools, effort=None, cache=False) -> ModelReply:
    from anthropic import AsyncAnthropic

    extra: dict = {}
    if effort:
        extra["output_config"] = {"effort": effort}
    if cache:
        extra["cache_control"] = {"type": "ephemeral"}  # automatic caching of the growing prefix
    async with AsyncAnthropic(api_key=api_key, timeout=MODEL_TIMEOUT_S, max_retries=0) as client:
        response = await client.messages.create(
            model=model, system=system, messages=_anthropic_messages(history, model),
            tools=[{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in tools],
            max_tokens=MAX_OUTPUT_TOKENS, **extra,
        )
    # ... existing stop_reason checks and parsing unchanged ...
    usage = {"input_tokens": int(getattr(response.usage, "input_tokens", 0) or 0)
             + int(getattr(response.usage, "cache_read_input_tokens", 0) or 0)
             + int(getattr(response.usage, "cache_creation_input_tokens", 0) or 0),
             "output_tokens": int(getattr(response.usage, "output_tokens", 0) or 0)}
    return ModelReply(text="\n\n".join(texts), tool_calls=calls, provider_payload=payload, usage=usage)
```

`_openai` takes `effort=None, cache=False` and ignores both. OpenAI caches automatically, and effort maps to `reasoning={"effort": effort}` only when given: add `**({"reasoning": {"effort": effort}} if effort else {})` to `responses.create`. Usage comes from `result.usage.input_tokens/output_tokens`.

The Gemini adapter:

```python
async def _gemini(*, api_key, model, system, history, tools, effort=None, cache=False) -> ModelReply:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=MODEL_TIMEOUT_S * 1000))
    config = types.GenerateContentConfig(
        system_instruction=system,
        tools=[types.Tool(function_declarations=[
            types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.input_schema)
            for t in tools])] if tools else None,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    response = await client.aio.models.generate_content(model=model, contents=_gemini_contents(history, model, types),
                                                        config=config)
    cand = response.candidates[0] if response.candidates else None
    if cand is None or cand.content is None:
        raise LlmError(_REFUSED)
    finish = str(getattr(cand.finish_reason, "value", cand.finish_reason) or "")
    if finish in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"):
        raise LlmError(_REFUSED)
    if finish == "MAX_TOKENS":
        raise LlmError(_TRUNCATED)
    texts, calls = [], []
    for i, part in enumerate(cand.content.parts or []):
        if part.function_call is not None:
            fc = part.function_call
            calls.append(ToolCall(id=fc.id or f"gcall_{i}", name=fc.name, input=_as_object(dict(fc.args or {}))))
        elif part.text and not getattr(part, "thought", False):
            texts.append(part.text)
    um = response.usage_metadata
    usage = {"input_tokens": int(getattr(um, "prompt_token_count", 0) or 0),
             "output_tokens": int(getattr(um, "candidates_token_count", 0) or 0)
             + int(getattr(um, "thoughts_token_count", 0) or 0)}
    payload = cand.content.model_dump(mode="json", exclude_none=True)  # keeps thought signatures for replay
    return ModelReply(text="\n\n".join(texts), tool_calls=calls, provider_payload=payload, usage=usage)


def _gemini_contents(history, model, types) -> list:
    contents = []
    for entry in history:
        if entry.role == "user":
            contents.append(types.Content(role="user", parts=[types.Part.from_text(text=entry.text or _NO_TEXT)]))
        elif entry.role == "assistant":
            if _replayable(entry, "gemini", model):
                contents.append(types.Content.model_validate(entry.provider_payload))
                continue
            parts = [types.Part.from_text(text=entry.text)] if entry.text else []
            parts += [types.Part(function_call=types.FunctionCall(
                id=None if c.id.startswith("gcall_") else c.id, name=c.name, args=c.input)) for c in entry.tool_calls]
            contents.append(types.Content(role="model", parts=parts or [types.Part.from_text(text=_NO_TEXT)]))
        else:  # tool_results
            parts, images = [], []
            for r in entry.results:
                body = {"error": r.content or _NO_TEXT} if r.is_error else {"result": r.content or _NO_TEXT}
                parts.append(types.Part(function_response=types.FunctionResponse(
                    id=None if r.call_id.startswith("gcall_") else r.call_id, name=r.name, response=body)))
                if r.image_jpeg_b64:
                    images.append(types.Part.from_bytes(data=base64.b64decode(r.image_jpeg_b64), mime_type="image/jpeg"))
            contents.append(types.Content(role="user", parts=parts + images))
    return contents
```

Add `import base64` at the top of `llm.py`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.\.venv-overlay\Scripts\python.exe -m pytest tests/test_llm_gemini.py tests/test_project_agent_llm.py tests/test_project_agent_runner.py -v`
Expected: PASS. The project agent's runner tests are unchanged and still green.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/requirements-lock.txt backend/kestrel_backend.spec backend/app/project_agent/history.py backend/app/project_agent/llm.py backend/tests/test_llm_gemini.py backend/tests/test_project_agent_llm.py
git commit -m "feat(llm): usage, effort, prompt caching and a Gemini adapter in complete()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Providers — `KeyedProviderName`, Gemini key and test, default Opus model

**Files:**
- Modify: `contract/openapi.yaml`: the `/api/v1/providers` operations' `{provider}` parameter, and the provider list item's `name`, change from `ProviderName` to `KeyedProviderName`. Detection request bodies keep `ProviderName`.
- Regenerate: `contract/client/schema.d.ts`
- Modify: `backend/app/providers/schemas.py` (add `KeyedProviderName = Literal["openai", "anthropic", "gemini"]`; `ProviderOut.name: KeyedProviderName`)
- Modify: `backend/app/providers/router.py` (path params typed `KeyedProviderName`; `/test` branch for Gemini)
- Modify: `backend/app/providers/config.py` (`DEFAULTS["gemini"]`, `DEFAULTS["anthropic"]` → `claude-opus-5-5`)
- Create: `backend/app/providers/gemini_ping.py`
- Modify: `frontend/src/api/providers.ts` (`LABELS` keyed by `KeyedProviderName`, adding `gemini: "Google Gemini"`), `frontend/src/test/fixtures.ts` (the provider list fixture gains a Gemini row), `frontend/src/api/providers.test.ts`, `frontend/src/api/useProviders.test.tsx` (expected lists gain `"gemini"`), `frontend/src/settings/ProvidersSection.tsx` (copy: "OpenAI, Anthropic and Google Gemini API keys …")
- Test: `backend/tests/test_providers_router.py` (extend)

**Interfaces:**
- Produces: `GET /api/v1/providers` lists `openai`, `anthropic`, `gemini`; `PUT/DELETE /providers/gemini/key`; `POST /providers/gemini/test` → `ProviderTestResult`.

- [ ] **Step 1: Write the failing backend tests (append)**

```python
def test_gemini_is_listed_with_a_default_model(client):
    names = [p["name"] for p in client.get("/api/v1/providers").json()["items"]]
    assert names == ["openai", "anthropic", "gemini"]


def test_anthropic_default_model_is_current_opus(client):
    anth = next(p for p in client.get("/api/v1/providers").json()["items"] if p["name"] == "anthropic")
    assert anth["model_name"] == "claude-opus-5-5"


def test_gemini_key_round_trip_and_test(client, app, monkeypatch):
    assert client.put("/api/v1/providers/gemini/key", json={"api_key": "g-secret"}).status_code == 204
    assert app.state.keys.get("gemini") == "g-secret"
    import app.providers.gemini_ping as gp

    monkeypatch.setattr(gp, "ping", lambda key, model: "pong")
    r = client.post("/api/v1/providers/gemini/test").json()
    assert r["ok"] is True
```

Adapt the list key (`items`) and the test result fields to what `ProviderList` and `ProviderTestResult` actually are in `providers/schemas.py`.

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_providers_router.py -v`
Expected: the new tests FAIL (Gemini returns 422/404).

- [ ] **Step 3: Implement**

`config.py`:

```python
DEFAULTS: dict[str, ProviderConfig] = {
    "openai": ProviderConfig("openai", "gpt-5"),
    "anthropic": ProviderConfig("anthropic", "claude-opus-5-5"),
    # Gemini serves asset model runs only (spec 2026-10-02 §7.1); detection does not offer it.
    "gemini": ProviderConfig("gemini", "gemini-2.5-pro"),
}
```

Before committing, confirm the current Gemini Pro model id with one live call (`google.genai.Client(api_key=...).models.list()`), run by the operator with their key, and use that id. The operator can always change it in App settings.

```python
# backend/app/providers/gemini_ping.py
"""`POST /providers/gemini/test`: one tiny generate call, mapped to fixed text by llm.complete."""

from __future__ import annotations

import asyncio

from app.project_agent import llm
from app.project_agent.history import HistoryEntry


def ping(api_key: str, model: str) -> str:
    reply = asyncio.run(llm.complete("gemini", api_key=api_key, model=model, system="Reply with the word: ok",
                                     history=[HistoryEntry(role="user", text="ok?")], tools=[]))
    return reply.text[:40]
```

In `router.py`'s `/test` handler, before `factory.cloud_provider(...)`:

```python
    if provider == "gemini":
        key = keys.get("gemini")
        if not key:
            return ProviderTestResult(ok=False, message="No API key is stored for Google Gemini.", model_name=cfg.model_name)
        try:
            gemini_ping.ping(key, cfg.model_name)
        except LlmError as e:
            return ProviderTestResult(ok=False, message=e.message, model_name=cfg.model_name)
        finally:
            del key
        return ProviderTestResult(ok=True, message="Google Gemini answered.", model_name=cfg.model_name)
```

Match the existing handler's variable names, and keep its sync/async form. If the handler is `async def`, run `ping` in `run_in_threadpool`, because `ping` calls `asyncio.run`.

- [ ] **Step 4: Update the contract and the frontend in the same commit**

Edit the `/providers` operations as listed under **Files**, then run `pnpm -C contract check` (lint, generate, diff), and commit the regenerated `schema.d.ts`. Then:
- `frontend/src/api/providers.ts`: `import type { KeyedProviderName } from "@contract/client";` and `const LABELS: Record<KeyedProviderName, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini" };`. Retype the functions that take a provider name as `KeyedProviderName`.
- Add the Gemini row to the provider fixture, and `"gemini"` to the two tests' expected lists.
- `ProvidersSection.tsx` copy as listed.

Run: `pnpm -C frontend lint; pnpm -C frontend test; pnpm -C frontend build`. Expected: green. The project agent's and setup agent's provider pickers keep `ProviderName` and still show only OpenAI and Anthropic. That's intended: Gemini is offered for asset model runs only.

- [ ] **Step 5: Run backend tests, then commit**

Run: `$PY -m pytest tests/test_providers_router.py tests/test_contract.py -v`
Expected: PASS

```bash
git add contract/openapi.yaml contract/client/schema.d.ts backend/app/providers/schemas.py backend/app/providers/router.py backend/app/providers/config.py backend/app/providers/gemini_ping.py backend/tests/test_providers_router.py frontend/src/api/providers.ts frontend/src/test/fixtures.ts frontend/src/api/providers.test.ts frontend/src/api/useProviders.test.tsx frontend/src/settings/ProvidersSection.tsx
git commit -m "feat(providers): Google Gemini key and test; default Anthropic model claude-opus-5-5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Run tools (`agent/tools.py`)

**Files:**
- Create: `backend/app/asset_models/agent/__init__.py`, `backend/app/asset_models/agent/tools.py`
- Test: `backend/tests/test_asset_model_agent_tools.py`

**Interfaces:**
- Consumes: U1 (`AssetSpec`, `Part`, `validate`, `build_meshes`), U2 (`render`, `View`, `grid`, `compare`, `CloudTransform`, `cloud_to_asset`), U3 (`store.run_dir`), U4 (`look.drawing.*`, `look.cloud.*`, `look.photo.photo_view`, `LookError`, `LookImage`).
- Produces:
  - `RunContext(handle, model_id, run_id, sources: list[dict], spec: AssetSpec, samples: dict[str, CloudSample])`, with `.run_dir: Path`, `.images_sent: int`, `.comparison: dict | None`, `.finished: dict | None`, `.save_working() -> None`
  - `ToolOut(text: str, summary: str, ok: bool = True, image: bytes | None = None, phase: str = "reading")` (`image` is a JPEG)
  - `TOOLS: dict[str, Tool]`; `tool_specs() -> list[ToolSpec]`
  - `run_tool(ctx: RunContext, name: str, raw_args: dict) -> ToolOut`: never raises; bad arguments, `LookError` and validation failures all become `ok=False` outputs whose text names the problem
  - `MAX_IMAGES = 40`, `MAX_TEXT = 8000`
  - Tool names: `list_sources`, `drawing_view`, `drawing_text`, `cloud_slice`, `cloud_fit`, `photo_view`, `get_spec`, `set_asset`, `upsert_parts`, `remove_parts`, `render`, `compare_to_cloud`, `validate`, `finish`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_agent_tools.py
"""Agent tools over a RunContext (spec §7.3; Review Focus 3)."""

import json

import numpy as np
import pytest

from app.asset_models.agent.tools import MAX_IMAGES, RunContext, run_tool, tool_specs
from app.asset_models.look.cloud import CloudSample
from app.asset_models.spec import AssetSpec

SHELL = {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder",
         "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "assumed"}}


@pytest.fixture
def ctx(handle, tmp_path):
    c = RunContext(handle=handle, model_id="m1", run_id="r1", sources=[], spec=AssetSpec(), samples={})
    c.run_dir = tmp_path  # tests write thumbs/overlays here
    return c


def test_specs_are_complete_and_strict():
    names = {s.name for s in tool_specs()}
    assert names == {"list_sources", "drawing_view", "drawing_text", "cloud_slice", "cloud_fit", "photo_view",
                     "get_spec", "set_asset", "upsert_parts", "remove_parts", "render", "compare_to_cloud",
                     "validate", "finish"}


def test_upsert_then_get_spec(ctx):
    out = run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    assert out.ok and "1 part" in out.text and out.phase == "building"
    assert [p.id for p in ctx.spec.parts] == ["shell"]
    spec = json.loads(run_tool(ctx, "get_spec", {}).text)
    assert spec["parts"][0]["id"] == "shell"
    assert (ctx.run_dir / "working.json").exists()


def test_upsert_replaces_by_id(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    taller = {**SHELL, "params": {"id": 4000, "thickness": 8, "height": 9000}}
    run_tool(ctx, "upsert_parts", {"parts": [taller]})
    assert len(ctx.spec.parts) == 1 and ctx.spec.parts[0].params["height"] == 9000


def test_invalid_upsert_is_a_tool_error_and_loop_continues(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    orphan = {"id": "N1", "name": "N1", "group": "Nozzle", "shape": "nozzle",
              "params": {"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
              "placement": {"host": "ghost", "bearing_deg": 0, "elevation_mm": 100}, "source": {"kind": "assumed"}}
    out = run_tool(ctx, "upsert_parts", {"parts": [orphan]})
    assert not out.ok and "host_missing" in out.text and "N1" in out.text
    assert [p.id for p in ctx.spec.parts] == ["shell"]           # unchanged
    bad = run_tool(ctx, "upsert_parts", {"parts": [{"id": "x", "shape": "torus"}]})
    assert not bad.ok and "torus" in bad.text
    junk = run_tool(ctx, "upsert_parts", {"partz": []})
    assert not junk.ok
    unknown = run_tool(ctx, "make_coffee", {})
    assert not unknown.ok and "unknown tool" in unknown.text.lower()


def test_remove_parts(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    out = run_tool(ctx, "remove_parts", {"ids": ["shell", "nope"]})
    assert out.ok and ctx.spec.parts == [] and "nope" in out.text


def test_render_returns_one_image_and_counts_it(ctx):
    pytest.importorskip("app.asset_models.raster")
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    out = run_tool(ctx, "render", {"views": ["iso", "front"]})
    assert out.ok and out.image[:2] == b"\xff\xd8" and out.phase == "checking"
    assert ctx.images_sent == 1


def test_image_budget_drops_images_not_the_call(ctx):
    pytest.importorskip("app.asset_models.raster")
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    ctx.images_sent = MAX_IMAGES
    out = run_tool(ctx, "render", {"views": ["iso"]})
    assert out.ok and out.image is None and "image budget" in out.text


def test_compare_writes_overlay_and_comparison(ctx):
    pytest.importorskip("app.asset_models.compare")
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    rng = np.random.default_rng(0)
    a = rng.uniform(0, 2 * np.pi, 20000)
    xyz = np.column_stack([100 + 2.004 * np.cos(a), 200 + 2.004 * np.sin(a), 5 + rng.uniform(0.5, 7.5, 20000)])
    ctx.samples["c1"] = CloudSample(np.zeros(3), xyz.astype(np.float32), 20000)
    out = run_tool(ctx, "compare_to_cloud", {"cloud_id": "c1", "origin": [100, 200, 5], "yaw_deg": 0})
    assert out.ok, out.text
    assert ctx.comparison["cloud_id"] == "c1"
    assert ctx.comparison["parts"][0]["median_mm"] == pytest.approx(4, abs=1.5)
    assert (ctx.run_dir / "overlay_c1.bin").stat().st_size % 12 == 0


def test_finish_records_summary(ctx):
    out = run_tool(ctx, "finish", {"summary": "Built the shell.", "open_questions": ["N7 bearing?"]})
    assert out.ok and ctx.finished == {"summary": "Built the shell.", "open_questions": ["N7 bearing?"]}


def test_cloud_tools_need_a_listed_cloud(ctx):
    out = run_tool(ctx, "cloud_slice", {"cloud_id": "zzz", "axis": "z", "at_m": 1, "thickness_m": 0.1})
    assert not out.ok and "not one of this run's sources" in out.text
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_agent_tools.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement**

```python
# backend/app/asset_models/agent/tools.py
"""The build agent's tools (spec 2026-10-02 §7.3). App code only; every read bounded; never raises.

A tool returns text for the model, a short app-written summary for the run's step list, an optional
JPEG, and the phase it belongs to (reading / building / checking).
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.asset_models import store
from app.asset_models.look import LookError, LookImage
from app.asset_models.look.cloud import CloudSample, cloud_fit, cloud_slice
from app.asset_models.spec import AssetInfo, AssetSpec, Part
from app.asset_models.validate import validate
from app.project_agent.history import ToolSpec
from app.project_agent.tools import _clean_schema

MAX_IMAGES = 40
MAX_TEXT = 8000
OVERLAY_POINTS = 300_000
Region = Annotated[list[float], Field(min_length=4, max_length=4)]


@dataclass
class ToolOut:
    text: str
    summary: str
    ok: bool = True
    image: bytes | None = None
    phase: str = "reading"


@dataclass
class RunContext:
    handle: object
    model_id: str
    run_id: str
    sources: list[dict]
    spec: AssetSpec
    samples: dict[str, CloudSample]
    run_dir: Path | None = None
    images_sent: int = 0
    comparison: dict | None = None
    finished: dict | None = None
    _ids: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.run_dir is None:
            self.run_dir = store.run_dir(self.handle, self.model_id, self.run_id)

    def source_ids(self, kind: str) -> set[str]:
        return {s["id"] for s in self.sources if s["type"] == kind}

    def save_working(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.run_dir / "working.json.tmp"
        tmp.write_text(self.spec.model_dump_json(), encoding="utf-8")
        tmp.replace(self.run_dir / "working.json")


class _A(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _image(ctx: RunContext, img: LookImage | bytes, text: str, summary: str, phase: str) -> ToolOut:
    data = img.jpeg if isinstance(img, LookImage) else img
    if ctx.images_sent >= MAX_IMAGES:
        return ToolOut(text + "\n(The image budget for this run is used up, so no image was attached.)", summary, phase=phase)
    ctx.images_sent += 1
    return ToolOut(text, summary, image=data, phase=phase)


def _png_to_jpeg(png: bytes) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.open(io.BytesIO(png)).convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


# ------------------------------------------------------------------ look
class NoArgs(_A):
    pass


class ListSources:
    name, Args = "list_sources", NoArgs
    description = "List the drawings, point clouds and photos chosen for this run, with ids and basic facts."

    def run(self, ctx, a):
        lines = [f"{s['type']} {s['id']}: {s.get('label', '')} {s.get('facts', '')}".strip() for s in ctx.sources]
        return ToolOut("\n".join(lines) or "No sources.", f"Listed {len(ctx.sources)} sources")


class DrawingViewArgs(_A):
    drawing_id: str
    region: Region | None = Field(None, description="[x0, y0, x1, y1] page fractions, (0,0) top-left")


class DrawingView:
    name, Args = "drawing_view", DrawingViewArgs
    description = "See a drawing page, or zoom into a region of it (fractions of the page). Image <= 1600 px."

    def run(self, ctx, a):
        from app.asset_models.look.drawing import drawing_view

        if a.drawing_id not in ctx.source_ids("drawing"):
            raise LookError("That drawing is not one of this run's sources.")
        img = drawing_view(ctx.handle, a.drawing_id, a.region)
        return _image(ctx, img, f"Drawing image {img.width}x{img.height}. {img.note}".strip(), "Looked at a drawing", "reading")


class DrawingText:
    name, Args = "drawing_text", DrawingViewArgs
    description = ("Exact text on a drawing (vector PDF or DXF) with positions as page fractions; use it for "
                   "dimensions, nozzle schedules and the title block. Empty for scans.")

    def run(self, ctx, a):
        from app.asset_models.look.drawing import drawing_text

        if a.drawing_id not in ctx.source_ids("drawing"):
            raise LookError("That drawing is not one of this run's sources.")
        r = drawing_text(ctx.handle, a.drawing_id, a.region)
        body = json.dumps(r.spans, separators=(",", ":"))
        extra = " (more spans exist - ask for a smaller region)" if r.truncated else ""
        return ToolOut((r.note + "\n" if r.note else "") + body + extra, f"Read {len(r.spans)} text spans")


class SliceArgs(_A):
    cloud_id: str
    axis: Literal["x", "y", "z"]
    at_m: float
    thickness_m: float = Field(gt=0, le=2)


def _sample(ctx, cloud_id) -> CloudSample:
    if cloud_id not in ctx.samples:
        raise LookError("That point cloud is not one of this run's sources.")
    return ctx.samples[cloud_id]


class CloudSlice:
    name, Args = "cloud_slice", SliceArgs
    description = ("A thin slab of a point cloud (cloud coordinates, metres, z up) as an image with axis ticks, "
                   "plus up to 5000 of its points.")

    def run(self, ctx, a):
        r = cloud_slice(_sample(ctx, a.cloud_id), a.axis, a.at_m, a.thickness_m)
        text = json.dumps({"in_slab": r.in_slab, "note": r.note, "points": r.points[:400]}, separators=(",", ":"))
        return _image(ctx, _png_to_jpeg(r.png), text, f"Sliced a cloud at {a.axis}={a.at_m:.2f} m", "reading")


class FitArgs(_A):
    cloud_id: str
    kind: Literal["circle", "cylinder_vertical", "plane"]
    region: Annotated[list[float], Field(min_length=6, max_length=6)] | None = Field(
        None, description="[xmin, ymin, zmin, xmax, ymax, zmax] in cloud coordinates")


class CloudFit:
    name, Args = "cloud_fit", FitArgs
    description = "Fit a circle (in plan), a vertical cylinder or a plane to the cloud points in a box."

    def run(self, ctx, a):
        r = cloud_fit(_sample(ctx, a.cloud_id), a.kind, a.region)
        return ToolOut(json.dumps(r, separators=(",", ":")), f"Fitted a {a.kind}")


class PhotoArgs(_A):
    image_id: str
    region: Region | None = None


class PhotoView:
    name, Args = "photo_view", PhotoArgs
    description = "See a photo, or zoom into a region of it (fractions). Image <= 1600 px."

    def run(self, ctx, a):
        from app.asset_models.look.photo import photo_view

        if a.image_id not in ctx.source_ids("image"):
            raise LookError("That photo is not one of this run's sources.")
        img = photo_view(ctx.handle, a.image_id, a.region)
        return _image(ctx, img, f"Photo {img.width}x{img.height}.", "Looked at a photo", "reading")


class GetSpecArgs(_A):
    start: int = Field(0, ge=0)


class GetSpec:
    name, Args = "get_spec", GetSpecArgs
    description = "The working model spec as JSON, paged by part index when long."

    def run(self, ctx, a):
        doc = ctx.spec.model_dump(mode="json", exclude_none=True)
        parts, out, end = doc["parts"][a.start:], [], a.start
        for p in parts:
            if len(json.dumps(out + [p])) > MAX_TEXT - 500:
                break
            out.append(p)
            end += 1
        more = f', "next_start": {end}' if end < len(doc["parts"]) else ""
        text = json.dumps({"asset": doc["asset"], "parts": out}, separators=(",", ":"))
        return ToolOut(text[:-1] + more + "}" if more else text, f"Read the spec ({len(out)} parts)")


# ------------------------------------------------------------------ build
class SetAssetArgs(AssetInfo):
    pass


class SetAsset:
    name, Args = "set_asset", SetAssetArgs
    description = "Set the asset block: tag, type, name, frame note, plant-to-true-north, title block attributes."

    def run(self, ctx, a):
        ctx.spec = ctx.spec.model_copy(update={"asset": AssetInfo.model_validate(a.model_dump())})
        ctx.save_working()
        return ToolOut("Asset block set.", "Set the asset details", phase="building")


class UpsertArgs(_A):
    parts: Annotated[list[dict], Field(min_length=1, max_length=200)]


def _issues_text(issues) -> str:
    return "\n".join(f"- {i.code} ({i.part_id}): {i.message}" for i in issues)


class UpsertParts:
    name, Args = "upsert_parts", UpsertArgs
    description = ("Add parts, or replace parts with the same id. Units mm and degrees; asset frame Y up, X plant "
                   "north, Z plant east. The whole call is rejected if any part is invalid.")

    def run(self, ctx, a):
        try:
            new = [Part.model_validate(p) for p in a.parts]
        except ValidationError as e:
            return ToolOut(f"Rejected, nothing changed:\n{_short(e)}", "Rejected invalid parts", ok=False, phase="building")
        by_id = {p.id: p for p in ctx.spec.parts}
        for p in new:
            by_id[p.id] = p
        order = [p.id for p in ctx.spec.parts] + [p.id for p in new if p.id not in {q.id for q in ctx.spec.parts}]
        candidate = ctx.spec.model_copy(update={"parts": [by_id[i] for i in order]})
        report = validate(candidate)
        if not report.ok:
            return ToolOut("Rejected, nothing changed:\n" + _issues_text(report.errors), "Rejected invalid parts",
                           ok=False, phase="building")
        ctx.spec = candidate
        ctx.save_working()
        warn = ("\nWarnings:\n" + _issues_text(report.warnings)) if report.warnings else ""
        n = len(new)
        return ToolOut(f"Saved {n} part{'s' if n != 1 else ''}; the model has {len(candidate.parts)}.{warn}",
                       f"Added or changed {n} part{'s' if n != 1 else ''}", phase="building")


class RemoveArgs(_A):
    ids: Annotated[list[str], Field(min_length=1, max_length=200)]


class RemoveParts:
    name, Args = "remove_parts", RemoveArgs
    description = "Remove parts by id."

    def run(self, ctx, a):
        gone = set(a.ids)
        missing = sorted(gone - {p.id for p in ctx.spec.parts})
        candidate = ctx.spec.model_copy(update={"parts": [p for p in ctx.spec.parts if p.id not in gone]})
        report = validate(candidate)
        if not report.ok:
            return ToolOut("Rejected, nothing changed (other parts depend on these):\n" + _issues_text(report.errors),
                           "Rejected a removal", ok=False, phase="building")
        ctx.spec = candidate
        ctx.save_working()
        note = f" Not found: {', '.join(missing)}." if missing else ""
        return ToolOut(f"The model has {len(candidate.parts)} parts.{note}", f"Removed {len(gone) - len(missing)} parts",
                       phase="building")


# ------------------------------------------------------------------ check
ViewName = Literal["iso", "front", "side", "top"] | Annotated[str, Field(pattern=r"^section@\d{1,3}(\.\d+)?$")]


class RenderArgs(_A):
    views: Annotated[list[ViewName], Field(min_length=1, max_length=4)]
    labels: bool = False
    highlight: list[str] = Field(default_factory=list)


class Render:
    name, Args = "render", RenderArgs
    description = ("Render the current model: iso, front (looking north), side (looking east), top (north up), "
                   "or section@<bearing> (cut through the axis, looking along that bearing). Up to 4 views.")

    def run(self, ctx, a):
        from app.asset_models.build import build_meshes
        from app.asset_models.raster import View, grid, render

        if not ctx.spec.parts:
            return ToolOut("The model has no parts yet.", "Nothing to render", ok=False, phase="checking")
        meshes = build_meshes(ctx.spec)
        groups = {p.id: p.group for p in ctx.spec.parts}
        imgs, titles = [], []
        for v in a.views:
            view = View("section", bearing_deg=float(v.split("@")[1])) if v.startswith("section@") else View(v)
            imgs.append(render(meshes, view, size=800 if len(a.views) > 1 else 1024, labels=a.labels,
                               groups=groups, highlight=set(a.highlight)))
            titles.append(v)
        sheet = grid(imgs, titles) if len(imgs) > 1 else imgs[0]
        buf = io.BytesIO()
        sheet.save(buf, "JPEG", quality=85)
        return _image(ctx, buf.getvalue(), f"Rendered {', '.join(titles)}.", f"Rendered {len(titles)} views", "checking")


class CompareArgs(_A):
    cloud_id: str
    origin: Annotated[list[float], Field(min_length=3, max_length=3, description="asset origin in cloud coordinates")]
    yaw_deg: float = Field(description="bearing of plant north, clockwise from the cloud's +Y")


class CompareToCloud:
    name, Args = "compare_to_cloud", CompareArgs
    description = "Distance from cloud points to the model, per part (median and p95 in mm), after placing the cloud."

    def run(self, ctx, a):
        from app.asset_models.build import build_meshes
        from app.asset_models.compare import CloudTransform, cloud_to_asset, compare

        if not ctx.spec.parts:
            return ToolOut("The model has no parts yet.", "Nothing to compare", ok=False, phase="checking")
        sample = _sample(ctx, a.cloud_id)
        t = CloudTransform(tuple(a.origin), a.yaw_deg)
        pts = cloud_to_asset(sample.points(), t)
        result = compare(build_meshes(ctx.spec), pts).as_dict()
        ctx.comparison = {"cloud_id": a.cloud_id, "transform": {"origin": list(a.origin), "yaw_deg": a.yaw_deg}, **result}
        rng = np.random.default_rng(5)
        keep = pts if len(pts) <= OVERLAY_POINTS else pts[np.sort(rng.choice(len(pts), OVERLAY_POINTS, replace=False))]
        ctx.run_dir.mkdir(parents=True, exist_ok=True)
        (ctx.run_dir / f"overlay_{a.cloud_id}.bin").write_bytes(keep.astype("<f4").tobytes())
        return ToolOut(json.dumps(result, separators=(",", ":")),
                       f"Compared with a cloud: median {result['overall']['median_mm']} mm", phase="checking")


class Validate:
    name, Args = "validate", NoArgs
    description = "Check the working spec for errors and warnings."

    def run(self, ctx, a):
        r = validate(ctx.spec)
        text = ("Errors:\n" + _issues_text(r.errors) + "\n" if r.errors else "") + (
            "Warnings:\n" + _issues_text(r.warnings) if r.warnings else "")
        return ToolOut(text or "No problems.", f"Validated: {len(r.errors)} errors, {len(r.warnings)} warnings",
                       phase="checking")


class FinishArgs(_A):
    summary: str = Field(max_length=4000)
    open_questions: Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=30)] = Field(default_factory=list)


class Finish:
    name, Args = "finish", FinishArgs
    description = "End the run: a short summary and honest open questions for the operator."

    def run(self, ctx, a):
        ctx.finished = {"summary": a.summary, "open_questions": list(a.open_questions)}
        return ToolOut("Finished.", "Finished", phase="done")


TOOLS = {t.name: t for t in (ListSources(), DrawingView(), DrawingText(), CloudSlice(), CloudFit(), PhotoView(),
                              GetSpec(), SetAsset(), UpsertParts(), RemoveParts(), Render(), CompareToCloud(),
                              Validate(), Finish())}


def tool_specs() -> list[ToolSpec]:
    return [ToolSpec(t.name, t.description, _clean_schema(t.Args.model_json_schema())) for t in TOOLS.values()]


def _short(e: ValidationError) -> str:
    return "\n".join(f"- {'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()[:20])


def run_tool(ctx: RunContext, name: str, raw_args: dict) -> ToolOut:
    tool = TOOLS.get(name)
    if tool is None:
        return ToolOut(f"Unknown tool {name!r}.", f"Called an unknown tool", ok=False)
    try:
        args = tool.Args.model_validate(raw_args)
    except ValidationError as e:
        return ToolOut(f"Bad arguments for {name}:\n{_short(e)}", f"Bad arguments for {name}", ok=False)
    try:
        out = tool.run(ctx, args)
    except LookError as e:
        return ToolOut(e.message, f"{name} could not run", ok=False)
    except Exception as e:  # noqa: BLE001 - a tool bug must not end the run; the type name only, never the text
        return ToolOut(f"{name} failed ({type(e).__name__}). Try different arguments.", f"{name} failed", ok=False)
    if len(out.text) > MAX_TEXT:
        out.text = out.text[:MAX_TEXT] + "\n(cut off)"
    return out
```

Notes:
- Each tool class needs `name`, `description` and `Args` as class attributes (as written).
- `_clean_schema` is imported from `project_agent.tools`, where it's a private helper. Promote it to a public name there (`clean_schema = _clean_schema`) in this task rather than importing a private one.
- `ViewName`'s union may produce a schema that `_clean_schema` doesn't flatten for Gemini. If the Gemini live test (Task 6) rejects it, change `views` to `list[str]` with a `pattern` covering both forms.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_agent_tools.py -v`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/asset_models/agent/__init__.py backend/app/asset_models/agent/tools.py backend/app/project_agent/tools.py backend/tests/test_asset_model_agent_tools.py
git commit -m "feat(asset-models): the build agent's tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The run job and prompt (`agent/runner.py`, `agent/prompt.py`), restart sweep

**Files:**
- Create: `backend/app/asset_models/agent/prompt.py`, `backend/app/asset_models/agent/runner.py`
- Modify: `backend/app/main.py` (after `app.state.agent_llm = agent_llm.complete`: `app.state.jobs.agent_llm = agent_llm.complete`, so jobs reach the model through the runner and tests can swap it)
- Modify: `backend/app/asset_models/startup.py` (runs)
- Test: `backend/tests/test_asset_model_run_job.py`

**Interfaces:**
- Consumes: `ctx.runner.keys`, `ctx.runner.agent_llm`, `service.add_version`, the Task 3 tools.
- Produces:
  - job type `asset_model_run`, params `{model_id, run_id}`, result `{run_id, version}`
  - `MAX_CALLS = 80`, `MAX_TOKENS = 3_000_000`, `MAX_SECONDS = 1200`, `EFFORT = "high"`
  - Run row updates: `phase`, `steps` (append), `usage`, `comparison`, then `state`/`stop_reason`/`summary`/`open_questions`/`version`/`ended_at`. The model's `live_run_id` is cleared and its status refreshed when the run ends.
  - Step thumbnails at `run_dir/step_<n>.png` (≤ 320 px) for steps that returned an image.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_run_job.py
"""The asset_model_run job with a scripted fake model (spec §7.2; Review Focus 3, 4)."""

import pytest

from app.asset_models import startup, store
from app.asset_models.agent import runner as R
from app.db.models import AssetModel, AssetModelRun
from app.jobs.cancellation import JobCancelled
from app.project_agent.history import ModelReply, ToolCall

SHELL = {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder",
         "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "assumed"}}


def reply(*calls, text="", usage=(100, 50)):
    return ModelReply(text=text, tool_calls=[ToolCall(f"c{i}", n, a) for i, (n, a) in enumerate(calls)],
                      provider_payload=None, usage={"input_tokens": usage[0], "output_tokens": usage[1]})


class FakeLlm:
    def __init__(self, script):
        self.script, self.calls = list(script), []

    async def __call__(self, provider, *, api_key, model, system, history, tools, effort=None, cache=False):
        self.calls.append({"history_len": len(history), "api_key": api_key, "effort": effort, "cache": cache})
        step = self.script.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


class Ctx:
    def __init__(self, handle, runner, params, cancel_at=None):
        self.project, self.runner, self.params, self.job_id = handle, runner, params, "job-run"
        self.published, self.n, self.cancel_at = [], 0, cancel_at

    def progress(self, *_a):
        pass

    def publish(self, t, p):
        self.published.append((t, p))

    def check_cancelled(self):
        self.n += 1
        if self.cancel_at and self.n >= self.cancel_at:
            raise JobCancelled()


@pytest.fixture
def seeded(handle, app):
    app.state.keys.set("anthropic", "SECRET-KEY-123")
    with handle.session() as s:
        m = AssetModel(name="m", status="building")
        s.add(m)
        s.flush()
        run = AssetModelRun(model_id=m.id, job_id="job-run", provider="anthropic", model_name="claude-opus-5-5",
                            mode="build", sources=[])
        s.add(run)
        s.flush()
        m.live_run_id = run.id
        return m.id, run.id


def go(handle, app, ids, script, **kw):
    fake = FakeLlm(script)
    app.state.jobs.agent_llm = fake
    ctx = Ctx(handle, app.state.jobs, {"model_id": ids[0], "run_id": ids[1]}, **kw)
    try:
        result = R.run_asset_model(ctx)
    except JobCancelled:
        result = None
    with handle.session() as s:
        run = s.get(AssetModelRun, ids[1])
        model = s.get(AssetModel, ids[0])
        s.expunge_all()
    return fake, result, run, model


def test_finish_writes_an_agent_version(handle, app, seeded, wait_job, project_id):
    fake, result, run, model = go(handle, app, seeded, [
        reply(("upsert_parts", {"parts": [SHELL]})),
        reply(("finish", {"summary": "Shell only.", "open_questions": ["Roof type?"]})),
    ])
    assert run.state == "finished" and run.summary == "Shell only." and run.open_questions == ["Roof type?"]
    assert run.version == 1 and result == {"run_id": seeded[1], "version": 1}
    assert [s["tool"] for s in run.steps] == ["upsert_parts", "finish"]
    assert run.usage == {"input_tokens": 200, "output_tokens": 100}
    assert model.live_run_id is None and model.current_version == 1 and model.status == "ready"
    with handle.session() as s:
        assert store.get_version(s, seeded[0], 1).kind == "agent"
    assert fake.calls[0]["effort"] == "high" and fake.calls[0]["cache"] is True


def test_invalid_upsert_is_a_tool_error_and_loop_continues(handle, app, seeded):
    _, _, run, _ = go(handle, app, seeded, [
        reply(("upsert_parts", {"parts": [{"id": "x", "shape": "torus"}]})),
        reply(("upsert_parts", {"parts": [SHELL]})),
        reply(("finish", {"summary": "ok"})),
    ])
    assert [s["ok"] for s in run.steps] == [False, True, True]
    assert run.state == "finished"


def test_call_budget_stops_with_a_draft(handle, app, seeded, monkeypatch):
    monkeypatch.setattr(R, "MAX_CALLS", 2)
    _, _, run, _ = go(handle, app, seeded, [
        reply(("upsert_parts", {"parts": [SHELL]}), ("validate", {}), ("validate", {})),
    ])
    assert run.state == "stopped" and run.stop_reason == "budget"
    assert [s["tool"] for s in run.steps] == ["upsert_parts", "validate"]
    with handle.session() as s:
        assert store.get_version(s, seeded[0], 1).kind == "draft"


def test_token_budget_stops(handle, app, seeded, monkeypatch):
    monkeypatch.setattr(R, "MAX_TOKENS", 100)
    _, _, run, _ = go(handle, app, seeded, [reply(("validate", {}), usage=(90, 20)), reply(("validate", {}))])
    assert run.stop_reason == "budget"


def test_user_stop_writes_a_draft(handle, app, seeded):
    _, _, run, _ = go(handle, app, seeded, [
        reply(("upsert_parts", {"parts": [SHELL]})),
        reply(("validate", {})),
    ], cancel_at=3)
    assert run.state == "stopped" and run.stop_reason == "user" and run.version == 1


def test_stop_before_any_part_writes_no_version(handle, app, seeded):
    _, _, run, model = go(handle, app, seeded, [reply(("validate", {}))], cancel_at=2)
    assert run.version is None and model.current_version is None and model.status == "empty"


def test_missing_key_fails_with_fixed_text(handle, app, seeded):
    app.state.keys.delete("anthropic")
    _, _, run, _ = go(handle, app, seeded, [])
    assert run.state == "failed" and run.stop_reason == "provider_error"
    assert "API key" in run.summary


def test_provider_error_fails_and_never_logs_the_key(handle, app, seeded, caplog):
    from app.project_agent.history import LlmError

    _, _, run, _ = go(handle, app, seeded, [LlmError("The provider is rate limiting requests.")])
    assert run.state == "failed" and "rate limiting" in run.summary
    assert "SECRET-KEY-123" not in caplog.text


def test_no_tool_calls_twice_ends_as_finished_with_text(handle, app, seeded):
    _, _, run, _ = go(handle, app, seeded, [
        reply(("upsert_parts", {"parts": [SHELL]})),
        reply(text="I think I'm done."),
        reply(text="Done."),
    ])
    assert run.state == "finished" and run.summary == "Done."


def test_history_is_append_only(handle, app, seeded):
    fake, _, _, _ = go(handle, app, seeded, [
        reply(("validate", {})), reply(("validate", {})), reply(("finish", {"summary": "s"})),
    ])
    lens = [c["history_len"] for c in fake.calls]
    assert lens == sorted(lens) and lens[1] - lens[0] == 2   # +assistant, +tool_results


def test_sweep_marks_interrupted_run_and_unsticks_model(handle, app, seeded):
    mid, rid = seeded
    rd = store.run_dir(handle, mid, rid)
    rd.mkdir(parents=True)
    from app.asset_models.spec import AssetSpec

    (rd / "working.json").write_text(AssetSpec.model_validate({"parts": [SHELL]}).model_dump_json())
    startup.sweep_interrupted(handle, app.state.jobs)
    with handle.session() as s:
        run = s.get(AssetModelRun, rid)
        model = s.get(AssetModel, mid)
        assert run.state == "failed" and run.stop_reason == "interrupted"
        assert run.summary == "interrupted by application restart"
        assert model.live_run_id is None and model.current_version == 1
        assert store.get_version(s, mid, 1).kind == "draft"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_run_job.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement the prompt**

```python
# backend/app/asset_models/agent/prompt.py
"""The build agent's system prompt (spec 2026-10-02 §7.2). No keys, no file paths."""

SYSTEM = """You build a part-by-part 3D model of an industrial asset (a tank, vessel, boiler, stack, duct or
culvert) from its engineering drawings, point clouds and photos, using only the tools provided.

The model is a spec of parts. Units are millimetres and degrees. The asset frame: Y up, X plant north,
Z plant east, origin at the centre of the asset's base. Bearings are clockwise from plant north, so bearing
0 points along +X and bearing 90 along +Z. Use the drawing's plant north, not true north; if the drawing
gives the offset to true north, record it with set_asset.

Shapes: cylinder, cone, head_torispherical, head_ellipsoidal, head_hemispherical, flat_plate, box, nozzle,
pipe_run, lathe, extrusion, sweep. Shell nozzles and manways go on a cylinder or cone host by
bearing_deg and elevation_mm (absolute height of the nozzle centre line); roof nozzles go on a head or
plate host by e_mm and n_mm. Free parts use origin_mm and axis.

Every part records its source: the drawing id and the region you read it from, the cloud measurement, or
the photo. Use "assumed" only when nothing shows it, and then say so in the part's note and keep
confidence low.

Work in this order:
1. list_sources. Read each drawing's title block and nozzle schedule with drawing_text first, then look at
   the drawing with drawing_view, zooming into regions to read small text.
2. set_asset with the tag, service, standard and drawing reference.
3. Build the primary shell, then the heads and bottom, then nozzles and manways from the schedule, then
   supports, access and internals that the drawing shows.
4. render the model (iso, front, side, top) and compare it with the drawing. Fix what differs.
5. If a point cloud is a source, find the asset's axis with cloud_fit, place the cloud with
   compare_to_cloud, and use the deviations to check diameters, heights and nozzle positions.
6. validate, then finish with a short summary and honest open questions - anything you could not read,
   had to assume, or where the sources disagree.

Prefer a few large upsert_parts calls over many small ones. Do not invent dimensions."""


def first_message(mode: str, notes: str | None, sources: list[dict], spec_parts: int) -> str:
    lines = [f"Task: {'build a new model' if mode == 'build' else 'refine the existing model'}."]
    if mode == "refine":
        lines.append(f"The working spec already has {spec_parts} parts; read it with get_spec before changing it.")
    lines.append("Sources: " + ", ".join(f"{s['type']} {s['id']} ({s.get('label', '')})" for s in sources))
    if notes:
        lines.append("The operator's notes:\n" + notes)
    return "\n".join(lines)
```

- [ ] **Step 4: Implement the runner**

```python
# backend/app/asset_models/agent/runner.py
"""`asset_model_run` (spec 2026-10-02 §7.2): sample clouds, then loop model call -> tools until finish,
a budget, the clock, a stop or a provider error. History is append-only. Logs carry tool names, states
and durations only."""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from datetime import UTC, datetime

from PIL import Image

from app.asset_models import service, store
from app.asset_models.agent.prompt import SYSTEM, first_message
from app.asset_models.agent.tools import RunContext, run_tool, tool_specs
from app.asset_models.look.cloud import CloudSample, sample_cloud, source_of
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelRun, Drawing, Image as ImageRow, PointCloud
from app.jobs.cancellation import JobCancelled
from app.jobs.registry import register_job_type
from app.project_agent.history import HistoryEntry, LlmError, ToolResult

log = logging.getLogger(__name__)
RUN_JOB = "asset_model_run"
MAX_CALLS = 80
MAX_TOKENS = 3_000_000
MAX_SECONDS = 1200
EFFORT = "high"
KEY_MISSING = "Add this provider's API key in App settings."
NUDGE = "Continue with the tools, or call finish with a summary and open questions."


class _Stop(Exception):
    def __init__(self, state: str, reason: str | None, summary: str | None = None):
        self.state, self.reason, self.summary = state, reason, summary


def _now():
    return datetime.now(UTC)


def _update(ctx, run_id, **fields):
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        for k, v in fields.items():
            setattr(run, k, v)


def _append_step(ctx, run_id, step):
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        run.steps = [*run.steps, step]
        run.phase = step.get("phase", run.phase)


def _call_model(ctx, llm, **kwargs):
    """Run the async model call, polling the job's cancel flag so Stop doesn't wait for a slow answer."""

    async def inner():
        task = asyncio.ensure_future(llm(**kwargs))
        while not task.done():
            try:
                ctx.check_cancelled()
            except JobCancelled:
                task.cancel()
                raise
            await asyncio.sleep(0.25)
        return task.result()

    return asyncio.run(inner())


def _describe_sources(ctx, sources):
    out = []
    with ctx.project.session() as s:
        for src in sources:
            row = s.get({"drawing": Drawing, "point_cloud": PointCloud, "image": ImageRow}[src["type"]], src["id"])
            label = getattr(row, "name", None) or getattr(row, "file_name", None) or src["id"]
            out.append({**src, "label": label})
    return out


def _thumb(ctx, run_id, model_id, n, jpeg):
    path = store.run_dir(ctx.project, model_id, run_id) / f"step_{n}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(io.BytesIO(jpeg))
    img.thumbnail((320, 320))
    img.save(path, "PNG")


@register_job_type(RUN_JOB)
def run_asset_model(ctx) -> dict:
    model_id, run_id = ctx.params["model_id"], ctx.params["run_id"]
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, run_id)
        model = s.get(AssetModel, model_id)
        provider, model_name, mode, notes, sources = run.provider, run.model_name, run.mode, run.notes, list(run.sources)
        spec = AssetSpec()
        if mode == "refine" and model.current_version:
            spec = AssetSpec.model_validate(store.get_version(s, model_id, model.current_version).spec)
    rc = RunContext(handle=ctx.project, model_id=model_id, run_id=run_id, sources=_describe_sources(ctx, sources),
                    spec=spec, samples={})
    usage = {"input_tokens": 0, "output_tokens": 0}
    calls = 0
    started = time.monotonic()
    try:
        # ---- sampling (one streamed pass per cloud, bounded)
        clouds = [x["id"] for x in sources if x["type"] == "point_cloud"]
        for k, cid in enumerate(clouds):
            ctx.progress(0.15 * k / max(len(clouds), 1), "Sampling point cloud")
            path = rc.run_dir / f"cloud_{cid}.npz"
            if path.exists():
                rc.samples[cid] = CloudSample.load(path)
                continue
            sample = sample_cloud(source_of(ctx.project, cid), check_cancelled=ctx.check_cancelled,
                                  progress=lambda d, t, k=k: ctx.progress(0.15 * (k + d / max(t, 1)) / len(clouds),
                                                                          "Sampling point cloud"))
            rc.run_dir.mkdir(parents=True, exist_ok=True)
            sample.save(path)
            rc.samples[cid] = sample
        _update(ctx, run_id, phase="reading")
        history = [HistoryEntry(role="user", text=first_message(mode, notes, rc.sources, len(spec.parts)))]
        specs = tool_specs()
        idle = 0
        llm = ctx.runner.agent_llm
        while True:
            ctx.check_cancelled()
            if time.monotonic() - started > MAX_SECONDS:
                raise _Stop("stopped", "timeout", "The run reached its 20-minute limit.")
            key = ctx.runner.keys.get(provider)
            if not key:
                raise _Stop("failed", "provider_error", KEY_MISSING)
            try:
                reply = _call_model(ctx, llm, provider=provider, api_key=key, model=model_name, system=SYSTEM,
                                    history=history, tools=specs, effort=EFFORT, cache=True)
            finally:
                del key
            if reply.usage:
                usage = {k: usage[k] + int(reply.usage.get(k, 0)) for k in usage}
                _update(ctx, run_id, usage=usage)
            history.append(HistoryEntry(role="assistant", text=reply.text or "", tool_calls=list(reply.tool_calls),
                                        provider=provider, model=model_name, provider_payload=reply.provider_payload))
            if usage["input_tokens"] + usage["output_tokens"] > MAX_TOKENS:
                if reply.tool_calls:
                    history.append(HistoryEntry(role="tool_results", results=[
                        ToolResult(c.id, c.name, "Not run: the token budget is used up.", is_error=True)
                        for c in reply.tool_calls]))
                raise _Stop("stopped", "budget", "The run used its token budget.")
            if not reply.tool_calls:
                idle += 1
                if idle >= 2:
                    rc.finished = {"summary": (reply.text or "")[:4000], "open_questions": []}
                    break
                history.append(HistoryEntry(role="user", text=NUDGE))
                continue
            idle = 0
            results = []
            stop = None
            for call in reply.tool_calls:
                if calls >= MAX_CALLS:
                    results.append(ToolResult(call.id, call.name, "Not run: the run reached its limit of tool calls.",
                                              is_error=True))
                    stop = _Stop("stopped", "budget", "The run reached its limit of tool calls.")
                    continue
                calls += 1
                t0 = time.monotonic()
                out = run_tool(rc, call.name, call.input)
                log.info("asset model tool %s ok=%s %.2fs", call.name, out.ok, time.monotonic() - t0)
                if out.image:
                    _thumb(ctx, run_id, model_id, calls, out.image)
                _append_step(ctx, run_id, {"n": calls, "tool": call.name, "ok": out.ok, "summary": out.summary,
                                           "has_thumb": bool(out.image), "phase": out.phase})
                if rc.comparison is not None:
                    _update(ctx, run_id, comparison=rc.comparison)
                results.append(ToolResult(call.id, call.name, out.text, is_error=not out.ok,
                                          image_jpeg_b64=base64.b64encode(out.image).decode() if out.image else None))
                ctx.progress(0.15 + 0.8 * min(calls / MAX_CALLS, 1), f"{out.phase.capitalize()} - step {calls}")
                ctx.publish("asset_models.changed", {"asset_model_ids": [model_id], "run_id": run_id})
            history.append(HistoryEntry(role="tool_results", results=results))
            if stop:
                raise stop
            if rc.finished:
                break
        return _end(ctx, rc, "finished", None, rc.finished["summary"], rc.finished["open_questions"], kind="agent")
    except _Stop as e:
        return _end(ctx, rc, e.state, e.reason, e.summary, [], kind="draft")
    except JobCancelled:
        _end(ctx, rc, "stopped", "user", "Stopped by the operator.", [], kind="draft")
        raise
    except LlmError as e:
        return _end(ctx, rc, "failed", "provider_error", e.message, [], kind="draft")


def _end(ctx, rc: RunContext, state, reason, summary, questions, *, kind) -> dict:
    version = None
    if rc.spec.parts:
        try:
            row, _job = service.add_version(ctx.project, ctx.runner, rc.model_id, rc.spec, kind=kind,
                                            note=summary, source_ids=[{"type": s["type"], "id": s["id"]} for s in rc.sources],
                                            run_id=rc.run_id)
            version = row.version
        except Exception:  # noqa: BLE001 - an invalid working spec cannot happen (tools validate), but never lose the run
            log.exception("asset model run could not write its version")
    with ctx.project.session() as s:
        run = s.get(AssetModelRun, rc.run_id)
        run.state, run.stop_reason, run.summary, run.open_questions = state, reason, summary, list(questions)
        run.version, run.phase, run.ended_at = version, "done", _now()
        model = s.get(AssetModel, rc.model_id)
        model.live_run_id = None
        service.refresh_status(model)
    ctx.publish("asset_models.changed", {"asset_model_ids": [rc.model_id], "run_id": rc.run_id})
    return {"run_id": rc.run_id, "version": version}
```

`service.add_version` sets `status` from `live_run_id`, which is still set at that point, so the model reads `building` until the `_end` block clears it and calls `refresh_status`. That's intended.

Extend `startup.py`:

```python
from app.asset_models import store
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModelRun

INTERRUPTED = "interrupted by application restart"


def sweep_interrupted(handle, runner) -> None:
    # (existing GLB sweep first, unchanged)
    ...
    drafts = []
    with handle.session() as s:
        for run in s.scalars(select(AssetModelRun).where(AssetModelRun.state == "running")):
            if runner.is_live(run.job_id):
                continue
            run.state, run.stop_reason, run.summary, run.phase = "failed", "interrupted", INTERRUPTED, "done"
            model = s.get(AssetModel, run.model_id)
            if model is not None and model.live_run_id == run.id:
                model.live_run_id = None
                refresh_status(model)
            drafts.append((run.model_id, run.id))
    for model_id, run_id in drafts:
        working = store.run_dir(handle, model_id, run_id) / "working.json"
        if working.exists():
            spec = AssetSpec.model_validate_json(working.read_text(encoding="utf-8"))
            if spec.parts:
                from app.asset_models.service import add_version

                row, _ = add_version(handle, runner, model_id, spec, kind="draft", note=INTERRUPTED, run_id=run_id)
                with handle.session() as s:
                    s.get(AssetModelRun, run_id).version = row.version
```

Register the run job module where the router imports the GLB job: `from app.asset_models.agent import runner as _run  # noqa: F401 - registers asset_model_run` goes in `runs.py` (Task 5).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest tests/test_asset_model_run_job.py -v`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/asset_models/agent/prompt.py backend/app/asset_models/agent/runner.py backend/app/asset_models/startup.py backend/app/main.py backend/tests/test_asset_model_run_job.py
git commit -m "feat(asset-models): the asset_model_run job with budgets, stop and drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Runs API (replace the stubs)

**Files:**
- Create: `backend/app/asset_models/runs.py`
- Delete: `backend/app/asset_models/stubs.py`
- Modify: `backend/app/api.py` (replace the `"app.asset_models.stubs"` line with `"app.asset_models.runs"`)
- Modify: `backend/app/asset_models/schemas.py` (`AssetModelRunOut`, `AssetModelRunList`, `AssetModelRunStart`, `AssetModelRunWithJob`, `AssetModelRunStepOut`)
- Modify: `backend/tests/test_contract.py` (drop the asset models `EXPECTED_STUBS` line and import; add `"startAssetModelRun": {409, 422}` to `REFUSES_VALID_DATA`)
- Test: `backend/tests/test_asset_model_runs_api.py`

**Interfaces:**
- Produces the six run operations from U3's contract table, with these rules:
  - **start:**
    - 404 for an unknown model;
    - 409 `job_running` when `live_run_id` is set and its job is live;
    - 409 `provider_key_missing` when `keys.get(provider)` is empty;
    - 422 `no_sources` when any source doesn't exist or isn't ready (drawing `ready`, cloud `ready`, image exists);
    - 422 `nothing_to_refine` for `refine` without a version.
    - Otherwise it creates the run (`model_name` = the body's value or `provider_config.get(provider).model_name`), sets `live_run_id` and `status="building"`, submits `asset_model_run`, stores `job_id`, publishes, and returns 202.
  - **stop:** if the run is `running`, `jobs.cancel(handle, run.job_id)`. Returns the run as it is now (still `running`; the job ends it).
  - **thumb:** `run_dir/step_<n>.png` → `image/png`, otherwise 204.
  - **overlay:** `run_dir/overlay_<cloudId>.bin` → `application/octet-stream`, otherwise 204. `cloudId` must match `ID_RE`, otherwise 404.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_asset_model_runs_api.py
"""Runs over HTTP (spec §9)."""

import pytest

from app.project_agent.history import ModelReply, ToolCall

SHELL = {"id": "shell", "name": "Shell", "group": "Shell", "shape": "cylinder",
         "params": {"id": 4000, "thickness": 8, "height": 8000}, "source": {"kind": "assumed"}}


@pytest.fixture
def model_url(client, project_id):
    m = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Tank"}).json()
    return f"/api/v1/projects/{project_id}/asset-models/{m['id']}"


@pytest.fixture
def drawing_id(client, project_id, tmp_path):
    from drawings_helpers import build_drawing
    from look_helpers import vector_pdf

    return build_drawing(client, project_id, vector_pdf(tmp_path / "v.pdf"))


def scripted(app, *replies):
    async def llm(provider, **kw):
        r = replies[llm.n]
        llm.n += 1
        return r

    llm.n = 0
    app.state.jobs.agent_llm = llm


def test_start_runs_to_a_version(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    scripted(app,
             ModelReply("", [ToolCall("a", "upsert_parts", {"parts": [SHELL]})], usage={"input_tokens": 1, "output_tokens": 1}),
             ModelReply("", [ToolCall("b", "finish", {"summary": "done"})], usage={"input_tokens": 1, "output_tokens": 1}))
    r = client.post(f"{model_url}/runs", json={"mode": "build", "provider": "anthropic",
                                              "sources": [{"type": "drawing", "id": drawing_id}]})
    assert r.status_code == 202, r.text
    run = r.json()["run"]
    assert run["state"] == "running" and run["model_name"]
    assert client.get(model_url).json()["status"] == "building"
    wait_job(project_id, r.json()["job"]["id"])
    done = client.get(f"{model_url}/runs/{run['id']}").json()
    assert done["state"] == "finished" and done["version"] == 1
    assert [s["tool"] for s in done["steps"]] == ["upsert_parts", "finish"]
    assert client.get(f"{model_url}/runs").json()["items"][0]["id"] == run["id"]


def test_start_refusals(client, app, model_url, drawing_id):
    body = {"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]}
    r = client.post(f"{model_url}/runs", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "provider_key_missing"
    app.state.keys.set("anthropic", "k")
    r = client.post(f"{model_url}/runs", json={**body, "sources": [{"type": "drawing", "id": "nope"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_sources"
    r = client.post(f"{model_url}/runs", json={**body, "mode": "refine"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_refine"


def test_second_live_run_is_refused(client, app, model_url, drawing_id):
    app.state.keys.set("anthropic", "k")

    async def slow(provider, **kw):
        import asyncio

        await asyncio.sleep(30)

    app.state.jobs.agent_llm = slow
    body = {"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]}
    first = client.post(f"{model_url}/runs", json=body)
    assert first.status_code == 202
    second = client.post(f"{model_url}/runs", json=body)
    assert second.status_code == 409 and second.json()["error"]["code"] == "job_running"
    client.post(f"{model_url}/runs/{first.json()['run']['id']}/stop")


def test_stop_ends_the_run(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")

    async def slow(provider, **kw):
        import asyncio

        await asyncio.sleep(30)

    app.state.jobs.agent_llm = slow
    r = client.post(f"{model_url}/runs", json={"mode": "build", "provider": "anthropic",
                                              "sources": [{"type": "drawing", "id": drawing_id}]}).json()
    assert client.post(f"{model_url}/runs/{r['run']['id']}/stop").status_code == 202
    job = wait_job(project_id, r["job"]["id"])
    assert job["state"] == "cancelled"
    run = client.get(f"{model_url}/runs/{r['run']['id']}").json()
    assert run["state"] == "stopped" and run["stop_reason"] == "user"
    assert client.get(model_url).json()["live_run_id"] is None


def test_thumb_and_overlay_204_when_absent(client, app, model_url, project_id, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    scripted(app, ModelReply("", [ToolCall("b", "finish", {"summary": "nothing"})]))
    r = client.post(f"{model_url}/runs", json={"mode": "build", "provider": "anthropic",
                                              "sources": [{"type": "drawing", "id": drawing_id}]}).json()
    wait_job(project_id, r["job"]["id"])
    rid = r["run"]["id"]
    assert client.get(f"{model_url}/runs/{rid}/steps/1/thumb").status_code == 204
    assert client.get(f"{model_url}/runs/{rid}/overlay/00000000-0000-0000-0000-000000000000").status_code == 204
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$PY -m pytest tests/test_asset_model_runs_api.py -v`
Expected: FAIL (501 from the stubs)

- [ ] **Step 3: Implement `runs.py` and the schemas**

```python
# backend/app/asset_models/runs.py
"""Asset model runs (spec 2026-10-02 §9). Replaces U3's 501 stubs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select

from app.asset_models import store
from app.asset_models.agent import runner as _run  # noqa: F401 - registers `asset_model_run`
from app.asset_models.schemas import AssetModelRunList, AssetModelRunOut, AssetModelRunStart, AssetModelRunWithJob
from app.asset_models.service import refresh_status
from app.db.models import AssetModelRun, Drawing, Image, PointCloud
from app.errors import AppError, not_found
from app.events_util import publish_asset_models_changed
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.surfaces.design.store import ID_RE

router = APIRouter(prefix="/projects/{projectId}", tags=["assetmodels"])
R = "/asset-models/{assetModelId}/runs"
READY = {"drawing": (Drawing, lambda r: r.status == "ready"), "point_cloud": (PointCloud, lambda r: r.status == "ready"),
         "image": (Image, lambda r: True)}


def _run_row(s, model_id, run_id) -> AssetModelRun:
    row = s.get(AssetModelRun, run_id)
    if row is None or row.model_id != model_id:
        raise not_found("asset model run", run_id)
    return row


@router.post(R, response_model=AssetModelRunWithJob, status_code=202)
def start_asset_model_run(assetModelId: str, body: AssetModelRunStart, request: Request,  # noqa: N803
                          handle: ProjectHandle = Depends(get_project)):
    jobs, keys = request.app.state.jobs, request.app.state.keys
    with handle.session() as s:
        model = store.get_model(s, assetModelId)
        if model.live_run_id:
            live = s.get(AssetModelRun, model.live_run_id)
            if live is not None and jobs.is_live(live.job_id):
                raise AppError("job_running", "A run is already building this model.", 409, {"job_id": live.job_id})
        if not keys.get(body.provider):
            raise AppError("provider_key_missing", "Add this provider's API key in App settings.", 409)
        for src in body.sources:
            cls, ok = READY[src.type]
            row = s.get(cls, src.id)
            if row is None or not ok(row):
                raise AppError("no_sources", "A chosen source is missing or not ready.", 422, {"source": src.model_dump()})
        if body.mode == "refine" and not model.current_version:
            raise AppError("nothing_to_refine", "This model has no version to refine yet.", 422)
        model_name = body.model_name or request.app.state.provider_config.get(body.provider).model_name
        run = AssetModelRun(model_id=assetModelId, job_id="pending", provider=body.provider, model_name=model_name,
                            mode=body.mode, notes=body.notes, sources=[x.model_dump() for x in body.sources])
        s.add(run)
        s.flush()
        run_id = run.id
        model.live_run_id = run_id
        refresh_status(model)
    job = jobs.submit(handle, "asset_model_run", {"model_id": assetModelId, "run_id": run_id})
    with handle.session() as s:
        run = _run_row(s, assetModelId, run_id)
        run.job_id = job.id
        out = AssetModelRunOut.of(run)
    publish_asset_models_changed(request, handle, [assetModelId])
    return AssetModelRunWithJob(run=out, job=JobOut.from_row(job, handle.id))


@router.get(R, response_model=AssetModelRunList)
def list_asset_model_runs(assetModelId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        store.get_model(s, assetModelId)
        rows = s.scalars(select(AssetModelRun).where(AssetModelRun.model_id == assetModelId)
                         .order_by(AssetModelRun.started_at.desc())).all()
        return AssetModelRunList(items=[AssetModelRunOut.of(r) for r in rows])


@router.get(R + "/{runId}", response_model=AssetModelRunOut)
def get_asset_model_run(assetModelId: str, runId: str, handle: ProjectHandle = Depends(get_project)):  # noqa: N803
    with handle.session() as s:
        return AssetModelRunOut.of(_run_row(s, assetModelId, runId))


@router.post(R + "/{runId}/stop", response_model=AssetModelRunOut, status_code=202)
def stop_asset_model_run(assetModelId: str, runId: str, request: Request,  # noqa: N803
                         handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        run = _run_row(s, assetModelId, runId)
        if run.state == "running":
            request.app.state.jobs.cancel(handle, run.job_id)
        return AssetModelRunOut.of(run)


@router.get(R + "/{runId}/steps/{step}/thumb")
def get_asset_model_run_thumb(assetModelId: str, runId: str, step: int,  # noqa: N803
                              handle: ProjectHandle = Depends(get_project)):
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
    path = store.run_dir(handle, assetModelId, runId) / f"step_{int(step)}.png"
    if not path.exists():
        return Response(status_code=204)
    return Response(path.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get(R + "/{runId}/overlay/{cloudId}")
def get_asset_model_run_overlay(assetModelId: str, runId: str, cloudId: str,  # noqa: N803
                                handle: ProjectHandle = Depends(get_project)):
    if not ID_RE.fullmatch(cloudId or ""):
        raise not_found("point cloud", cloudId)
    with handle.session() as s:
        _run_row(s, assetModelId, runId)
    path = store.run_dir(handle, assetModelId, runId) / f"overlay_{cloudId}.bin"
    if not path.exists():
        return Response(status_code=204)
    from fastapi.responses import FileResponse

    return FileResponse(path, media_type="application/octet-stream")
```

Schemas (append to `schemas.py`):

```python
class AssetModelRunStepOut(BaseModel):
    n: int
    tool: str
    ok: bool
    summary: str
    has_thumb: bool


class AssetModelRunOut(BaseModel):
    id: str
    model_id: str
    job_id: str
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str
    mode: Literal["build", "refine"]
    notes: str | None
    state: Literal["running", "finished", "stopped", "failed"]
    stop_reason: Literal["budget", "timeout", "user", "provider_error", "interrupted"] | None
    phase: Literal["sampling", "reading", "building", "checking", "done"]
    steps: list[AssetModelRunStepOut]
    summary: str | None
    open_questions: list[str]
    usage: dict
    sources: list[AssetSourceRef]
    version: int | None
    comparison: dict | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def of(cls, row) -> AssetModelRunOut:
        return cls.model_validate(row, from_attributes=True)


class AssetModelRunList(BaseModel):
    items: list[AssetModelRunOut]


class AssetModelRunStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["build", "refine"]
    sources: list[AssetSourceRef] = Field(min_length=1, max_length=50)
    provider: Literal["openai", "anthropic", "gemini"]
    model_name: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=4000)


class AssetModelRunWithJob(BaseModel):
    run: AssetModelRunOut
    job: JobOut
```

`AssetModelRunStepOut` ignores the step dict's extra `phase` key. Pydantic's default `extra="ignore"` handles that on output.

- [ ] **Step 4: Run the tests and the contract test**

Run: `$PY -m pytest tests/test_asset_model_runs_api.py tests/test_contract.py tests/test_asset_models_*.py -v`
Expected: PASS. For `test_responses_conform`: generated `startAssetModelRun` bodies hit 404/409/422, all declared and listed in `REFUSES_VALID_DATA`.

- [ ] **Step 5: Commit**

```bash
git rm backend/app/asset_models/stubs.py
git add backend/app/asset_models/runs.py backend/app/asset_models/schemas.py backend/app/api.py backend/tests/test_contract.py backend/tests/test_asset_model_runs_api.py
git commit -m "feat(asset-models): runs API replaces the 501 stubs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Live test, frozen check, landing

**Files:**
- Create: `backend/tests/test_asset_model_live.py` (marked `live`, outside the gate)
- Create: `backend/tests/data/asset_models/README.md` (where the acceptance drawing goes)

- [ ] **Step 1: Write the live test**

```python
# backend/tests/test_asset_model_live.py
"""A real model builds the HCl tank from its GA drawing (spec §11 acceptance). Outside the gate:
needs a key in the environment and the operator's drawing at tests/data/asset_models/hcl-tank-ga.pdf."""

import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.live
DRAWING = Path(__file__).parent / "data" / "asset_models" / "hcl-tank-ga.pdf"
NOZZLES = {"N1", "N1B", "N2", "N3", "N4", "N5", "N6", "N6B", "N7", "N8", "N9", "N10", "N11", "N12", "N13", "M1", "M2"}


@pytest.mark.parametrize("provider,env", [("anthropic", "ANTHROPIC_API_KEY"), ("gemini", "GEMINI_API_KEY"),
                                          ("openai", "OPENAI_API_KEY")])
def test_hcl_tank_acceptance(client, app, project_id, wait_job, provider, env):
    key = os.environ.get(env)
    if not key or not DRAWING.exists():
        pytest.skip(f"needs {env} and {DRAWING.name}")
    from drawings_helpers import build_drawing

    app.state.keys.set(provider, key)
    did = build_drawing(client, project_id, DRAWING)
    base = f"/api/v1/projects/{project_id}/asset-models"
    mid = client.post(base, json={"name": "HCl tank 710-D-130335"}).json()["id"]
    r = client.post(f"{base}/{mid}/runs", json={"mode": "build", "provider": provider,
                                               "sources": [{"type": "drawing", "id": did}]}).json()
    wait_job(project_id, r["job"]["id"], timeout=1500)
    run = client.get(f"{base}/{mid}/runs/{r['run']['id']}").json()
    assert run["state"] == "finished", run["summary"]
    spec = client.get(f"{base}/{mid}/versions/{run['version']}").json()["spec"]
    parts = {p["id"]: p for p in spec["parts"]}
    shells = [p for p in spec["parts"] if p["shape"] == "cylinder" and p["group"] == "Shell"]
    assert all(abs(p["params"]["id"] - 4000) <= 5 for p in shells)
    assert abs(sum(p["params"]["height"] for p in shells) - 8000) <= 5
    assert len(shells) == 3
    present = {pid for pid in parts if pid in NOZZLES} | {p["name"].split()[0] for p in spec["parts"]} & NOZZLES
    assert present == NOZZLES
    assert all(p["source"]["kind"] != "assumed" for p in spec["parts"] if p["group"] in ("Shell", "Head", "Nozzle", "Manway"))
```

The bearing (±2°) and elevation (±25 mm) checks need the drawing's nozzle schedule, which only the drawing has. Add them once the operator has supplied the file: transcribe the expected values from `model_meta.json` (in `C:\Users\D\Downloads\source_2`) into a dict in this test, and assert each part against it. Don't transcribe them from memory.

`tests/data/asset_models/README.md`: "Put the HCl tank GA drawing (P-00212-DW-MD-143TD1 rev 3, as built) here as `hcl-tank-ga.pdf`. It is the operator's client document: it is git-ignored and never committed." Add `backend/tests/data/asset_models/*.pdf` to `.gitignore`.

If `wait_job` has no `timeout` parameter, add one (default unchanged) in `conftest.py`.

- [ ] **Step 2: Frozen check**

Add `import google.genai  # noqa: F401` to the asset models self-test (`app/asset_models/selftest.py`, before the print), then run `backend\scripts\build.ps1` and `backend\scripts\smoke_frozen.ps1`. Expected: `asset-models ok …`. If google-genai is missing a submodule or data file in the bundle, add it to `kestrel_backend.spec` with a comment.

- [ ] **Step 3: Install the new pins into the shared venv (additive, `--no-deps`, diff before and after), as in U1 Task 6.**

- [ ] **Step 4: Commit, gate, merge**

```bash
git add backend/tests/test_asset_model_live.py backend/tests/data/asset_models/README.md .gitignore backend/app/asset_models/selftest.py
git commit -m "test(asset-models): live acceptance run on the HCl tank drawing (outside the gate)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run `scripts\finish-task.ps1`, or the manual fallback.
