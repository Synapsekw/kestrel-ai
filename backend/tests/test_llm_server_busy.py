"""Transient provider failures (5xx, overloaded, a dropped connection) get their own retryable text,
and the log names the error class and HTTP status only, never the SDK message (live Al-Zour run 2
lost two packages to an unexplained "could not complete this step")."""

import logging

import anthropic
import httpx

from app.project_agent import llm

REQ = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _status(code: int) -> anthropic.APIStatusError:
    resp = httpx.Response(code, request=REQ)
    by_code = {400: anthropic.BadRequestError, 500: anthropic.InternalServerError}
    cls = by_code.get(code, anthropic.APIStatusError)
    return cls("secret request echo", response=resp, body=None)


def test_server_errors_and_dropped_connections_are_busy_not_failed():
    assert llm._error_message("anthropic", _status(500)) == llm._SERVER_BUSY
    assert llm._error_message("anthropic", _status(529)) == llm._SERVER_BUSY
    assert llm._error_message("anthropic", anthropic.APIConnectionError(request=REQ)) == llm._SERVER_BUSY
    assert llm._error_message("anthropic", _status(400)) == llm._FAILED


def test_the_log_names_the_class_and_status_but_not_the_message(caplog):
    with caplog.at_level(logging.INFO, logger="app.project_agent.llm"):
        llm._error_message("anthropic", _status(400))
    text = caplog.text
    assert "BadRequestError" in text and "400" in text
    assert "secret request echo" not in text
