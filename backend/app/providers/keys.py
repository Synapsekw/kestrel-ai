"""API keys live in Windows Credential Manager, never in the project or app-data folders (spec 10).

The store is the only place a key is read from; nothing else may copy one into a log, a settings
file or an error message.
"""

from __future__ import annotations

import sys
from typing import Protocol

SERVICE = "kestrel-ai"
# Pre-rename service name (Machinery Detection). Kept so keys stored by an older build are
# migrated on first read; safe to delete once no old install remains in the field.
LEGACY_SERVICE = "machinery-app"


class KeyStore(Protocol):
    def get(self, provider: str) -> str | None: ...
    def set(self, provider: str, key: str) -> None: ...
    def delete(self, provider: str) -> None: ...


class KeyringKeyStore:
    """Credential Manager through `keyring`; imported lazily so the API starts without it."""

    def __init__(self, service: str = SERVICE, legacy_service: str = LEGACY_SERVICE):
        self.service = service
        self.legacy_service = legacy_service
        self._pinned = False

    def _keyring(self):
        """`keyring`, with the Windows backend pinned the first time it is needed.

        keyring finds its backend through setuptools entry points, which a PyInstaller one-folder
        build does not ship: without this the packaged sidecar silently falls back to the fail
        backend and every key read returns nothing. Naming the backend costs nothing here and
        removes that failure mode from the build entirely.
        """
        import keyring

        if not self._pinned:
            if sys.platform == "win32":
                from keyring.backends.Windows import WinVaultKeyring

                keyring.set_keyring(WinVaultKeyring())
            self._pinned = True
        return keyring

    def get(self, provider: str) -> str | None:
        current = self._keyring().get_password(self.service, provider)
        if current:
            return current
        legacy = self._keyring().get_password(self.legacy_service, provider)
        if not legacy:
            return None
        # Move it across once, so the next read is a plain hit and the old entry stops existing.
        self._keyring().set_password(self.service, provider, legacy)
        self._forget(self.legacy_service, provider)
        return legacy

    def set(self, provider: str, key: str) -> None:
        self._keyring().set_password(self.service, provider, key)

    def delete(self, provider: str) -> None:
        self._forget(self.service, provider)
        # Also clear any pre-rename entry, or `get` would resurrect what was just deleted.
        self._forget(self.legacy_service, provider)

    def _forget(self, service: str, provider: str) -> None:
        keyring = self._keyring()
        try:
            keyring.delete_password(service, provider)
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
