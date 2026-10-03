# backend/app/asset_models/agent/plant/model.py
"""One model call for any plant conversation (ruling R12):
- the key comes from the KeyStore at call time and is dropped right after;
- the call stops when the job is cancelled;
- a rate limit is retried after 20, 40 and 80 s, and the wait is cancel-aware.

Every other LlmError is raised to the caller."""

from __future__ import annotations

import time

from app.asset_models.agent.runner import EFFORT, KEY_MISSING, _call_model
from app.project_agent.history import LlmError
from app.project_agent.llm import _RATE_LIMITED

RATE_RETRIES_S: tuple[float, ...] = (20.0, 40.0, 80.0)


def call_model(rc, *, system: str, history: list, tools: list):
    llm = rc.job.runner.agent_llm
    if llm is None:
        raise LlmError("The model is not available.")
    attempt = 0
    while True:
        key = rc.job.runner.keys.get(rc.provider)
        if not key:
            raise LlmError(KEY_MISSING)
        try:
            return _call_model(
                rc.job,
                llm,
                provider=rc.provider,
                api_key=key,
                model=rc.model_name,
                system=system,
                history=history,
                tools=tools,
                effort=EFFORT,
                cache=True,
            )
        except LlmError as e:
            if e.message != _RATE_LIMITED or attempt >= len(RATE_RETRIES_S):
                raise
            wait = RATE_RETRIES_S[attempt]
            attempt += 1
        finally:
            del key
        _sleep(rc, wait)


def _sleep(rc, seconds: float) -> None:
    end = time.monotonic() + seconds
    while True:
        rc.check_cancelled()
        if getattr(rc, "abort", None) is not None:
            rc.check_aborted()  # a failed run must not wait out a backoff, then call again
        left = end - time.monotonic()
        if left <= 0:
            return
        time.sleep(min(0.25, left))
