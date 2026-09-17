"""The WebView2 origin differs from the backend origin, so browsers preflight requests with the bearer header."""

import pytest

ALLOWED = [
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:1420",
    "http://localhost:1420",
]


@pytest.mark.parametrize("origin", ALLOWED)
def test_preflight_from_app_origins_is_allowed(anon, origin):
    r = anon.options(
        "/api/v1/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == origin
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_preflight_from_other_origin_is_refused(anon):
    r = anon.options(
        "/api/v1/health",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in r.headers


def test_actual_request_carries_allow_origin(client):
    r = client.get("/api/v1/health", headers={"Origin": "http://tauri.localhost"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://tauri.localhost"
