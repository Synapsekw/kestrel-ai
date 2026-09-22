"""In-process access to the app's own HTTP API, and the image selector the agent's tools share.

The agent's tools never touch the database directly: every call goes through the existing routes
over `httpx.ASGITransport`, so request validation, background jobs and websocket events behave
exactly as they do for the UI. `ApiCaller` must be used on the event loop the app is served on
(the turn runner's loop), because route handlers publish events and submit jobs through
`app.state`, which the app's lifespan populates.
"""

from __future__ import annotations

from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

BASE_URL = "http://agent.local"
# Rows per listImages page while resolving a selector (the page size bound on a hot-path read).
SELECT_PAGE = 200
MAX_SELECTION = 5000
MAX_IDS = 200


class ApiCallError(Exception):
    """A route answered >= 400. `code` and `message` come from the API's Error envelope."""

    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


def _error_from(response: httpx.Response) -> ApiCallError:
    try:
        body = response.json()
        err = body["error"]
        return ApiCallError(
            response.status_code, str(err["code"]), str(err["message"]), err.get("details") or {}
        )
    except Exception:
        return ApiCallError(response.status_code, "http_error", f"HTTP {response.status_code}")


class ApiCaller:
    """Calls the app's routes in-process with the launch token, scoped to one project."""

    def __init__(self, app, token: str, project_id: str):
        self._app = app
        self._token = token
        self.project_id = project_id
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                transport=httpx.ASGITransport(app=self._app),
                base_url=BASE_URL,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=60,
            )
        return self._client

    def _url(self, path: str) -> str:
        if path.startswith("/api/"):
            return path
        return f"/api/v1/projects/{self.project_id}{path}"

    async def call(self, method: str, path: str, *, json: Any = None, params: dict | None = None) -> Any:
        """Parsed JSON of the response (None for an empty body); `ApiCallError` for >= 400."""
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        for k, v in clean.items():
            if isinstance(v, bool):
                clean[k] = "true" if v else "false"
        response = await self._http().request(method, self._url(path), json=json, params=clean or None)
        if response.status_code >= 400:
            raise _error_from(response)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def fetch_bytes(self, path: str, params: dict | None = None) -> bytes:
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        response = await self._http().get(self._url(path), params=clean or None)
        if response.status_code >= 400:
            raise _error_from(response)
        return response.content

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self) -> ApiCaller:
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()


class ImageSelector(BaseModel):
    """Which images a tool acts on: explicit ids, or a filtered, sorted slice of the project."""

    model_config = ConfigDict(extra="forbid")

    image_ids: list[str] | None = Field(
        None,
        max_length=MAX_IDS,
        description="Explicit image ids (at most 200). When given, every other field is ignored.",
    )
    source_id: str | None = Field(None, description="Only images imported from this source.")
    labeled: bool | None = Field(
        None,
        description="true: images with an accepted/edited box or marked empty; false: images with neither.",
    )
    has_pending: bool | None = Field(
        None, description="true: images with unreviewed suggestions (the review queue); false: none."
    )
    search: str | None = Field(None, description="Case-insensitive substring of the image path or file name.")
    sort: Literal["path", "capture_time", "created_at", "box_count", "pending_count"] = "path"
    order: Literal["asc", "desc"] = "asc"
    offset: int = Field(0, ge=0, description="Skip this many matching images first.")
    limit: int = Field(100, ge=1, le=MAX_SELECTION, description="Take at most this many images (1-5000).")


async def resolve_selection(api: ApiCaller, sel: ImageSelector) -> list[str]:
    """The ids the selector names, in order. Pages listImages; never holds more than the ids."""
    if sel.image_ids is not None:
        wanted = list(dict.fromkeys(i for i in sel.image_ids if i))
        if not wanted:
            return []
        page = await api.call("GET", "/images", params={"ids": ",".join(wanted), "limit": len(wanted)})
        found = {item["id"] for item in page["items"]}
        return [i for i in wanted if i in found]

    params: dict[str, Any] = {
        "source_id": sel.source_id,
        "labeled": sel.labeled,
        "has_pending": sel.has_pending,
        "search": sel.search,
        "sort": sel.sort,
        "order": sel.order,
    }
    end = sel.offset + sel.limit
    seen = 0
    ids: list[str] = []
    cursor: str | None = None
    while seen < end:
        page = await api.call(
            "GET", "/images", params={**params, "limit": min(SELECT_PAGE, end - seen), "cursor": cursor}
        )
        for item in page["items"]:
            if seen >= sel.offset and seen < end:
                ids.append(item["id"])
            seen += 1
        cursor = page.get("next_cursor")
        if not cursor or not page["items"]:
            break
    return ids
