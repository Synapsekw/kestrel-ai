"""Cloud provider configuration, keys and the connectivity test (spec sections 8 and 10).

No handler ever puts an API key into a response, a log line or an error message.
"""

import time

from fastapi import APIRouter, Request, Response

from app.providers import factory
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyStore
from app.providers.schemas import (
    ProviderKey,
    ProviderList,
    ProviderName,
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
def update_provider(provider: ProviderName, body: ProviderUpdate, request: Request) -> ProviderOut:
    keys, config = _stores(request)
    updated = config.update(provider, **body.model_dump(exclude_unset=True))
    return ProviderOut.from_config(updated, keys.get(provider) is not None)


@router.put("/{provider}/key", status_code=204)
def set_provider_key(provider: ProviderName, body: ProviderKey, request: Request) -> Response:
    _stores(request)[0].set(provider, body.api_key)
    return Response(status_code=204)


@router.delete("/{provider}/key", status_code=204)
def delete_provider_key(provider: ProviderName, request: Request) -> Response:
    _stores(request)[0].delete(provider)
    return Response(status_code=204)


@router.post("/{provider}/test", response_model=ProviderTestResult)
def test_provider(provider: ProviderName, request: Request) -> ProviderTestResult:
    """One cheap call with the stored key. Any failure is a result, never a 500."""
    keys, config = _stores(request)
    cfg = config.get(provider)
    if keys.get(provider) is None:
        return ProviderTestResult(ok=False, message="no API key stored", model_name=cfg.model_name)
    started = time.monotonic()
    try:
        model_name = factory.cloud_provider(provider, keys, cfg).ping()
    except Exception as e:  # the message is the SDK's; it never carries the key
        return ProviderTestResult(ok=False, message=f"{type(e).__name__}: {e}", model_name=cfg.model_name)
    return ProviderTestResult(
        ok=True, message=f"responded in {time.monotonic() - started:.1f} s", model_name=model_name
    )
