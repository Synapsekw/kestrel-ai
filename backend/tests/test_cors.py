"""Browsers preflight cross-origin requests that carry the bearer header (WebView2 and Vite origins)."""

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


def test_preflight_for_the_octree_loader_allows_range_and_content_type(anon):
    """potree-core asks for byte ranges with a multipart content-type, which forces a preflight."""
    r = anon.options(
        "/api/v1/health",
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type,range",
        },
    )
    assert r.status_code == 200, r.text
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "range" in allowed and "content-type" in allowed


def test_responses_expose_the_range_headers_to_the_loader(client):
    r = client.get("/api/v1/health", headers={"Origin": "http://tauri.localhost"})
    exposed = {h.strip().lower() for h in r.headers["access-control-expose-headers"].split(",")}
    assert exposed == {"content-range", "accept-ranges", "content-length"}
