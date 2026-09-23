"""The provider factory and the /providers/{provider}/test endpoint (spec section 8)."""

import pytest
from library_helpers import add_library_model

from app.library import service as library
from app.providers.base import ProviderError
from app.providers.config import DEFAULTS
from app.providers.factory import get_provider
from app.providers.keys import MemoryKeyStore
from app.providers.local_yolo import LocalYoloProvider

CLASSES = ["excavator", "dump_truck"]


@pytest.fixture
def model_row(client, app, tmp_path):
    """A library model without touching ultralytics (the weights file is a stand-in)."""
    return add_library_model(
        app,
        tmp_path,
        name="coco",
        class_names=["truck", "car", "excavator"],
        class_aliases={"truck": "dump_truck"},
    )


@pytest.fixture
def weights(app, model_row):
    return library.weights_file(app.state.library, model_row)


def test_local_factory_maps_classes_through_the_models_aliases(weights, model_row):
    provider = get_provider(
        "local_model",
        weights=weights,
        keys=MemoryKeyStore(),
        config=None,
        model_row=model_row,
        project_class_names=CLASSES,
    )
    assert isinstance(provider, LocalYoloProvider)
    assert provider.class_map == {"truck": "dump_truck", "excavator": "excavator"}
    assert provider.weights == weights


def test_local_factory_honours_imgsz_and_device(weights, model_row):
    provider = get_provider(
        "local_model",
        weights=weights,
        keys=MemoryKeyStore(),
        config=None,
        model_row=model_row,
        project_class_names=CLASSES,
        imgsz=2560,
        device="cpu",
    )
    assert (provider.imgsz, provider.device) == (2560, "cpu")


def test_cloud_factory_without_a_key_is_a_permanent_provider_error():
    with pytest.raises(ProviderError) as e:
        get_provider(
            "cloud_provider",
            keys=MemoryKeyStore(),
            config=DEFAULTS["anthropic"],
            provider_name="anthropic",
            project_class_names=CLASSES,
        )
    assert e.value.retryable is False
    assert "no API key stored" in str(e.value)


def test_cloud_factory_builds_the_configured_model(monkeypatch):
    keys = MemoryKeyStore()
    keys.set("openai", "sk-fake")
    from app.providers.config import ProviderConfig

    provider = get_provider(
        "cloud_provider",
        keys=keys,
        config=ProviderConfig("openai", "gpt-5-mini"),
        provider_name="openai",
        project_class_names=CLASSES,
    )
    assert provider.name == "openai"
    assert provider.model_name == "gpt-5-mini"


def test_unknown_kind_is_a_permanent_provider_error():
    with pytest.raises(ProviderError):
        get_provider("psychic", keys=MemoryKeyStore(), config=None, project_class_names=CLASSES)


def test_test_endpoint_reports_the_model_that_answered(client, app, monkeypatch):
    class FakePing:
        model_name = "claude-opus-5"

        def ping(self):
            return "claude-opus-5-20260101"

    app.state.keys.set("anthropic", "sk-fake")
    monkeypatch.setattr("app.providers.factory.cloud_provider", lambda *a, **k: FakePing())

    body = client.post("/api/v1/providers/anthropic/test").json()
    assert body["ok"] is True
    assert body["model_name"] == "claude-opus-5-20260101"
    assert "responded in" in body["message"]


def test_test_endpoint_turns_a_rejected_key_into_a_result_not_a_500(client, app, monkeypatch):
    def boom(*a, **k):
        raise ProviderError("anthropic returned 401: invalid x-api-key", retryable=False)

    app.state.keys.set("anthropic", "sk-fake")
    monkeypatch.setattr("app.providers.factory.cloud_provider", boom)

    r = client.post("/api/v1/providers/anthropic/test")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is False
    assert body["message"] == "ProviderError: anthropic returned 401: invalid x-api-key"
    assert body["model_name"] == DEFAULTS["anthropic"].model_name
    assert "sk-fake" not in r.text
