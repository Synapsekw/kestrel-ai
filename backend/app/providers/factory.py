"""Builds the provider a query run, a pre-annotation or a provider test needs (spec section 8).

The SDK modules are imported inside the functions: the API process should not pay for `anthropic`,
`openai`, `torch` or `ultralytics` at startup.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import TYPE_CHECKING

from app.providers.base import Provider, ProviderError
from app.providers.config import ProviderConfig
from app.providers.keys import KeyStore
from app.providers.local_yolo import LocalYoloProvider, build_class_map

if TYPE_CHECKING:
    from app.library.db import LibraryModel


def cloud_provider(name: str, keys: KeyStore, config: ProviderConfig) -> Provider:
    key = keys.get(name)
    if not key:
        raise ProviderError(f"no API key stored for {name}", retryable=False)
    if name == "anthropic":
        from app.providers.anthropic_provider import AnthropicProvider

        return AnthropicProvider(api_key=key, model_name=config.model_name)
    from app.providers.openai_provider import OpenAIProvider

    return OpenAIProvider(api_key=key, model_name=config.model_name)


def get_provider(
    kind: str,
    *,
    weights: Path | None = None,
    keys: KeyStore,
    config: ProviderConfig | None,
    model_row: LibraryModel | None = None,
    provider_name: str | None = None,
    project_class_names: list[str],
    imgsz: int = 1280,
    device: str = "0",
    gpu_timeout: float | None = None,
    cancelled: threading.Event | None = None,
    class_map: dict[str, str] | None = None,
) -> Provider:
    """`local_model` builds from a library model and its weights file (`library.service.weights_file`),
    `cloud_provider` from the stored key and config.

    `class_map` (model class name -> project class name) is a run's own mapping; without one the
    model's classes map by exact name and then by its aliases (`build_class_map`)."""
    if kind == "local_model":
        if weights is None or model_row is None:
            raise ProviderError("a local model run needs a model and its weights", retryable=False)
        return LocalYoloProvider(
            weights=weights,
            class_map=class_map
            if class_map is not None
            else build_class_map(
                model_row.class_names or [], project_class_names, model_row.class_aliases or {}
            ),
            imgsz=imgsz,
            device=device,
            gpu_timeout=gpu_timeout,
            cancelled=cancelled,
        )
    if kind == "cloud_provider":
        if provider_name is None or config is None:
            raise ProviderError("a cloud run needs a provider name and its configuration", retryable=False)
        return cloud_provider(provider_name, keys, config)
    raise ProviderError(f"unknown query run kind {kind!r}", retryable=False)
