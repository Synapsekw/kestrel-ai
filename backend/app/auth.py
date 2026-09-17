import secrets

from fastapi import Request, WebSocket

from app.errors import AppError


def _presented(headers, query_params) -> str:
    header = headers.get("authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return query_params.get("token", "")


def _matches(presented: str, expected: str) -> bool:
    return secrets.compare_digest(presented.encode("utf-8"), expected.encode("utf-8"))


def require_token(request: Request) -> None:
    """Accept the per-launch token as a bearer header or as a token query parameter."""
    expected = request.app.state.settings.token
    if not _matches(_presented(request.headers, request.query_params), expected):
        raise AppError("unauthorized", "missing or invalid bearer token", 401)


def ws_token_ok(ws: WebSocket) -> bool:
    return _matches(_presented(ws.headers, ws.query_params), ws.app.state.settings.token)
