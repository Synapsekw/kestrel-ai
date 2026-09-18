"""GPT as a vision provider: Responses API, data-URL tiles, strict JSON-schema output (spec 8).

The SDK is imported inside the methods so the API process starts without it. Nothing here ever
puts the API key into a log line, an exception message or a persisted response.
"""

from __future__ import annotations

import logging

from app.providers.base import ProviderError, Tile, TileResult
from app.providers.schema import box_list_schema, parse_text, prompt_for
from app.providers.tiling import TiledProvider, encode_tile

REFUSAL_CATEGORY = "openai_refusal"


def _as_provider_error(e: Exception) -> ProviderError:
    """Map SDK failures onto retryable / permanent. 4xx is the caller's fault and never retried."""
    import openai

    if isinstance(e, openai.RateLimitError):
        after = (e.response.headers.get("retry-after") or "").strip()
        return ProviderError(
            "openai rate limited (429)",
            retryable=True,
            retry_after=int(after) if after.isdigit() else None,
        )
    if isinstance(e, openai.APIStatusError):
        return ProviderError(f"openai returned {e.status_code}: {e.message}", retryable=e.status_code >= 500)
    if isinstance(e, openai.APIConnectionError):
        return ProviderError(f"could not reach openai: {type(e).__name__}", retryable=True)
    return ProviderError(f"openai call failed: {type(e).__name__}: {e}", retryable=False)


def _refusal(response) -> str | None:
    """A Responses refusal arrives as a `refusal` content part inside the message output item."""
    for item in response.output or []:
        if getattr(item, "type", None) == "refusal":  # a bare refusal item, should the API emit one
            return getattr(item, "refusal", "") or ""
        for part in getattr(item, "content", None) or []:
            if getattr(part, "type", None) == "refusal":
                return getattr(part, "refusal", "") or ""
    return None


class OpenAIProvider(TiledProvider):
    name = "openai"

    def __init__(self, api_key: str, model_name: str, max_side: int = 1280, client_factory=None):
        self._api_key = api_key
        self.model_name = model_name
        self.max_side = max_side
        self._client_factory = client_factory
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = self._client_factory() if self._client_factory else self._default_client()
        return self._client

    def _default_client(self):
        import openai

        return openai.OpenAI(api_key=self._api_key)

    def detect_tile(
        self,
        image,
        tile: Tile,
        query: str,
        classes: list[str],
        *,
        conf: float,
        log: logging.Logger,
        raw_ref: str = "",
    ) -> TileResult:
        data = encode_tile(image, tile, self.max_side)
        try:
            response = self.client.responses.create(
                model=self.model_name,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_image",
                                "image_url": f"data:image/jpeg;base64,{data}",
                                "detail": "high",
                            },
                            {"type": "input_text", "text": prompt_for(query, classes)},
                        ],
                    }
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "boxes",
                        "schema": box_list_schema(classes),
                        "strict": True,
                    }
                },
            )
        except Exception as e:
            raise _as_provider_error(e) from e

        raw = {"id": response.id, "model": response.model, "status": response.status}
        refused = _refusal(response)
        if refused is not None:
            refusal = {"category": REFUSAL_CATEGORY, "explanation": refused}
            log.warning("openai refused tile %s: %s", tile.index, refused)
            return TileResult(tile=tile, detections=[], refusal=refusal, raw={**raw, "refusal": refusal})
        if response.status == "incomplete":
            reason = getattr(response.incomplete_details, "reason", None)
            raise ProviderError(f"openai output truncated ({reason})", retryable=False)

        return TileResult(
            tile=tile,
            detections=parse_text(response.output_text, tile, classes, raw_ref),
            raw={**raw, "text": response.output_text},
        )

    def ping(self) -> str:
        """One cheap call to prove the key works; returns the model that answered."""
        try:
            response = self.client.responses.create(model=self.model_name, input="Reply with OK")
        except Exception as e:
            raise _as_provider_error(e) from e
        return response.model or self.model_name
