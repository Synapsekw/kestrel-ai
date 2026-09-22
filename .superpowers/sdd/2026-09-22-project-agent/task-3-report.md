# Task 3 report: LLM adapters

Status: DONE
Commit: `158064d feat(agent): anthropic and openai tool-use adapters`

## What was implemented
`backend/app/project_agent/llm.py`
- `MODEL_TIMEOUT_S = 120`, `MAX_OUTPUT_TOKENS = 16000`.
- `async complete(provider, *, api_key, model, system, history, tools) -> ModelReply`. It dispatches to `_anthropic` / `_openai`, wrapped in `asyncio.wait_for(..., MODEL_TIMEOUT_S + 5)`. An unknown provider raises `LlmError("Unknown provider.")` and makes no call.
- Anthropic: lazy `AsyncAnthropic(api_key, timeout=MODEL_TIMEOUT_S, max_retries=0)` as an async context manager; `messages.create(model, system, messages, tools=[{name, description, input_schema}], max_tokens)`. It sends no `thinking` and no `temperature`.
  - History conversion:
    - An assistant entry whose own payload is a list is replayed unchanged, including thinking blocks.
    - Otherwise the adapter builds text and tool_use blocks. An empty content list becomes `(no text)`.
    - A tool_results entry becomes one user message of `tool_result` blocks, with a text block plus an optional base64 JPEG image and `is_error`.
    - Consecutive user messages are merged into one block list, so a user entry that follows tool_results becomes a text block appended to that user message.
  - Response: `refusal` / `max_tokens` stop reasons map to the fixed LlmErrors. The text is the text blocks joined with `"\n\n"`. `tool_use` blocks become `ToolCall`s. The payload is `[b.model_dump(mode="json", exclude_none=True)]`.
- OpenAI: lazy `AsyncOpenAI(..., timeout=MODEL_TIMEOUT_S, max_retries=0)`; `responses.create(model, instructions, input, tools=[{type: function, name, description, parameters, strict: False}], store=False, include=["reasoning.encrypted_content"], max_output_tokens)`.
  - History conversion:
    - An assistant entry with its own payload list is replayed by extending `input` with it unchanged.
    - Otherwise the assistant text message is followed by `function_call` items (`json.dumps(input)`).
    - Each tool result becomes `function_call_output`, prefixed with `ERROR: ` on error.
    - All images from one tool_results entry go into a single trailing user message (`input_text` "Image for tool call <id>:" + `input_image` data URL).
  - Response:
    - A status other than `completed` raises the incomplete error.
    - A `refusal` content part in any message raises the refusal error.
    - The text is `output_text or ""`.
    - Each `function_call` becomes a ToolCall. Invalid JSON or non-object arguments become `{}`.
    - The payload is the dumped output items.
- Errors: the provider SDK's `RateLimitError`, `AuthenticationError`/`PermissionDeniedError`, `APITimeoutError` and `asyncio.TimeoutError` map to the brief's fixed messages. Everything else maps to "could not complete this step". Errors are re-raised `from None`, so no SDK text is chained, logged or returned. `LlmError` from the adapter itself passes through. `CancelledError` is not caught, so turn cancellation propagates.
- `clean_schema(schema) -> dict` (exported):
  - Strips `title` metadata recursively. Property names called `title` are kept, and so are values inside `default`/`enum`/`const`/`examples`.
  - Inlines `#/$defs/...` refs, keeping sibling keys such as `description`, and drops `$defs`.
  - Replaces a recursive ref with `{}`.
  - Does not mutate its input.

## Verified against installed SDKs
The installed versions are anthropic 1.6.0 and openai 1.109.1. Both packages export `RateLimitError`, `AuthenticationError`, `PermissionDeniedError`, `APITimeoutError(request=)`, `InternalServerError` and `APIConnectionError(message=, request=)`. anthropic 1.6.0 builds on **`httpx2`**, not `httpx`, so the tests create anthropic exceptions with `httpx2.Request/Response`, falling back to httpx if httpx2 is not installed. OpenAI uses `httpx`.

## Tests (`backend/tests/test_project_agent_llm.py`, 38 tests)
The tests use fake `AsyncAnthropic`/`AsyncOpenAI` classes monkeypatched onto the SDK modules. The responses are real SDK block and item types (`TextBlock`, `ThinkingBlock`, `ToolUseBlock`, `ResponseReasoningItem`, `ResponseOutputMessage`, `ResponseFunctionToolCall`, `ResponseOutputRefusal`).

They cover:
- The exact request shape for both providers, including client kwargs, `store=False`, no key in `json.dumps(request)`, and no `thinking` or `temperature`.
- An unknown provider.
- Neutral history for every entry kind on both providers, including image and error results, and assistant entries with no text.
- User-message merging, in both the post-tool_results case and the user-after-user case.
- Payload replay: a provider's own payload is replayed unchanged, and another provider's payload is ignored in favour of neutral replay, in both directions.
- Tool call and payload parsing, including invalid and non-object arguments.
- Refusal, truncation and incomplete answers.
- Error mapping: 8 kinds x 2 providers, using real SDK exception classes. Each test asserts the fixed message, `__cause__ is None`, `__suppress_context__`, and that neither the key nor the SDK text appears in logs.
- The wall-clock `wait_for` deadline.
- `clean_schema` against a pydantic model, ref siblings, no mutation, recursive refs, and literal values.

## TDD evidence
- RED: `python -m pytest tests/test_project_agent_llm.py -q` failed with `ImportError: cannot import name 'llm' from 'app.project_agent'`, which is collection error 1 (the module did not exist yet).
- GREEN: the same command reported `38 passed in 1.31s`.
- `ruff check` needed one fix: UP041 in the test, where `asyncio.TimeoutError` became `TimeoutError`. After that, `ruff format --check` reported "2 files already formatted".

## Files changed
- `backend/app/project_agent/llm.py` (new)
- `backend/tests/test_project_agent_llm.py` (new)

## Self-review notes / concerns
- The brief left the text-block separator open. I used `"\n\n"`.
- An empty tool-result `content` is sent to Anthropic as `(no text)`, because Anthropic rejects empty text blocks. An empty *user* entry text is sent as-is. The turn runner is expected never to store an empty user message.
- The OpenAI replay sends the dumped output items unchanged, as the brief says. Reasoning items carry their `id` plus `encrypted_content`, which is the documented pattern for `store=False`.
- I did not run the full suite. The only files I touched are my own two.
