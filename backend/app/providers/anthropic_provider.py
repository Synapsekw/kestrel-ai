"""Claude as a vision provider: Messages API, base64 tiles, JSON-schema structured output (spec 8).

The SDK is imported inside the methods so the API process starts without it. Nothing here ever
puts the API key into a log line, an exception message or a persisted response.
"""

from __future__ import annotations

import base64
import io
import logging

from app.providers.base import ProviderError, Tile, TileResult
from app.providers.schema import box_list_schema, parse_text, prompt_for
from app.providers.tiling import TiledProvider, crop_tile

MAX_TOKENS = 16000
PING_MAX_TOKENS = 16
JPEG_QUALITY = 90


def encode_tile(image, tile: Tile, max_side: int) -> str:
    """The tile as base64 JPEG. Coordinates are normalised, so downscaling is free of consequence."""
    crop = crop_tile(image, tile)
    if max(crop.size) > max_side:
        crop.thumbnail((max_side, max_side))
    buffer = io.BytesIO()
    crop.convert("RGB").save(buffer, "JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _as_provider_error(e: Exception) -> ProviderError:
    """Map SDK failures onto retryable / permanent. 4xx is the caller's fault and never retried."""
    import anthropic

    if isinstance(e, anthropic.RateLimitError):
        after = (e.response.headers.get("retry-after") or "").strip()
        return ProviderError(
            "anthropic rate limited (429)",
            retryable=True,
            retry_after=int(after) if after.isdigit() else None,
        )
    if isinstance(e, anthropic.APIStatusError):
        retryable = e.status_code >= 500
        return ProviderError(f"anthropic returned {e.status_code}: {e.message}", retryable=retryable)
    if isinstance(e, anthropic.APIConnectionError):
        return ProviderError(f"could not reach anthropic: {type(e).__name__}", retryable=True)
    return ProviderError(f"anthropic call failed: {type(e).__name__}: {e}", retryable=False)


class AnthropicProvider(TiledProvider):
    name = "anthropic"

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
        import anthropic

        return anthropic.Anthropic(api_key=self._api_key)

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
            response = self.client.messages.create(
                model=self.model_name,
                max_tokens=MAX_TOKENS,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
                            },
                            {"type": "text", "text": prompt_for(query, classes)},
                        ],
                    }
                ],
                output_config={"format": {"type": "json_schema", "schema": box_list_schema(classes)}},
            )
        except Exception as e:
            raise _as_provider_error(e) from e

        raw = {"id": response.id, "model": response.model, "stop_reason": response.stop_reason}
        if response.stop_reason == "refusal":
            details = response.stop_details
            refusal = {
                "category": getattr(details, "category", None),
                "explanation": getattr(details, "explanation", None),
            }
            log.warning(
                "anthropic refused tile %s: category=%s explanation=%s",
                tile.index,
                refusal["category"],
                refusal["explanation"],
            )
            return TileResult(tile=tile, detections=[], refusal=refusal, raw={**raw, "refusal": refusal})
        if response.stop_reason == "max_tokens":
            raise ProviderError("anthropic output truncated at max_tokens", retryable=False)

        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise ProviderError("anthropic returned no text block", retryable=False)
        return TileResult(
            tile=tile,
            detections=parse_text(text, tile, classes, raw_ref),
            raw={**raw, "text": text},
        )

    def ping(self) -> str:
        """One cheap call to prove the key works; returns the model that answered."""
        try:
            response = self.client.messages.create(
                model=self.model_name,
                max_tokens=PING_MAX_TOKENS,
                messages=[{"role": "user", "content": "Reply with OK"}],
            )
        except Exception as e:
            raise _as_provider_error(e) from e
        return response.model or self.model_name
