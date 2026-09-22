"""Live cloud calls, one tile each (spec section 12: live calls only behind an environment flag).

Marked `live` and excluded by default: `pytest -m live -q tests/test_providers_live.py`.
Keys are read from the environment at call time and never stored, logged or asserted on.
"""

import logging
import os

import pytest
from local_paths import FRAMES_DIR
from PIL import Image as PILImage

from app.providers.base import Tile
from app.providers.config import DEFAULTS

pytestmark = pytest.mark.live

FRAMES = FRAMES_DIR
CLASSES = ["excavator", "wheel_loader", "bulldozer", "dump_truck", "crane"]
TILE = Tile(index=0, x=1024, y=512, w=1280, h=1280)
LOG = logging.getLogger("live")


def key_or_skip(name: str) -> str:
    key = os.environ.get(name)
    if not key:
        pytest.skip(f"{name} is not set")
    return key


@pytest.fixture
def frame() -> PILImage.Image:
    if not FRAMES.is_dir():
        pytest.skip(f"{FRAMES} not present")
    with PILImage.open(sorted(FRAMES.glob("*.jpg"))[0]) as im:
        return im.convert("RGB")


def test_anthropic_answers_a_real_tile(frame):
    from app.providers.anthropic_provider import AnthropicProvider

    provider = AnthropicProvider(key_or_skip("ANTHROPIC_API_KEY"), DEFAULTS["anthropic"].model_name)
    result = provider.detect_tile(frame, TILE, "vehicles", CLASSES, conf=0.25, log=LOG)

    assert isinstance(result.detections, list)
    assert result.refusal is None or set(result.refusal) == {"category", "explanation"}
    for d in result.detections:
        assert d.label in CLASSES
        assert TILE.x <= d.x and d.x + d.w <= TILE.x + TILE.w


def test_anthropic_ping_names_a_model():
    from app.providers.anthropic_provider import AnthropicProvider

    provider = AnthropicProvider(key_or_skip("ANTHROPIC_API_KEY"), DEFAULTS["anthropic"].model_name)
    assert provider.ping().startswith("claude")


def test_openai_answers_a_real_tile(frame):
    from app.providers.openai_provider import OpenAIProvider

    provider = OpenAIProvider(key_or_skip("OPENAI_API_KEY"), DEFAULTS["openai"].model_name)
    result = provider.detect_tile(frame, TILE, "vehicles", CLASSES, conf=0.25, log=LOG)

    assert isinstance(result.detections, list)
    for d in result.detections:
        assert d.label in CLASSES
        assert TILE.x <= d.x and d.x + d.w <= TILE.x + TILE.w


def test_the_default_openai_model_name_exists():
    """Spec 15 leaves the OpenAI model name open: check the configured default is still served."""
    import openai

    client = openai.OpenAI(api_key=key_or_skip("OPENAI_API_KEY"))
    served = {m.id for m in client.models.list()}
    assert DEFAULTS["openai"].model_name in served, sorted(n for n in served if n.startswith("gpt"))


def test_openai_ping_names_a_model():
    from app.providers.openai_provider import OpenAIProvider

    provider = OpenAIProvider(key_or_skip("OPENAI_API_KEY"), DEFAULTS["openai"].model_name)
    assert provider.ping()
