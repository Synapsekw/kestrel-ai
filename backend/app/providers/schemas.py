"""Pydantic models for the /providers endpoints, matching contract/openapi.yaml exactly."""

from typing import Literal

from pydantic import BaseModel, Field

from app.providers.config import ProviderConfig

ProviderName = Literal["openai", "anthropic"]


class ProviderOut(BaseModel):
    name: ProviderName
    has_key: bool
    model_name: str
    requests_per_minute: int
    cost_per_request: float

    @classmethod
    def from_config(cls, config: ProviderConfig, has_key: bool) -> "ProviderOut":
        return cls(
            name=config.name,
            has_key=has_key,
            model_name=config.model_name,
            requests_per_minute=config.requests_per_minute,
            cost_per_request=config.cost_per_request,
        )


class ProviderList(BaseModel):
    items: list[ProviderOut]


class ProviderUpdate(BaseModel):
    """Optional but not nullable, like `BoxUpdate`: an explicit null is a 422, not a reset."""

    model_name: str = Field(default=None, min_length=1)
    requests_per_minute: int = Field(default=None, ge=1, le=10000)
    cost_per_request: float = Field(default=None, ge=0)


class ProviderKey(BaseModel):
    api_key: str = Field(min_length=1)


class ProviderTestResult(BaseModel):
    ok: bool
    message: str
    model_name: str
