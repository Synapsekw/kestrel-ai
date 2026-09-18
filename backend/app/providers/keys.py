"""API keys live in Windows Credential Manager, never in the project or app-data folders (spec 10).

The store is the only place a key is read from; nothing else may copy one into a log, a settings
file or an error message.
"""

from __future__ import annotations

from typing import Protocol

SERVICE = "machinery-app"


class KeyStore(Protocol):
    def get(self, provider: str) -> str | None: ...
    def set(self, provider: str, key: str) -> None: ...
    def delete(self, provider: str) -> None: ...


class KeyringKeyStore:
    """Credential Manager through `keyring`; imported lazily so the API starts without it."""

    def __init__(self, service: str = SERVICE):
        self.service = service

    @staticmethod
    def _keyring():
        import keyring

        return keyring

    def get(self, provider: str) -> str | None:
        return self._keyring().get_password(self.service, provider) or None

    def set(self, provider: str, key: str) -> None:
        self._keyring().set_password(self.service, provider, key)

    def delete(self, provider: str) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(self.service, provider)
        except keyring.errors.PasswordDeleteError:  # already gone
            pass


class MemoryKeyStore:
    """Process-local store for tests, so no test ever touches the real Credential Manager."""

    def __init__(self):
        self._values: dict[str, str] = {}

    def get(self, provider: str) -> str | None:
        return self._values.get(provider)

    def set(self, provider: str, key: str) -> None:
        self._values[provider] = key

    def delete(self, provider: str) -> None:
        self._values.pop(provider, None)
