import pytest


def test_404_uses_error_envelope(client):
    r = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "not_found"
    assert set(body["error"]) == {"code", "message", "details"}


@pytest.mark.xfail(strict=True, reason="projects router arrives in Task 5")
def test_validation_error_uses_envelope(client):
    r = client.post("/api/v1/projects", json={"name": 5})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert "errors" in r.json()["error"]["details"]


def test_unknown_route_uses_error_envelope(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
