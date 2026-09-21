from fastapi import APIRouter, Request

from app.agent import service
from app.agent.schemas import AgentChatRequest, AgentChatResponse

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=AgentChatResponse)
async def chat(body: AgentChatRequest, request: Request) -> AgentChatResponse:
    return await service.chat(body, request.app.state.keys, request.app.state.provider_config)
