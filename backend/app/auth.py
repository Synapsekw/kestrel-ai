import secrets

from fastapi import Request, WebSocket

from app.errors import AppError


def _presented(headers, query_params) -> str:
    header = headers.get("authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return query_params.get("token", "")


def require_token(request: Request) -> None:
    """Accept the per-launch token as a bearer header or as a token query parameter."""
    expected = request.app.state.settings.token
    if not secrets.compare_digest(_presented(request.headers, request.query_params), expected):
        raise AppError("unauthorized", "missing or invalid bearer token", 401)


def ws_token_ok(ws: WebSocket) -> bool:
    return secrets.compare_digest(_presented(ws.headers, ws.query_params), ws.app.state.settings.token)
