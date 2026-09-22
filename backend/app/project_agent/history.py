"""Provider-neutral conversation types shared by the store, the LLM adapters and the turn loop.

A turn replays the stored transcript as a list of `HistoryEntry`. Each adapter turns that list into
its own wire format; `provider_payload` carries the raw blocks a provider needs back unchanged
(Anthropic thinking blocks, OpenAI reasoning items) and is only replayed to the provider and
model that produced it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class ToolSpec:
    """A tool as the model sees it. `input_schema` is a JSON schema object."""

    name: str
    description: str
    input_schema: dict


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    input: dict


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    content: str
    is_error: bool = False
    # Base64 JPEG shown to the model with this result (view_image); only set for the newest results.
    image_jpeg_b64: str | None = None


@dataclass
class HistoryEntry:
    role: Literal["user", "assistant", "tool_results"]
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    results: list[ToolResult] = field(default_factory=list)
    provider: str | None = None  # the provider that produced `provider_payload`
    model: str | None = None  # the model that produced it; replayed only to the same model
    provider_payload: Any = None


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: list[ToolCall]
    provider_payload: Any = None


class LlmError(Exception):
    """A model call failed. `message` is safe to show and store: never an SDK string or a key."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
