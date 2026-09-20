"""Provider keys, configuration and the /providers endpoints (spec sections 8 and 10)."""

import json

import pytest

from app.appdata import AppData
from app.main import create_app
from app.providers.config import DEFAULTS, ProviderConfigStore
from app.providers.keys import MemoryKeyStore

SECRET = "sk-test-do-not-log-4f8c2a"


def test_memory_key_store_round_trips_and_deletes_missing_keys_quietly():
    store = MemoryKeyStore()
    assert store.get("openai") is None
    store.set("openai", SECRET)
    assert store.get("openai") == SECRET
    store.delete("openai")
    store.delete("openai")  # deleting what is not there is a no-op
    assert store.get("openai") is None


def test_config_store_defaults_and_updates(tmp_path):
    store = ProviderConfigStore(AppData(tmp_path))
    assert store.get("anthropic").model_name == DEFAULTS["anthropic"].model_name
    assert store.get("openai").requests_per_minute == 30
    store.update("openai", model_name="gpt-5-mini", requests_per_minute=120)
    assert [c.name for c in store.all()] == ["openai", "anthropic"]
    reopened = ProviderConfigStore(AppData(tmp_path))
    assert reopened.get("openai").model_name == "gpt-5-mini"
    assert reopened.get("openai").requests_per_minute == 120


def test_list_providers_shows_defaults_without_keys(client):
    items = client.get("/api/v1/providers").json()["items"]
    assert [i["name"] for i in items] == ["openai", "anthropic"]
    assert all(i["has_key"] is False for i in items)
    assert {i["name"]: i["model_name"] for i in items} == {"openai": "gpt-5", "anthropic": "claude-opus-5"}
    assert all(i["requests_per_minute"] == 30 and i["cost_per_request"] == 0.02 for i in items)


def test_setting_a_key_never_leaks_it(client, settings):
    r = client.put("/api/v1/providers/anthropic/key", json={"api_key": SECRET})
    assert r.status_code == 204, r.text
    assert SECRET not in r.text
    items = client.get("/api/v1/providers").json()["items"]
    assert {i["name"]: i["has_key"] for i in items} == {"openai": False, "anthropic": True}
    assert SECRET not in client.get("/api/v1/providers").text
    client.patch("/api/v1/providers/anthropic", json={"requests_per_minute": 42})  # force a settings write
    assert SECRET not in (settings.data_dir / "settings.json").read_text("utf-8")
    assert SECRET not in (settings.data_dir / "logs" / "backend.log").read_text("utf-8")


def test_deleting_a_key_clears_has_key(client):
    client.put("/api/v1/providers/openai/key", json={"api_key": SECRET})
    assert client.delete("/api/v1/providers/openai/key").status_code == 204
    items = client.get("/api/v1/providers").json()["items"]
    assert all(i["has_key"] is False for i in items)
    assert client.delete("/api/v1/providers/openai/key").status_code == 204  # idempotent


def test_empty_key_is_rejected(client):
    assert client.put("/api/v1/providers/openai/key", json={"api_key": ""}).status_code == 422


def test_patch_persists_across_a_new_app_on_the_same_data_dir(client, settings):
    body = {"model_name": "claude-sonnet-5", "requests_per_minute": 90}
    r = client.patch("/api/v1/providers/anthropic", json=body)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "name": "anthropic",
        "has_key": False,
        "model_name": "claude-sonnet-5",
        "requests_per_minute": 90,
        "cost_per_request": 0.02,
    }
    stored = json.loads((settings.data_dir / "settings.json").read_text("utf-8"))
    assert stored["providers"]["anthropic"]["model_name"] == "claude-sonnet-5"

    from fastapi.testclient import TestClient

    reopened = create_app(settings)
    reopened.state.keys = MemoryKeyStore()
    with TestClient(reopened, headers={"Authorization": f"Bearer {settings.token}"}) as c2:
        again = [i for i in c2.get("/api/v1/providers").json()["items"] if i["name"] == "anthropic"][0]
    assert again["model_name"] == "claude-sonnet-5"
    assert again["requests_per_minute"] == 90


def test_patch_rejects_an_unknown_provider(client):
    assert client.patch("/api/v1/providers/gemini", json={"model_name": "x"}).status_code == 422


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_test_endpoint_without_a_key_is_not_ok(client, provider):
    r = client.post(f"/api/v1/providers/{provider}/test")
    assert r.status_code == 200, r.text
    expected = {"ok": False, "message": "no API key stored", "model_name": DEFAULTS[provider].model_name}
    assert r.json() == expected


def test_the_windows_credential_manager_backend_is_pinned_explicitly():
    """PyInstaller does not ship keyring's entry points, so the backend cannot be discovered."""
    import sys

    import keyring

    from app.providers.keys import KeyringKeyStore

    store = KeyringKeyStore()
    module = store._keyring()  # the lazy import, which pins the backend on Windows

    assert module is keyring
    if sys.platform == "win32":
        from keyring.backends.Windows import WinVaultKeyring

        assert isinstance(keyring.get_keyring(), WinVaultKeyring)


class _FakeKeyringErrors:
    class PasswordDeleteError(Exception):
        pass


class FakeKeyring:
    """Stands in for the `keyring` module so no test touches the real Credential Manager."""

    def __init__(self):
        self.store: dict[tuple[str, str], str] = {}
        self.errors = _FakeKeyringErrors

    def get_password(self, service, user):
        return self.store.get((service, user))

    def set_password(self, service, user, password):
        self.store[(service, user)] = password

    def delete_password(self, service, user):
        if (service, user) not in self.store:
            raise self.errors.PasswordDeleteError(service)
        del self.store[(service, user)]


def _store_with(fake):
    from app.providers.keys import KeyringKeyStore

    store = KeyringKeyStore()
    store._keyring = lambda: fake
    return store


def test_a_key_stored_under_the_old_service_name_is_migrated_on_read():
    from app.providers.keys import LEGACY_SERVICE, SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "openai")] = SECRET
    store = _store_with(fake)

    assert store.get("openai") == SECRET
    assert fake.store[(SERVICE, "openai")] == SECRET
    assert (LEGACY_SERVICE, "openai") not in fake.store  # moved, not copied


def test_migration_is_idempotent_and_does_not_consult_the_legacy_service_again():
    from app.providers.keys import LEGACY_SERVICE, SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "anthropic")] = SECRET
    store = _store_with(fake)

    assert store.get("anthropic") == SECRET
    fake.store[(LEGACY_SERVICE, "anthropic")] = "stale-value-that-must-not-win"
    assert store.get("anthropic") == SECRET
    assert fake.store[(SERVICE, "anthropic")] == SECRET


def test_a_deleted_key_cannot_resurrect_from_the_legacy_service():
    from app.providers.keys import LEGACY_SERVICE

    fake = FakeKeyring()
    fake.store[(LEGACY_SERVICE, "openai")] = SECRET
    store = _store_with(fake)

    store.delete("openai")
    assert store.get("openai") is None
    assert fake.store == {}
    store.delete("openai")  # still idempotent


def test_no_key_anywhere_reads_as_none():
    fake = FakeKeyring()
    assert _store_with(fake).get("openai") is None
