"""`POST /providers/gemini/test`: one tiny generate call, mapped to fixed text by llm.complete."""

from __future__ import annotations

import asyncio

from app.project_agent import llm
from app.project_agent.history import HistoryEntry


def ping(api_key: str, model: str) -> str:
    reply = asyncio.run(
        llm.complete(
            "gemini",
            api_key=api_key,
            model=model,
            system="Reply with the word: ok",
            history=[HistoryEntry(role="user", text="ok?")],
            tools=[],
        )
    )
    return reply.text[:40]
