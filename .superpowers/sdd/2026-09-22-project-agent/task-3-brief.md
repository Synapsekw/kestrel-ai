### Task 3: LLM adapters

**Files:**
- Create: `backend/app/project_agent/llm.py`
- Test: `backend/tests/test_project_agent_llm.py`

**Interfaces:**
- Consumes: `app.project_agent.history`.
- Produces:

```python
MODEL_TIMEOUT_S = 120
MAX_OUTPUT_TOKENS = 16000
async def complete(provider: str, *, api_key: str, model: str, system: str,
                   history: list[HistoryEntry], tools: list[ToolSpec]) -> ModelReply
```

Anthropic (`from anthropic import AsyncAnthropic`, lazy import inside the function; `async with AsyncAnthropic(api_key=api_key, timeout=MODEL_TIMEOUT_S, max_retries=0) as client`): `client.messages.create(model=model, system=system, messages=..., tools=[{"name", "description", "input_schema"}], max_tokens=MAX_OUTPUT_TOKENS)`. Do not pass `thinking` (Claude Opus 5 runs adaptive thinking by default) and do not pass `temperature`.
- user entry → `{"role": "user", "content": text}`.
- assistant entry: if `provider == "anthropic"` and `provider_payload` is a list, content = that list unchanged (it is `[block.model_dump(mode="json", exclude_none=True) for block in response.content]` stored by this adapter); else build `[{"type": "text", "text": text}]` (only if text) `+ [{"type": "tool_use", "id", "name", "input"}]`. Never send an empty content list — use `[{"type": "text", "text": "(no text)"}]`.
- tool_results entry → one user message whose content is a list of `{"type": "tool_result", "tool_use_id": call_id, "content": [{"type": "text", "text": content}] + ([{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}}] if image), "is_error": is_error}`.
- Consecutive user-role messages must be merged (a user entry right after a tool_results entry happens when a turn was cancelled): append the text block to the previous user content list.
- Response: `stop_reason == "refusal"` → `LlmError("The provider declined this request.")`; `"max_tokens"` → `LlmError("The provider's answer was cut off. Try a smaller request.")`; text = join of text blocks; tool_calls from `tool_use` blocks; `provider_payload` = dumped blocks.

OpenAI (`from openai import AsyncOpenAI`, `timeout=MODEL_TIMEOUT_S, max_retries=0`): `client.responses.create(model=model, instructions=system, input=..., tools=[{"type": "function", "name", "description", "parameters": input_schema, "strict": False}], store=False, include=["reasoning.encrypted_content"], max_output_tokens=MAX_OUTPUT_TOKENS)`.
- user → `{"role": "user", "content": text}`.
- assistant: if `provider == "openai"` and payload is a list, extend input with it unchanged (payload = `[item.model_dump(mode="json", exclude_none=True) for item in result.output]`); else `{"role": "assistant", "content": text}` (if text) plus `{"type": "function_call", "call_id": id, "name": name, "arguments": json.dumps(input)}` per call.
- tool_results → `{"type": "function_call_output", "call_id": call_id, "output": content if not is_error else "ERROR: " + content}` per result; if any has an image, append one `{"role": "user", "content": [{"type": "input_text", "text": "Image for tool call <call_id>:"}, {"type": "input_image", "image_url": "data:image/jpeg;base64,<b64>"}]}`.
- Response: `status != "completed"` → `LlmError("The provider's answer was incomplete. Try again.")`; any refusal content part → refusal LlmError; text = `result.output_text or ""`; tool calls from output items with `type == "function_call"` (`json.loads(arguments)`; invalid JSON → call input `{}` and let the tool report the validation error).

Errors: map SDK exceptions without their text: `RateLimitError` → `LlmError("The provider is rate limiting requests. Wait a minute and try again.")`; `AuthenticationError`/`PermissionDeniedError` → `LlmError("The provider rejected the API key. Check it in App settings.")`; `APITimeoutError` or `asyncio.TimeoutError` → `LlmError("The provider took too long to answer.")`; any other exception → `LlmError("The provider could not complete this step. Try again.")`. Wrap the call in `asyncio.wait_for(..., MODEL_TIMEOUT_S + 5)`. Unknown provider → `LlmError("Unknown provider.")`.

Tool input schemas: strip `title` recursively and inline pydantic `$defs` refs before sending (a helper `clean_schema(schema) -> dict`, exported, used by T4's `tool_specs`).

- [ ] **Step 1: Failing tests** with fake SDK classes monkeypatched onto `anthropic.AsyncAnthropic` / `openai.AsyncOpenAI` (pattern: `backend/tests/test_agent.py::sdk`): request shape per provider (model, tools, timeout, max_retries=0, `store=False`, no key in `json.dumps(request)`), history conversion for every entry kind including raw payload replay on same provider and neutral replay across providers, image tool results, user-message merging, tool call parsing, each error mapping (raise the real SDK exception classes; construct them via `httpx.Response`/`httpx.Request` as the SDK expects), refusal and truncation, `clean_schema`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; ruff check + format.
- [ ] **Step 5: Commit** `feat(agent): anthropic and openai tool-use adapters`.

