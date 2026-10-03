"""`GET /basemap/{source}/{z}/{x}/{y}` (spec 2026-10-02-site-basemap): a keyless public tile, fetched
once and then served from the app-data cache; offline answers 503 fast, never a stall."""

import pytest

from app.basemap import service

API = "/api/v1"
PNG = b"\x89PNG\r\n\x1a\nfake"


@pytest.fixture
def calls(monkeypatch):
    seen: list[tuple[str, str]] = []

    def fake(url: str, user_agent: str) -> bytes:
        seen.append((url, user_agent))
        return PNG

    monkeypatch.setattr("app.basemap.service.download", fake)
    return seen


def test_a_miss_downloads_the_tile_and_stores_it(client, settings, calls):
    r = client.get(f"{API}/basemap/streets/16/36512/23688")
    assert r.status_code == 200, r.text
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    url = "https://tile.openstreetmap.org/16/36512/23688.png"
    assert calls == [(url, f"KestrelAI-desktop/{settings.version}")]
    assert (settings.data_dir / "basemap" / "streets" / "16" / "36512" / "23688.png").read_bytes() == PNG


def test_satellite_uses_the_row_then_column_order_of_its_server(client, calls):
    r = client.get(f"{API}/basemap/satellite/16/36512/23688")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert calls[0][0] == (
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/23688/36512"
    )


def test_a_hit_is_served_from_disk_without_downloading(client, calls):
    client.get(f"{API}/basemap/streets/3/4/2")
    r = client.get(f"{API}/basemap/streets/3/4/2")
    assert r.status_code == 200
    assert r.content == PNG
    assert len(calls) == 1


def test_an_unknown_source_or_a_tile_off_the_grid_is_refused(client, calls):
    assert client.get(f"{API}/basemap/topo/3/4/2").status_code == 422
    assert client.get(f"{API}/basemap/streets/20/0/0").status_code == 422
    off_grid = client.get(f"{API}/basemap/streets/3/8/0")
    assert off_grid.status_code == 422
    assert off_grid.json()["error"]["code"] == "tile_outside_grid"
    assert calls == []


def test_offline_answers_503_and_backs_off_instead_of_retrying(client, monkeypatch):
    tries: list[str] = []

    def unreachable(url: str, user_agent: str) -> bytes:
        tries.append(url)
        raise OSError("no route to host")

    monkeypatch.setattr("app.basemap.service.download", unreachable)
    first = client.get(f"{API}/basemap/streets/3/4/2")
    assert first.status_code == 503
    assert first.json()["error"]["code"] == "basemap_unavailable"
    assert client.get(f"{API}/basemap/streets/3/5/2").status_code == 503
    assert len(tries) == 1


def _down(url: str, user_agent: str) -> bytes:
    raise OSError("down")


def test_a_cached_tile_is_still_served_while_offline(client, monkeypatch, calls):
    client.get(f"{API}/basemap/streets/3/4/2")
    monkeypatch.setattr("app.basemap.service.download", _down)
    assert client.get(f"{API}/basemap/streets/3/5/2").status_code == 503
    assert client.get(f"{API}/basemap/streets/3/4/2").status_code == 200


def test_the_back_off_expires(monkeypatch, tmp_path):
    now = [1000.0]
    monkeypatch.setattr("app.basemap.service.monotonic", lambda: now[0])
    monkeypatch.setattr("app.basemap.service.download", _down)
    cache = service.BasemapCache(tmp_path, "test")
    with pytest.raises(service.BasemapUnavailable):
        cache.tile("streets", 3, 4, 2)
    monkeypatch.setattr("app.basemap.service.download", lambda url, ua: PNG)
    with pytest.raises(service.BasemapUnavailable):
        cache.tile("streets", 3, 4, 2)
    now[0] += service.BACKOFF_S + 1
    assert cache.tile("streets", 3, 4, 2) == (PNG, "image/png")
