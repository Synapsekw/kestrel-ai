"""The project agent's five endpoints (contract tag `agent`)."""

from fastapi import APIRouter, Depends, Request

from app.project_agent import store
from app.project_agent.schemas import (
    AgentApprovalDecision,
    AgentConversationOut,
    AgentTurnCreate,
    AgentTurnOut,
)
from app.projects.kinds import require_kind
from app.projects.service import ProjectHandle, get_project

router = APIRouter(
    prefix="/projects/{projectId}/agent",
    tags=["agent"],
    dependencies=[Depends(require_kind(("train",)))],
)


def _runner(request: Request):
    return request.app.state.agent


@router.get("", response_model=AgentConversationOut)
def get_agent_conversation(handle: ProjectHandle = Depends(get_project)) -> AgentConversationOut:
    return store.conversation(handle)


@router.delete("", status_code=204)
def clear_agent_conversation(handle: ProjectHandle = Depends(get_project)) -> None:
    store.clear(handle)


@router.post("/turns", response_model=AgentTurnOut, status_code=202)
async def start_agent_turn(
    body: AgentTurnCreate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> AgentTurnOut:
    return await _runner(request).start_turn(handle, body.provider, body.message)


@router.post("/turns/{turnId}/cancel", response_model=AgentTurnOut)
async def cancel_agent_turn(
    turnId: str,  # noqa: N803 - path param from the contract
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> AgentTurnOut:
    return await _runner(request).cancel(handle, turnId)


@router.post("/turns/{turnId}/approval", response_model=AgentTurnOut)
async def decide_agent_approval(
    turnId: str,  # noqa: N803 - path param from the contract
    body: AgentApprovalDecision,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> AgentTurnOut:
    return await _runner(request).decide(handle, turnId, body.approve)
