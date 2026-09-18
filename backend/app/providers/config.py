"""Per-provider settings the user can edit: model name, rate limit and cost estimate (spec 8).

Persisted under `settings.json["providers"][name]` in the app-data folder. Keys never go here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields

from app.appdata import AppData
from app.errors import AppError

SETTINGS_KEY = "providers"


@dataclass
class ProviderConfig:
    name: str
    model_name: str
    requests_per_minute: int = 30
    cost_per_request: float = 0.02


DEFAULTS: dict[str, ProviderConfig] = {
    "openai": ProviderConfig("openai", "gpt-5"),
    "anthropic": ProviderConfig("anthropic", "claude-opus-5"),
}
EDITABLE = ("model_name", "requests_per_minute", "cost_per_request")


class ProviderConfigStore:
    def __init__(self, appdata: AppData):
        self.appdata = appdata

    def get(self, name: str) -> ProviderConfig:
        if name not in DEFAULTS:
            raise AppError("not_found", f"provider {name} not found", 404)
        stored = (self.appdata.read_settings().get(SETTINGS_KEY) or {}).get(name) or {}
        known = {f.name for f in fields(ProviderConfig)}
        values = {**asdict(DEFAULTS[name]), **{k: v for k, v in stored.items() if k in known}}
        values["name"] = name
        return ProviderConfig(**values)

    def update(self, name: str, **changes) -> ProviderConfig:
        current = self.get(name)
        for k, v in changes.items():
            if k not in EDITABLE:
                raise AppError("validation_error", f"{k!r} is not an editable provider setting", 422)
            setattr(current, k, v)
        settings = self.appdata.read_settings()
        settings.setdefault(SETTINGS_KEY, {})[name] = asdict(current)
        self.appdata.write_settings(settings)
        return current

    def all(self) -> list[ProviderConfig]:
        return [self.get(name) for name in DEFAULTS]
