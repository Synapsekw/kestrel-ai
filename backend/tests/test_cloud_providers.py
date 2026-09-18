"""The two cloud vision providers against recorded responses (spec sections 8 and 12).

Responses are replayed through the real SDK response types, so a change in the SDK's shape shows
up here rather than in production. No test carries or prints a key.
"""

import json
import logging
from pathlib import Path

import anthropic
import httpx
import pytest
from PIL import Image as PILImage

from app.providers.base import ProviderError, Tile
from app.providers.schema import box_list_schema

FIXTURES = Path(__file__).parent / "fixtures" / "providers"
CLASSES = ["excavator", "dump_truck"]
TILE = Tile(index=1, x=1024, y=0, w=1280, h=1280)
FAKE_KEY = "sk-not-a-real-key-7b1c"
LOG = logging.getLogger("provider-test")


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text("utf-8"))


@pytest.fixture
def image() -> PILImage.Image:
    return PILImage.new("RGB", (4000, 2667), "grey")


def request_for(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "https://example.invalid/v1"))


# ------------------------------------------------------------------ anthropic


class FakeMessages:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes[min(len(self.calls), len(self.outcomes)) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return anthropic.types.Message.model_validate(outcome)


class FakeAnthropic:
    def __init__(self, *outcomes):
        self.messages = FakeMessages(outcomes)


def anthropic_provider(*outcomes):
    from app.providers.anthropic_provider import AnthropicProvider

    client = FakeAnthropic(*outcomes)
    provider = AnthropicProvider(api_key=FAKE_KEY, model_name="claude-opus-5", client_factory=lambda: client)
    return provider, client


def test_anthropic_parses_boxes_and_maps_them_to_full_image_pixels(image):
    provider, client = anthropic_provider(fixture("anthropic_boxes"))
    result = provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG, raw_ref="r.json")

    # the third box in the fixture has a label outside the project's classes and is dropped
    assert [d.label for d in result.detections] == ["dump_truck", "excavator"]
    assert [(d.x, d.y, d.w, d.h) for d in result.detections] == [
        pytest.approx((1664.0, 640.0, 128.0, 256.0)),
        pytest.approx((1152.0, 256.0, 64.0, 64.0)),
    ]
    assert result.detections[0].raw_ref == "r.json"
    assert result.refusal is None
    assert result.raw["stop_reason"] == "end_turn"


def test_anthropic_sends_the_documented_request(image):
    provider, client = anthropic_provider(fixture("anthropic_boxes"))
    provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)

    (call,) = client.messages.calls
    assert call["model"] == "claude-opus-5"
    assert call["max_tokens"] == 16000
    assert "thinking" not in call and "stream" not in call  # adaptive thinking stays at its default
    assert call["output_config"] == {"format": {"type": "json_schema", "schema": box_list_schema(CLASSES)}}
    (message,) = call["messages"]
    assert message["role"] == "user"  # never an assistant prefill
    img, text = message["content"]
    assert img["type"] == "image" and img["source"]["media_type"] == "image/jpeg"
    assert "dump trucks" in text["text"]
    assert FAKE_KEY not in json.dumps({k: v for k, v in call.items() if k != "messages"})


def test_anthropic_refusal_is_an_empty_tile_with_the_category_logged(image, caplog):
    provider, _ = anthropic_provider(fixture("anthropic_refusal"))
    with caplog.at_level(logging.WARNING, logger="provider-test"):
        result = provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)

    assert result.detections == []
    assert result.refusal == {
        "category": "general_harms",
        "explanation": "This request was declined by a safety classifier.",
    }
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "general_harms" in logged and "refus" in logged


def test_anthropic_truncated_output_is_a_permanent_error(image):
    provider, _ = anthropic_provider(fixture("anthropic_truncated"))
    with pytest.raises(ProviderError) as e:
        provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)
    assert e.value.retryable is False
    assert "truncated" in str(e.value)


def test_anthropic_rate_limit_is_retryable_with_the_retry_after_header(image):
    response = httpx.Response(
        429,
        headers={"retry-after": "7"},
        request=httpx.Request("POST", "https://example.invalid/v1"),
    )
    error = anthropic.RateLimitError("rate limited", response=response, body=None)
    provider, _ = anthropic_provider(error)
    with pytest.raises(ProviderError) as e:
        provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)
    assert e.value.retryable is True
    assert e.value.retry_after == 7


@pytest.mark.parametrize("status", [500, 503])
def test_anthropic_server_errors_are_retryable(image, status):
    error = anthropic.APIStatusError("upstream", response=request_for(status), body=None)
    provider, _ = anthropic_provider(error)
    with pytest.raises(ProviderError) as e:
        provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)
    assert e.value.retryable is True


def test_anthropic_connection_errors_are_retryable(image):
    error = anthropic.APIConnectionError(request=httpx.Request("POST", "https://example.invalid/v1"))
    provider, _ = anthropic_provider(error)
    with pytest.raises(ProviderError) as e:
        provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)
    assert e.value.retryable is True


def test_anthropic_auth_failure_is_permanent_and_never_shows_the_key(image):
    error = anthropic.AuthenticationError("invalid x-api-key", response=request_for(401), body=None)
    provider, _ = anthropic_provider(error)
    with pytest.raises(ProviderError) as e:
        provider.detect_tile(image, TILE, "dump trucks", CLASSES, conf=0.25, log=LOG)
    assert e.value.retryable is False
    assert FAKE_KEY not in str(e.value)
    assert "401" in str(e.value)


def test_anthropic_ping_returns_the_model_that_answered():
    provider, client = anthropic_provider(fixture("anthropic_ping"))
    assert provider.ping() == "claude-opus-5-20260101"
    assert client.messages.calls[0]["max_tokens"] == 16


def test_anthropic_detect_tiles_the_whole_image(tmp_path):
    from app.providers.base import TilingSpec

    path = tmp_path / "frame.jpg"
    PILImage.new("RGB", (2000, 1280), "grey").save(path, "JPEG")
    provider, client = anthropic_provider(fixture("anthropic_boxes"))
    dets = provider.detect(path, "dump trucks", CLASSES, TilingSpec(), conf=0.25, log=LOG)
    assert len(client.messages.calls) == 2  # two tiles
    assert {d.label for d in dets} == {"dump_truck", "excavator"}
