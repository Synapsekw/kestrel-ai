"""Builds the provider a query run or a provider test needs (spec section 8).

The SDK modules are imported inside the functions: the API process should not pay for `anthropic`,
`openai`, `torch` or `ultralytics` at startup.
"""

from __future__ import annotations

from app.providers.base import Provider, ProviderError
from app.providers.config import ProviderConfig
from app.providers.keys import KeyStore


def cloud_provider(name: str, keys: KeyStore, config: ProviderConfig) -> Provider:
    key = keys.get(name)
    if not key:
        raise ProviderError(f"no API key stored for {name}", retryable=False)
    if name == "anthropic":
        from app.providers.anthropic_provider import AnthropicProvider

        return AnthropicProvider(api_key=key, model_name=config.model_name)
    from app.providers.openai_provider import OpenAIProvider

    return OpenAIProvider(api_key=key, model_name=config.model_name)
