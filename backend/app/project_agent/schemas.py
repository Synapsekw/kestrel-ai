"""Pydantic API models for the project agent, matching contract/openapi.yaml exactly.

`AgentTurnOut`/`AgentItemOut` never expose the internal columns (`tool_result`, `provider_payload`,
`result_image_id`, `tool_call_id`) — those stay in the store's plain-dict accessors only.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.providers.schemas import ProviderName

if TYPE_CHECKING:
    from app.db.models import AgentItem, AgentTurn

AgentTurnState = Literal["running", "awaiting_approval", "succeeded", "failed", "cancelled"]
AgentToolStatus = Literal["running", "ok", "error", "denied", "awaiting_approval"]
AgentItemKind = Literal["user", "assistant", "tool"]
AgentScreen = Literal[
    "home",
    "images",
    "label",
    "review",
    "datasets",
    "models",
    "train",
    "detect",
    "export",
    "settings",
    "editor",
]


class AgentTurnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: ProviderName
    message: str = Field(min_length=1, max_length=4000)


class AgentApprovalDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool


class AgentApprovalOut(BaseModel):
    title: str
    detail: str
    estimated_cost: float | None = None


class AgentNavigateOut(BaseModel):
    screen: AgentScreen
    image_id: str | None = None


class AgentTurnOut(BaseModel):
    id: str
    state: AgentTurnState
    provider: ProviderName
    model_name: str
    error: str | None
    tool_calls: int
    created_at: datetime
    finished_at: datetime | None

    @classmethod
    def from_row(cls, row: "AgentTurn") -> "AgentTurnOut":
        return cls(
            id=row.id,
            state=row.state,
            provider=row.provider,
            model_name=row.model_name,
            error=row.error,
            tool_calls=row.tool_calls,
            created_at=row.created_at,
            finished_at=row.finished_at,
        )


class AgentItemOut(BaseModel):
    id: str
    seq: int
    turn_id: str
    kind: AgentItemKind
    text: str
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_status: AgentToolStatus | None
    tool_summary: str | None
    job_ids: list[str]
    approval: AgentApprovalOut | None
    navigate: AgentNavigateOut | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: "AgentItem") -> "AgentItemOut":
        return cls(
            id=row.id,
            seq=row.seq,
            turn_id=row.turn_id,
            kind=row.kind,
            text=row.text,
            tool_name=row.tool_name,
            tool_input=row.tool_input,
            tool_status=row.tool_status,
            tool_summary=row.tool_summary,
            job_ids=row.job_ids or [],
            approval=row.approval,
            navigate=row.navigate,
            created_at=row.created_at,
        )


class AgentConversationOut(BaseModel):
    items: list[AgentItemOut]
    turn: AgentTurnOut | None
