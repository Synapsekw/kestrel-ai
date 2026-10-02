"""Cloud provider configuration, keys and the connectivity test (spec sections 8 and 10).

No handler ever puts an API key into a response, a log line or an error message.
"""

import time

from fastapi import APIRouter, Request, Response

from app.project_agent.history import LlmError
from app.providers import factory, gemini_ping
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyStore
from app.providers.schemas import (
    KeyedProviderName,
    ProviderKey,
    ProviderList,
    ProviderOut,
    ProviderTestResult,
    ProviderUpdate,
)

router = APIRouter(prefix="/providers", tags=["providers"])


def _stores(request: Request) -> tuple[KeyStore, ProviderConfigStore]:
    return request.app.state.keys, request.app.state.provider_config


@router.get("", response_model=ProviderList)
def list_providers(request: Request) -> ProviderList:
    keys, config = _stores(request)
    items = [ProviderOut.from_config(c, keys.get(c.name) is not None) for c in config.all()]
    return ProviderList(items=items)


@router.patch("/{provider}", response_model=ProviderOut)
def update_provider(provider: KeyedProviderName, body: ProviderUpdate, request: Request) -> ProviderOut:
    keys, config = _stores(request)
    updated = config.update(provider, **body.model_dump(exclude_unset=True))
    return ProviderOut.from_config(updated, keys.get(provider) is not None)


@router.put("/{provider}/key", status_code=204)
def set_provider_key(provider: KeyedProviderName, body: ProviderKey, request: Request) -> Response:
    _stores(request)[0].set(provider, body.api_key)
    return Response(status_code=204)


@router.delete("/{provider}/key", status_code=204)
def delete_provider_key(provider: KeyedProviderName, request: Request) -> Response:
    _stores(request)[0].delete(provider)
    return Response(status_code=204)


@router.post("/{provider}/test", response_model=ProviderTestResult)
def test_provider(provider: KeyedProviderName, request: Request) -> ProviderTestResult:
    """One cheap call with the stored key. Any failure is a result, never a 500."""
    keys, config = _stores(request)
    cfg = config.get(provider)
    if keys.get(provider) is None:
        return ProviderTestResult(ok=False, message="no API key stored", model_name=cfg.model_name)
    if provider == "gemini":
        key = keys.get("gemini")
        try:
            gemini_ping.ping(key or "", cfg.model_name)
        except LlmError as e:
            return ProviderTestResult(ok=False, message=e.message, model_name=cfg.model_name)
        finally:
            del key
        return ProviderTestResult(ok=True, message="Google Gemini answered.", model_name=cfg.model_name)
    started = time.monotonic()
    try:
        model_name = factory.cloud_provider(provider, keys, cfg).ping()
    except Exception as e:  # the message is the SDK's; it never carries the key
        return ProviderTestResult(ok=False, message=f"{type(e).__name__}: {e}", model_name=cfg.model_name)
    return ProviderTestResult(
        ok=True, message=f"responded in {time.monotonic() - started:.1f} s", model_name=model_name
    )
